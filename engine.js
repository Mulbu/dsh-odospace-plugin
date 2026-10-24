/**
 * 桥的核心引擎 —— 原来是 bridge.mjs 里的顶层代码，现在是一个可实例化的对象，
 * 由插件在 apply() 里创建、在插件卸载时 dispose()。
 *
 * 为什么不直接复用 bridge.mjs：那个文件是**命令行程序**，顶层就 parseArgs、
 * process.exit、起 server。插件里要的是同样的行为，但需要可重复创建、可干净
 * 关闭、可让 Web UI 页面读到实时状态。所以逻辑搬到这里，bridge.mjs 只留参数解析。
 *
 * 桥只负责 dsh 这一页（page 1）。AIDA64 直连手机推 page 0，不经过本模块 ——
 * 所以这里没有 ingest / compose / relay 那一套。
 */

import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';

import { drawPanel, encodeJpeg } from './lib/render.js';
import { sendFrame, COMMAND_CLEAR } from './lib/odospace.js';
import { SensorStore } from './lib/sensors.js';
import { latestProgress, listTasks } from './lib/state.js';

/** 一帧的渲染参数（与 bridge.mjs 的 renderFrame 一致）。 */
export function renderFrame(tasks, { width, height, lit, quality }) {
  return encodeJpeg(drawPanel(tasks, { width, height, lit }), quality);
}

/**
 * 影响画面的字段。不含 updatedAt（每轮都变），也不含 tokensIn/toolMs 这类
 * 不上屏的累计值 —— 它们一变就重渲染纯属浪费。
 *
 * @param {object[]} tasks
 */
export function signatureOf(tasks) {
  return tasks
    .map((task) => [task.sessionId, task.ledState, task.title, task.prompt, task.model].join('\u0001'))
    .join('\u0002');
}

/** 六态统计，给页面和日志用。 */
export function tallyOf(tasks) {
  const tally = { fail: 0, tool: 0, run: 0, done: 0, ask: 0, idle: 0 };
  for (const task of tasks) {
    if (task.ledState in tally) tally[task.ledState] += 1;
  }
  return tally;
}

/** 空闲面板的数据形状（单任务视图没有会话时用）。 */
const IDLE_VIEW = {
  title: '',
  current: '空闲',
  model: '',
  todos: { total: 0, done: 0, active: undefined, percent: undefined, items: [] },
  turn: 0,
  step: 0,
  busy: false,
  team: { total: 0, done: 0 },
  tokensIn: 0,
  tokensOut: 0,
  llmMs: 0,
};

/**
 * 会话列表，但**去掉还没开始的空会话**。
 *
 * 为什么需要这层：`state.js` 只按「归档 + 工作区归属」过滤，而一个刚点开、
 * 一句话都还没说的会话两者都满足 —— 它会被当成一个任务占掉一行，面板上显示
 * 「未命名任务 / Mulbu：—」。实测确实出现过这种行（title、prompt、firstPrompt
 * 全空，turns=0），把真正在跑的会话往下挤。
 *
 * 判据用「有没有标题或任一轮输入」而不是 turns 计数：有些历史会话的
 * turnOutline 被投影裁剪过，turns 可能为空但标题还在，那种应该保留。
 *
 * 多取一条再过滤，避免过滤后列表比 `limit` 短。
 *
 * @param {{ limit: number, includeSubagents: boolean }} options 同 listTasks
 * @returns {Promise<object[]>} 已过滤的任务，最多 `limit` 条
 */
export async function visibleTasks(options) {
  const wanted = options.limit;
  const tasks = await listTasks({ ...options, limit: Math.min(12, wanted + 2) });
  return tasks
    .filter((task) => {
      const title = typeof task.title === 'string' ? task.title.trim() : '';
      const prompt = typeof task.prompt === 'string' ? task.prompt.trim() : '';
      const firstPrompt = typeof task.firstPrompt === 'string' ? task.firstPrompt.trim() : '';
      return title !== '' || prompt !== '' || firstPrompt !== '';
    })
    .slice(0, wanted);
}

/**
 * 创建一个桥实例。**不启动**任何 IO；调用 start() 才开始推流。
 *
 * @param {object} config 归一化后的配置（见 index.js 的 resolveConfig）
 * @param {{ log?: (event: {level: string, message: string, [key: string]: unknown}) => void }} [options]
 *   日志出口：插件把它接到 ctx.logger
 */
export function createBridge(config, options = {}) {
  const log = options.log ?? (() => {});

  /**
   * 实际生效的配置。**故意做成可变对象**：设置页改完 host / port / tasks 后，
   * 由 `update()` 原地替换字段，渲染循环立刻按新值跑 —— 不用重启 dsh，
   * 也不用销毁重建整个桥（重建会关掉 serve 端口，正在推的画面会断一帧）。
   *
   * 所有读配置的地方都走 `live`，不再解构到闭包常量里。
   */
  const live = { ...config };

  /**
   * 推流目标的可变句柄。
   *
   * 之前 `target` 是个常量对象，设置页改 host/port 后只能重启；现在每次推送都
   * 调 `live.target()` 现取，改完下一个推送周期就生效。
   */
  live.target = () => ({ host: live.host, port: live.port });
  /** 当前帧尺寸，渲染时现取（改 size 立刻反应到下一帧）。 */
  live.viewport = () => {
    const [width, height] = live.size;
    return { width, height };
  };
  /** 给 `/api` 返回的配置快照（去掉内部辅助方法）。 */
  live.snapshot = () => {
    const {
      size, host, port, page, tasks: tasksCount, includeSubagents, alwaysPush, idleFrames,
      fps, quality, checkIntervalMs, intervalMs, dryRun, out, serve, serveHost,
    } = live;
    return {
      host, port, page,
      size: size.join('x'),
      width: size[0],
      height: size[1],
      tasks: tasksCount,
      includeSubagents,
      alwaysPush,
      idleFrames,
      fps,
      quality,
      checkIntervalMs,
      intervalMs,
      dryRun,
      out: out ?? null,
      serve,
      serveHost,
    };
  };

  /**
   * 用一个新配置替换当前生效值。字段缺失时保留旧值。
   *
   * 只更新**能在运行时安全生效**的项：目标、页号、尺寸、行数、灯效、质量、
   * 间隔、dry-run。监听端口（serve）不能热改 —— 那需要关掉再重开 socket，
   * 会打断正在连接的外部脚本，所以留给重启。
   *
   * @param {object} patch 归一化后的配置片段
   * @returns {{changed: string[], needsRestart: string[]}} 生效 / 需重启的字段
   */
  function update(patch) {
    const changed = [];
    const needsRestart = [];
    const hot = [
      'host', 'port', 'page', 'tasks', 'includeSubagents', 'alwaysPush', 'idleFrames',
      'fps', 'quality', 'checkIntervalMs', 'intervalMs', 'dryRun', 'out',
    ];
    for (const key of hot) {
      if (patch[key] === undefined) continue;
      if (key === 'page' || key === 'port' || key === 'tasks' || key === 'fps'
        || key === 'quality' || key === 'checkIntervalMs' || key === 'intervalMs') {
        if (live[key] !== Number(patch[key])) changed.push(key);
        live[key] = Number(patch[key]);
      } else if (live[key] !== patch[key]) {
        changed.push(key);
        live[key] = patch[key];
      }
    }
    if (Array.isArray(patch.size) && patch.size.join('x') !== live.size.join('x')) {
      live.size = patch.size;
      changed.push('size');
    }
    // 尺寸/内容变了必须重画；清掉指纹让下一轮一定渲染
    lastSignature = undefined;
    idlePng = undefined;
    for (const key of ['serve', 'serveHost', 'serveToken', 'serveTokenFile']) {
      if (patch[key] !== undefined && patch[key] !== live[key]) needsRestart.push(key);
    }
    if (changed.length > 0) {
      log({ level: 'info', message: `配置已更新: ${changed.join(', ')}` });
    }
    return { changed, needsRestart };
  }

  /** 当前帧尺寸 / 目标 / 页号 —— 每次都从 live 读，设置一改就跟着变。 */
  const view = () => {
    const [width, height] = live.size;
    return { width, height, target: live.target(), imageId: live.page };
  };

  /** 最近一帧的进度快照，供 HTTP 接口和 UI 页面复用。 */
  let latestSnapshot;
  /** 外部 POST 上来的传感器数据（可选功能，仅 HTTP JSON 接口用，不上屏）。 */
  const sensorStore = new SensorStore();

  let stopping = false;
  /** 上一帧的指纹：内容没变就不重复推送，省接收端电。 */
  let lastSignature;
  /** 最后一次成功推给手机的 dsh 帧。 */
  let lastPushedPng;
  /** 空闲占位帧缓存：还没有任何帧时用它。 */
  let idlePng;

  /** 帧计数器 / 错误：给页面报告“到底推没推出去”。 */
  const stats = {
    rendered: 0,
    pushed: 0,
    pushErrors: 0,
    lastPushAt: 0,
    lastError: null,
    startedAt: Date.now(),
  };
  let serveStats;

  /** 待清理的资源：定时器 / 服务器 / sleep 取消函数。 */
  const disposers = [];
  /** 当前 sleep 的定时器，dispose 时要清掉。 */
  let sleepTimer;

  function sleep(ms) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        const index = disposers.indexOf(finish);
        if (index >= 0) disposers.splice(index, 1);
        resolve();
      };
      sleepTimer = setTimeout(finish, ms);
      disposers.push(finish);
    });
  }

  /** 推一帧到接收端；dry-run 时只落盘。 */
  async function push(frame) {
    if (!live.dryRun) {
      try {
        await sendFrame(live.target(), frame, { imageId: live.page });
        stats.pushed += 1;
        stats.lastPushAt = Date.now();
      } catch (error) {
        stats.pushErrors += 1;
        stats.lastError = `推送失败: ${error.message}`;
      }
    }
    lastPushedPng = frame;
    if (live.out !== '' && live.out !== undefined) await writeFile(live.out, frame).catch(() => {});
  }

  /** 单轮渲染 + 推送（非灯效模式的 tick，也用于单任务视图）。 */
  async function tick() {
    const progress = await latestProgress({});
    const active = progress !== undefined;

    // 没有活跃会话时：用最后一帧重推，让副屏保持最后一个画面。
    if (!active) {
      if (live.tasks > 0) {
        const tasks = await visibleTasks({ limit: live.tasks, includeSubagents: live.includeSubagents });
        if (tasks.length === 0) {
          if (!live.idleFrames) return;
          idlePng ??= renderFrame([], { ...live.viewport(), quality: live.quality });
          await push(idlePng);
          return;
        }
        stats.rendered += 1;
        latestSnapshot = tasks[0];
        await push(renderFrame(tasks, { ...live.viewport(), quality: live.quality }));
        return;
      }

      if (lastPushedPng === undefined) {
        idlePng ??= renderFrame([], { ...live.viewport(), quality: live.quality });
        await push(idlePng);
        return;
      }
      if (live.idleFrames) await push(lastPushedPng);
      return;
    }

    latestSnapshot = progress;
    const view = progress ?? IDLE_VIEW;

    // 列表视图的指纹要含所有任务，否则别的会话变化不会触发重绘
    const tasks =
      live.tasks > 0 ? await visibleTasks({ limit: live.tasks, includeSubagents: live.includeSubagents }) : undefined;
    const signature = JSON.stringify({
      view,
      tasks: tasks === undefined ? undefined : signatureOf(tasks),
    });
    if (!live.alwaysPush && signature === lastSignature) return;
    lastSignature = signature;

    stats.rendered += 1;
    await push(renderFrame(tasks ?? [view], { ...live.viewport(), quality: live.quality }));
  }

  /**
   * 灯效主循环：红/橙闪 0.5 秒一次，其余状态只渲染一帧。
   *
   * 省渲染的核心：**只有 ask / fail 需要两帧**。绿、蓝、灭都是静态的，
   * 亮帧和暗帧像素完全一致 —— 只渲染一张、也只推一张。
   */
  async function blinkLoop() {
    /**
     * 闪烁半周期 0.5 秒，只影响**有闪灯任务时**的节奏（红闪、橙闪）。
     * 不能和空闲轮询共用一个值 —— 共用会让空闲状态也每 0.5 秒空转一次。
     */
    const blinkHalfMs = 500;
    const idleHalfMs = 1000;
    /** 亮暗两帧；没有闪灯任务时只渲染 lit，dark 为 undefined。 */
    let frames = { lit: undefined, dark: undefined };
    let loadedSignature = '';
    let showLit = true;
    let cachedTasks;
    let lastCheckAt = 0;

    while (!stopping) {
      const startedAt = Date.now();
      try {
        const needCheck = Date.now() - lastCheckAt >= live.checkIntervalMs;
        let tasks;

        if (needCheck) {
          tasks = await visibleTasks({ limit: live.tasks > 0 ? live.tasks : 1, includeSubagents: live.includeSubagents });
          lastCheckAt = Date.now();
          if (tasks.length === 0) {
            await sleep(idleHalfMs);
            continue;
          }
          cachedTasks = tasks;
        } else {
          tasks = cachedTasks;
        }

        if (tasks === undefined) {
          await sleep(idleHalfMs);
          continue;
        }

        const signature = needCheck ? signatureOf(tasks) : loadedSignature;
        if (signature !== loadedSignature) {
          const viewList = live.tasks > 0 ? tasks : tasks.slice(0, 1);
          const blinking = viewList.some(
            (task) => task.ledState === 'ask' || task.ledState === 'fail',
          );
          frames = {
            lit: renderFrame(viewList, { ...live.viewport(), quality: live.quality }),
            dark: blinking
              ? renderFrame(viewList, { ...live.viewport(), live: false, quality: live.quality })
              : undefined,
          };
          stats.rendered += 1;
          loadedSignature = signature;
          latestSnapshot = viewList[0] ?? latestSnapshot;
          log({
            level: 'debug',
            message: `已渲染${blinking ? '两帧' : '一帧'}`,
            tally: tallyOf(viewList),
            bytes: frames.lit.length,
          });
        }

        const blinking = frames.dark !== undefined;
        const frame = blinking && !showLit ? frames.dark : frames.lit;
        await push(frame);
        if (blinking) showLit = !showLit;

        if (!blinking) {
          await sleep(Math.max(idleHalfMs, live.checkIntervalMs - (Date.now() - startedAt)));
          continue;
        }
      } catch (error) {
        stats.lastError = error.message;
        log({ level: 'warn', message: `灯效循环出错: ${error.message}` });
      }
      await sleep(Math.max(0, blinkHalfMs - (Date.now() - startedAt)));
    }
  }

  /** 静态轮询循环（fps = 0 时使用）。 */
  async function pollLoop() {
    while (!stopping) {
      const startedAt = Date.now();
      try {
        await tick();
      } catch (error) {
        stats.lastError = error.message;
        log({ level: 'warn', message: `轮询出错: ${error.message}` });
      }
      await sleep(Math.max(0, live.intervalMs - (Date.now() - startedAt)));
    }
  }

  /** 独立的 token 接口（可选）。Windows 侧脚本不在浏览器里，用 token 而不是同源校验。 */
  function startServe() {
    if (live.serve === undefined) return;
    const token = live.serveToken ?? '';
    const authorized = (request, url) => {
      if (token === '') return true;
      if (request.headers['x-dsh-token'] === token) return true;
      return url.searchParams.get('token') === token;
    };

    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      const json = (status, body) => {
        response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(body, null, 2));
      };
      if (!authorized(request, url)) return json(401, { error: 'bad token' });

      if (request.method === 'POST' && url.pathname === '/sensors') {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          // 传感器列表很小；给 256 KB 上限，挡住明显的垃圾请求
          if (bytes > 256 * 1024) {
            response.writeHead(413).end();
            return undefined;
          }
          chunks.push(chunk);
        }
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          sensorStore.update(body.sensors ?? body);
          return json(200, { ok: true, count: sensorStore.snapshot().length });
        } catch (error) {
          return json(400, { error: `bad json: ${error.message}` });
        }
      }
      if (request.method !== 'GET') return json(405, { error: 'method not allowed' });
      return json(200, {
        updatedAt: new Date().toISOString(),
        progress: latestSnapshot ?? null,
        sensors: sensorStore.snapshot(),
        sensorsAge: sensorStore.ageText(),
        stats,
      });
    });

    server.on('error', (error) => {
      log({ level: 'warn', message: `serve 启动失败: ${error.message}` });
    });
    server.listen(live.serve, live.serveHost, () => {
      log({
        level: 'info',
        message:
          `HTTP 接口 http://${live.serveHost === '0.0.0.0' ? '<本机所有地址>' : live.serveHost}:${live.serve}/` +
          `（${token ? '已启用 token' : '无 token'}）`,
      });
      if (live.serveHost !== '127.0.0.1' && live.serveHost !== 'localhost' && token === '') {
        log({
          level: 'warn',
          message: '接口已暴露到局域网且没有 token，任何人都能读会话标题',
        });
      }
    });
    serveStats = { host: live.serveHost, port: live.serve, token: token !== '' };
    disposers.push(() => {
      server.close();
    });
  }

  /**
   * 同源 JSON 路由（给 Web UI 页面用）：`GET /dsh-odospace/api`。
   *
   * payload 里有会话标题，所以只接受同源请求，不使用 token。
   */
  async function handleRoute(request, response) {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const json = (status, body) => {
      const text = JSON.stringify(body);
      response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-length': Buffer.byteLength(text),
      });
      response.end(text);
    };

    const origin = request.headers.origin;
    const hostHeader = request.headers.host;
    const crossSite =
      request.headers['sec-fetch-site'] === 'cross-site' ||
      (origin !== undefined && hostHeader !== undefined && new URL(origin).host !== hostHeader);
    if (crossSite) return json(403, { ok: false, error: 'forbidden' });

    if (request.method === 'POST' && url.pathname.endsWith('/sensors')) {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 256 * 1024) {
          response.writeHead(413).end();
          return undefined;
        }
        chunks.push(chunk);
      }
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        sensorStore.update(body.sensors ?? body);
        return json(200, { ok: true, count: sensorStore.snapshot().length });
      } catch (error) {
        return json(400, { ok: false, error: `bad json: ${error.message}` });
      }
    }

    // 页面上的「立即推一帧」按钮
    if (request.method === 'POST' && url.pathname.endsWith('/push')) {
      try {
        const result = await pushNow();
        return json(200, { ok: true, ...result });
      } catch (error) {
        return json(500, { ok: false, error: error.message });
      }
    }

    // 页面上的实时预览：返回和推给接收端完全一致的那张 JPEG 字面量。
    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.endsWith('/preview')) {
      try {
        const frame = await renderPreview();
        response.writeHead(200, {
          'content-type': 'image/jpeg',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-length': frame.length,
        });
        response.end(request.method === 'HEAD' ? undefined : frame);
      } catch (error) {
        json(500, { ok: false, error: error.message });
      }
      return undefined;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD, POST' });
      response.end();
      return undefined;
    }

    const tasks = await visibleTasks({
      limit: live.tasks > 0 ? live.tasks : 4,
      includeSubagents: live.includeSubagents,
    }).catch(() => []);

    const [liveWidth, liveHeight] = live.size;
    const snapshot = live.snapshot();
    return json(200, {
      ok: true,
      now: Date.now(),
      config: {
        ...snapshot,
        width: liveWidth,
        height: liveHeight,
        serve: serveStats ?? null,
      },
      tasks,
      tally: tallyOf(tasks),
      latest: latestSnapshot ?? tasks[0] ?? null,
      sensors: sensorStore.snapshot(),
      sensorsAge: sensorStore.ageText(),
      stats: {
        ...stats,
        uptimeMs: Date.now() - stats.startedAt,
        lastPushedBytes: lastPushedPng === undefined ? null : lastPushedPng.length,
      },
    });
  }

  /** 渲染一帧给 UI 预览用（不推送）。 */
  async function renderPreview() {
    const tasks = await visibleTasks({ limit: live.tasks > 0 ? live.tasks : 1, includeSubagents: live.includeSubagents });
    const viewList = live.tasks > 0 ? tasks : tasks.slice(0, 1);
    return renderFrame(viewList, { ...live.viewport(), quality: live.quality });
  }

  /** 主动推一帧（页面上的“立即推送”按钮）。 */
  async function pushNow() {
    const frame = await renderPreview();
    await push(frame);
    return { bytes: frame.length, pushed: stats.pushed, dryRun: live.dryRun };
  }

  return {
    config: live,
    stats,
    update,
    renderPreview,
    pushNow,
    handleRoute,
    get sensors() {
      return sensorStore.snapshot();
    },
    /** 启动全部 IO。重复调用无副作用。 */
    start() {
      startServe();
      log({
        level: 'info',
        message:
          `面板 ${live.size[0]}x${live.size[1]} → ${live.dryRun ? '(dry-run)' : `${live.host}:${live.port}`}` +
          ` page=${live.page} tasks=${live.tasks} fps=${live.fps} alwaysPush=${live.alwaysPush}`,
      });
      void (live.fps > 0 ? blinkLoop() : pollLoop());
    },
    /** 停止全部 IO。之后实例不可复用。 */
    async dispose() {
      stopping = true;
      if (sleepTimer !== undefined) clearTimeout(sleepTimer);
      while (disposers.length > 0) {
        const dispose = disposers.pop();
        try {
          await dispose();
        } catch {
          /* 忽略关闭错误 */
        }
      }
    },
  };
}

export { COMMAND_CLEAR };
