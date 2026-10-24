/**
 * 面板绘制模块 —— 用 node-canvas 直接画，不再经过 HTML + Chrome。
 *
 * 为什么换：Chrome headless 要 1082MB 常驻内存、199ms/帧；node-canvas 只要
 * 66MB、19ms/帧。视觉上两者共用同一个中文字体（文泉驿微米黑），字形一致。
 *
 * 关键坑：**不要用 registerFont 注册 ttc**。文泉驿微米黑的 ttc 里只有
 * Regular 一个 face，注册后 `bold 38px` 完全无效（墨水量不变）。必须走系统
 * fontconfig、直接用字体名 "WenQuanYi Micro Hei"，才能拿到真正的粗体。
 */

import { createCanvas } from 'canvas';

/** 字体族名：走系统 fontconfig，不注册字体文件。 */
const FONT = 'WenQuanYi Micro Hei';

/** 用户输入行的说话人前缀。想换成别的名字改这里即可。 */
const SPEAKER = 'Mulbu';

/**
 * 单行最大高度（480x320 设计基准，实际会乘 scale）。
 *
 * 不给上限的话行高是 `可用高度 / 行数` 均分：4 行时每行 154px，
 * 标题和副标题挤在垂直中央、上下各空 60px，整屏看着很散。
 *
 * 取值说明：1350x720 下 scale=2.25，主标题 21*2.25≈47px + 副标题 17*2.25≈38px，
 * 两行文字本身约 85px；文字基线间距约 63px，所以行高至少要 ~115px 才不重叠。
 *
 * 去掉顶部栏后可用高度从 616 涨到 666，4 行时自然行高 166px。
 * 取 70 基准（×2.25 = 158px），既比原来的 135px 更宽松，又不会顶到自然值。
 * 踩过的坑：填 44（≈99px）时两行字直接叠在一起；填 72（≈162px）在去顶栏前
 * 会超过均分值 154px 导致封顶失效（现在可用高度够了，不会再出现）。
 */
const ROW_H_MAX = 70;

/**
 * 主标题字号（设计基准）。
 *
 * 之前是硬编码的 17，而副标题被我调到了 18 —— 副标题比主标题还大，
 * 层级完全反了。现在显式定义两个常量，并保证 主 > 副 有明显差距。
 * 21 × 2.25 ≈ 47px。
 */
const TITLE_SIZE = 21;

/**
 * 副标题字号（设计基准）。
 *
 * 从 12 提到 18 是为了让「Mulbu：xxx」看得清，但 18 已经超过主标题了。
 * 现在主标题 21，副标题 16，比例 21:16 ≈ 1.31，层级更清楚。
 * 16 × 2.25 = 36px，比原来的 12(27px) 仍大不少。
 */
const SUB_SIZE = 16;

/** 配色（与 AgentPager 的 AgentGridTheme 一致）。 */
const C = {
  background: '#05070B',
  text: '#E8EDF5',
  muted: '#7F8A9A',
  /** 副标题用色：比 muted 亮一档，加粗后仍需足够对比度。 */
  subText: '#A8B4C4',
  dimmed: '#4F5968',
  blue: '#60A5FA',
  cyan: '#5EEAD4',
  violet: '#A78BFA',
  indigo: '#818CF8',
  orange: '#FB923C',
  green: '#4ADE80',
};

/** 未点亮（空闲 / 黄灯暗相）的方块颜色。 */
const OFF_COLOR = 'rgba(127,138,154,0.32)';

/**
 * 五态灯号 —— 灯色和状态文字都由 ledState 决定，不再各自推断，
 * 保证"方块的颜色"和"右边写的字"永远一致。
 *
 *   done 任务完成     → 绿常亮
 *   tool 正在调用工具 → 橙常亮（跑命令、等命令反馈）
 *   run  正在执行     → 蓝常亮（模型思考 / 生成内容）
 *   ask  询问用户     → 橙闪烁
 *   idle 空闲         → 灭灯
 */
const RED = '#F87171';

const LED = {
  fail: { color: RED, label: '连接失败' },
  done: { color: C.green, label: '任务完成' },
  tool: { color: C.orange, label: '正在执行' },
  run: { color: C.blue, label: '正在思考' },
  ask: { color: C.orange, label: '等待回答' },
  idle: { color: C.dimmed, label: '空闲' },
};

/**
 * 该任务这一帧的方块颜色。
 *
 * 只有 ask 和 fail 会闪：`phase` 为 false 时给灭灯色。
 * 节奏由 bridge.mjs 的 blinkHalfMs 决定（当前 0.5 秒亮 / 0.5 秒暗）。
 * 其余状态都常亮，不随 phase 变化 —— 这正是减少渲染次数的关键：
 * 没有闪灯任务时，亮帧和暗帧像素完全一致，只渲染一张、推一张就够了。
 *
 * 注意 ask（橙闪）和 tool（橙常亮）现在是同一个橙色，靠"闪不闪"区分：
 * 闪烁 = 需要你回答，常亮 = 它自己在干活。
 *
 * @param {string} ledState 'fail' | 'done' | 'tool' | 'run' | 'ask' | 'idle'
 * @param {boolean} phase 闪烁相位（只有 ask / fail 用得上）
 */
function ledColor(ledState, phase) {
  if (ledState === 'ask') return phase ? C.orange : OFF_COLOR;
  if (ledState === 'fail') return phase ? RED : OFF_COLOR;
  return LED[ledState]?.color ?? OFF_COLOR;
}

/** 状态文字与颜色 —— 直接取 ledState，不在这里二次推断。 */
function taskStatus(task) {
  return LED[task.ledState] ?? LED.idle;
}

/**
 * 右侧三个元素的字号 / 尺寸（设计基准，实际乘 scale）。
 *
 * 这三个是同一视觉层级的信息（速率、上下文、状态），必须一起放大缩小，
 * 否则某个单独调大就会显得突兀。
 *
 * 踩过的坑：副标题从 12 → 18 时只改了副标题，右侧三个还是 10/11/13，
 * 结果左侧文字很大、右侧指标像蚂蚁，整行失衡。
 */
/** 上下文环形直径。 */
const CTX_GAUGE_BASE = 20;
/** 上下文百分比文字字号。 */
const CTX_TEXT_SIZE = 15;
/** 状态文字（正在执行 / 空闲…）字号 —— 与上下文百分比一致。 */
const STATUS_SIZE = 15;
/** 运行时按 scale 算出来的实际直径，drawPanel 里会重设。 */
let ctxGaugeW = CTX_GAUGE_BASE;

/**
 * 画上下文占用：一个小环形进度 + 百分比文字。
 *
 * 没数据时画成空心环 + `—`，不编造数字。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{percent?: number, x: number, centerY: number, scale: number}} options
 */
function drawContextGauge(ctx, options) {
  const { percent, x, centerY, scale } = options;
  const d = Math.round(CTX_GAUGE_BASE * scale);
  const r = d / 2 - Math.round(1.6 * scale);
  const cx = x + d / 2;
  const cy = centerY;

  const known = Number.isFinite(percent);
  // 统一蓝色。之前按占用率分级（青 / 琥珀 / 红），但那样一行里出现好几种
  // 颜色，和状态胶囊的颜色语义（橙=执行、绿=完成…）混在一起容易误读。
  // 上下文始终是一种冷色，当背景信息看。
  const color = known ? C.blue : C.dimmed;

  // 底环
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(127,138,154,0.28)';
  ctx.lineWidth = Math.max(1.5, 2 * scale);
  ctx.stroke();

  // 进度弧：从 12 点方向顺时针
  if (known && percent > 0) {
    const frac = Math.min(1, percent / 100);
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, 2 * scale);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // 百分比文字
  ctx.font = `bold ${Math.round(CTX_TEXT_SIZE * scale)}px "${FONT}"`;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.fillText(
    known ? `${percent}%` : '—',
    cx + r + Math.round(6 * scale),
    cy + Math.round(5 * scale),
  );
}

/**
 * 按像素宽度截断文本，末尾加省略号。
 *
 * 先量整段；放不下就二分查找最长可行前缀。canvas 的 measureText 是精确的，
 * 所以不会出现 HTML 那种估算误差。
 */
function clipText(ctx, text, maxWidth) {
  const str = String(text ?? '');
  if (ctx.measureText(str).width <= maxWidth) return str;
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${str.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${str.slice(0, lo)}…` : '';
}

/** 圆角矩形路径。 */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * 画一屏多任务列表。
 *
 * @param {object[]} tasks 任务列表（来自 state.mjs 的 listTasks）
 * @param {{width?: number, height?: number, lit?: boolean}} [options]
 *   lit 为 true 时"正在执行"的方块亮色，false 时为暗色（闪烁的另一帧）
 * @returns {import('canvas').Canvas}
 */
export function drawPanel(tasks, options = {}) {
  const W = options.width ?? 1350;
  const H = options.height ?? 720;
  const lit = Boolean(options.lit);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 缩放：以 480x320 为基准，取宽高较小值，避免宽屏上字号过大
  const scale = Math.min(W / 480, H / 320);
  // 上下文环形：直径 + 右侧百分比文字的预算宽度，用模块级变量传给绘制逻辑
  // 环形 + 百分比文字的预算宽度：环 20 + 间隔 6 + `100%`(15 基准约 28)
  ctxGaugeW = Math.round(CTX_GAUGE_BASE * scale) + Math.round(40 * scale);
  const padX = Math.round(16 * scale);
  const padY = Math.round(12 * scale);

  ctx.fillStyle = C.background;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // ── 任务行 ──
  //
  // 原来这里有个顶部栏（左边 `AI AGENTS`、右边 `4 个任务 · 1 个执行中`），
  // 占掉 22*scale ≈ 50px 的高度。那个栏的信息价值很低（任务数自己数得到，
  // 执行中几个看灯色也知道），现在整块去掉，把高度让给行间距。
  const list = Array.isArray(tasks) ? tasks : [];
  const top = padY;
  const usable = H - top - padY;
  const rows = Math.min(8, Math.max(1, list.length));

  // 行高封顶：原来是 `usable / rows` 均分，4 行时每行 154px，字挤在中间、
  // 行与行之间空一大截，很难读成一列。现在给一个上限，行紧了，剩下的空间
  // 让整块垂直居中（见下面的 blockTop），不会出现底部空一大块。
  const rowH = Math.min(Math.floor(usable / rows), Math.round(ROW_H_MAX * scale));
  // 整块内容在可用区域里垂直居中
  const blockTop = top + Math.floor((usable - rows * rowH) / 2);
  const blockSize = Math.round(20 * scale);
  const blockRad = Math.round(6 * scale);

  // 右侧列的固定宽度预算。
  //
  // 这三个元素放大后右侧一度占到 46% 屏宽，把左侧标题挤到只剩 567px、
  // 出现 `AIDA64 OSD 进度显示样式…` 这种截断。这里按实际测量值收紧：
  // 状态文字最长的「正在执行」是 4 字 × 18 ≈ 76（留点余量给粗体）；
  // 速率徽章 `199 tok/s` @15 约 90（含左右内边距）。
  // 状态胶囊宽度：字号降到 15 后「正在执行」约 137px + 内边距 40px = 177px，
  // 按 79 基准（×2.25 = 178）留足。
  const statusW = Math.round(79 * scale);
  const gap = Math.round(8 * scale);
  // 右侧 = 状态胶囊 + 上下文环，两块的宽度都从标题可用宽度里扣掉
  const textRight =
    W - padX - statusW - gap - ctxGaugeW - Math.round(8 * scale);
  const textLeft = padX + blockSize + Math.round(12 * scale);
  const titleMaxW = Math.max(60, textRight - textLeft);

  list.slice(0, rows).forEach((task, index) => {
    const y = blockTop + index * rowH;
    // 灭灯的行压暗。
    //
    // 判断依据是**灯态而不是行号**：亮着灯（橙/蓝/绿/黄）的行一律全亮度，
    // 因为它们代表「正在发生的事」，不该因为排在第几行就看不见；灭灯的行
    // 统一压暗，表示「这条没在动」。
    //
    // 早期用的是 `index > 0 && idle`，会让第一行永远是全亮度 —— 当一屏任务
    // 同时归入空闲时，第一行明显比下面三行亮，看起来像"第一行更重要"，
    // 而这个区别并不存在。
    const dim = task.ledState === 'idle';
    ctx.globalAlpha = dim ? 0.34 : 1;

    const status = taskStatus(task);
    const centerY = y + rowH / 2;

    // 方块：颜色由 ledState 决定，只有 ask（橙闪）和 fail（红闪）随相位明暗切换
    ctx.fillStyle = ledColor(task.ledState, lit);
    roundRect(
      ctx,
      padX,
      centerY - blockSize / 2,
      blockSize,
      blockSize,
      blockRad,
    );
    ctx.fill();

    // 标题
    const titleSize = Math.round(TITLE_SIZE * scale);
    ctx.font = `bold ${titleSize}px "${FONT}"`;
    ctx.fillStyle = C.text;
    // 标题基线：往上抬一点，给下面加粗放大的副标题腾出行距
    ctx.fillText(clipText(ctx, task.title || task.prompt || '未命名任务', titleMaxW), textLeft, centerY - Math.round(8 * scale));

    // 副标题：字号加大、加粗、颜色提亮一档。
    // 原来 12px 常规体在手机上几乎看不清，而它承载的是「你最近说了什么」，
    // 信息价值和标题同级，只是层级低一点。
    const subSize = Math.round(SUB_SIZE * scale);
    ctx.font = `bold ${subSize}px "${FONT}"`;
    ctx.fillStyle = C.subText;
    // 副标题：
    //   正在跑工具  → 只显示工具名（`正在执行 bash…`）。
    //                 这时橙灯 + 工具名就是完整信息「外部世界正在干活」，
    //                 再塞用户输入只会把那行挤满、两边都看不清。
    //   等待回答    → 必须显示用户输入，**不能**显示工具名。
    //                 ask_user_question 是一个挂起的工具调用，所以
    //                 runningTool 会被填成 'ask_user_question'，照旧规则就会
    //                 渲染出「正在执行 ask_user_question…」——既把真正的问题
    //                 （用户最后说了什么）盖掉了，又等于把内部工具名当成了
    //                 给人看的状态，完全是噪音。
    //   其余情况    → 显示用户最近一轮说了什么，前缀是用户名字。
    const showTool = task.runningTool && task.ledState !== 'ask';
    const subtitle = showTool
      ? `正在执行 ${task.runningTool}…`
      : task.prompt
        ? `${SPEAKER}：${task.prompt}`
        : task.current
          ? `当前：${task.current}`
          : `${SPEAKER}：—`;
    ctx.fillText(clipText(ctx, subtitle, titleMaxW), textLeft, centerY + Math.round(19 * scale));

    // 右侧只剩 **上下文环 → 状态胶囊** 两块。
    //
    // 速率徽章已删除：它占了 90*scale ≈ 200px 宽度，而信息价值不如让标题
    // 多显示几个字 —— 「199 tok/s」这种数字看一次就够了，标题被截断却是
    // 每次都要猜。腾出来的宽度全部还给主标题和副标题。
    const gaugeLeft = W - padX - statusW - gap - ctxGaugeW;

    // 上下文占用：环形进度 + 百分比，紧贴状态胶囊左侧。
    // 这个指标反映「还要多久得压缩/开新会话」。
    drawContextGauge(ctx, {
      percent: task.contextPercent,
      x: gaugeLeft,
      centerY,
      scale,
    });

    // 状态文字：胶囊背景 + 边框，字号与上下文百分比对齐（都是 15 基准）。
    const statusSize = Math.round(STATUS_SIZE * scale);
    ctx.font = `bold ${statusSize}px "${FONT}"`;
    const statusTextW = ctx.measureText(status.label).width;
    const statusPadX = Math.round(9 * scale);
    const statusW2 = statusTextW + statusPadX * 2;
    const statusH = Math.round(24 * scale);
    // 右对齐到页面右内边距
    const statusX = W - padX - statusW2;
    const statusY = centerY - statusH / 2;

    ctx.fillStyle = `${status.color}22`;
    roundRect(ctx, statusX, statusY, statusW2, statusH, Math.round(7 * scale));
    ctx.fill();
    ctx.strokeStyle = `${status.color}88`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = status.color;
    ctx.textAlign = 'left';
    ctx.fillText(status.label, statusX + statusPadX, centerY + Math.round(5 * scale));
    ctx.textAlign = 'left';

    ctx.globalAlpha = 1;
  });

  // 空列表提示
  if (list.length === 0) {
    ctx.font = `${Math.round(16 * scale)}px "${FONT}"`;
    ctx.fillStyle = C.dimmed;
    ctx.textAlign = 'center';
    ctx.fillText('暂无任务', W / 2, H / 2);
    ctx.textAlign = 'left';
  }

  return canvas;
}

/**
 * 把画布编码成 JPEG。
 *
 * node-canvas 用 libjpeg-turbo，实测 4.4ms/帧（1350x720），比 PNG 快 12 倍。
 *
 * @param {import('canvas').Canvas} canvas
 * @param {number} quality 1..100
 * @returns {Buffer}
 */
export function encodeJpeg(canvas, quality = 60) {
  return canvas.toBuffer('image/jpeg', { quality: quality / 100 });
}
