/**
 * dsh 任务进度采样器。
 *
 * 数据源：dsh 把每个会话的运行态投影到
 *   ~/.dsh/storages/session_projcache/sessions/session-<id>.json
 * 里的 `record.rows`。这些行是「当前值」而不是事件流，所以只要读最新的文件即可，
 * 不需要解析 zstd 压缩的 session.v4.jsonl.zstd，也不需要访问 dsh 的 HTTP API
 * （那个 API 需要启动 token / cookie，外部脚本拿不到）。
 *
 * 关心的行：
 *   todos         todo_write 的清单（content + status）
 *   plan          plan 模式状态
 *   sessionStats  turns / steps / 当前 openStep / llmMs / toolMs
 *   tokenUsage    累计 token
 *   contextPressure 上下文压力
 *   title         会话标题
 *   agentTeam     Agent Teams 的任务板（有就一并显示）
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { pendingCallsOf } from './logtail.js';

const SESSION_DIR = path.join(
  homedir(),
  '.dsh',
  'storages',
  'session_projcache',
  'sessions',
);

/**
 * 工作区注册表 —— 归档会话的唯一权威来源。
 *
 * dsh 把「哪些会话被归档了」存在这里：
 *   global.archivedSessionIds = ["session-xxx", ...]
 *
 * 归档是一条**全局**记录（不属于某个会话自己的投影文件），所以只能从这里读。
 * 归档的语义是「从所有列表界面隐藏」—— 我们的副屏同样应该隐藏它们，否则
 * 你手机上会看到一堆已经收起来的历史会话。
 */
const WORKSPACE_REGISTRY = path.join(homedir(), '.dsh', 'storages', 'workspace.json');

/** 只认最近这么多秒内被写过的会话文件，避免把上周的旧会话当成「当前任务」。 */
const FRESH_MS = Number(process.env.DSH_ODO_FRESH_MS || 10 * 60 * 1000);

/**
 * 任务完成后多久归到「空闲」。
 *
 * 参考 AgentPager 的做法（它的 `TaskDashboardProjection.IDLE_DELAY_MILLIS`
 * 是 90 秒）：任务刚跑完先保持绿灯 90 秒，让你有机会看到「它完成了」；
 * 过了这段时间就收掉绿灯、归入空闲（灭灯），避免一屏全是常亮绿灯。
 *
 * 绿灯本来就不是「历史留痕」而是「刚刚发生的事」，留 90 秒足够瞥一眼。
 */
const DONE_HOLD_MS = Number(process.env.DSH_ODO_DONE_HOLD_MS || 90 * 1000);

/** 注册表快照的缓存，避免每次列任务都读一遍 4KB 的 workspace.json。 */
let registryCache;

/**
 * 读 dsh 的「隐藏会话」集合 —— 这些不该出现在副屏列表里。
 *
 * 两类都要排除，之前只排了第一类，结果漏掉了第二类：
 *
 *   1. **已归档**：`global.archivedSessionIds`
 *   2. **不属于任何工作区**：会话文件存在、但 id 不在任一
 *      `tables.workspaces.*.sessionIds` 里。
 *
 * 为什么第 2 类也要排：dsh 侧边栏是**按工作区**列会话的，不在工作区里的会话
 * 在 UI 上根本看不见。实测有个 cwd=/tmp 的会话（「回复两个字：你好。不要用任」）
 * 就在这种状态：既没归档、也不在工作区，于是被当成正常任务显示在了副屏第 3 行。
 *
 * 判定要反过来想：**只显示工作区里明确登记过的会话**，比「排除已知的隐藏类型」
 * 更稳 —— 以后 dsh 再加新的隐藏机制，我们不会又漏一个。
 *
 * 按 (size, mtime) 缓存：归档 / 增删会话都会重写 workspace.json，变了就重读。
 * 注册表读不出来时返回 null，调用方据此退回「不过滤」而不是整屏空白。
 *
 * @returns {Promise<{archived: Set<string>, inWorkspace: Set<string>} | null>}
 */
async function readRegistry() {
  let signature;
  try {
    const info = await stat(WORKSPACE_REGISTRY);
    signature = `${info.size}:${info.mtimeMs}`;
  } catch {
    return null; // 注册表不存在 = 没有工作区概念，不过滤
  }
  if (registryCache !== undefined && registryCache.signature === signature) {
    return registryCache.value;
  }
  let value;
  try {
    const raw = await readFile(WORKSPACE_REGISTRY, 'utf8');
    const parsed = JSON.parse(raw);
    const archived = new Set(
      Array.isArray(parsed?.global?.archivedSessionIds) ? parsed.global.archivedSessionIds : [],
    );
    const inWorkspace = new Set();
    for (const ws of Object.values(parsed?.tables?.workspaces ?? {})) {
      for (const id of ws?.sessionIds ?? []) inWorkspace.add(id);
    }
    value = { archived, inWorkspace };
  } catch {
    // 文件正在被 dsh 重写时可能读到半截 JSON，下次重试即可
    return null;
  }
  registryCache = { signature, value };
  return value;
}

/**
 * 这个会话是否应该出现在列表里。
 *
 * @param {string} sessionId
 * @param {{archived: Set<string>, inWorkspace: Set<string>} | null} registry
 */
function isVisibleSession(sessionId, registry) {
  if (registry === null) return true; // 读不到注册表就不过滤，宁可多显示
  if (registry.archived.has(sessionId)) return false; // 已归档
  return registry.inWorkspace.has(sessionId); // 必须登记在某个工作区
}

/**
 * 读一行投影值；行结构是 { ver, seq, val }。
 *
 * 注意 `val` 本身可能是 `null`（例如没写过 todo 的会话，`todos` 行的
 * `val` 就是 null）。所以要判的是 `entry` 存不存在，不能拿 `val` 当判断依据。
 * 早期写成 `entry === undefined ? undefined : entry.val`，遇到 `entry === null`
 * 时会在 `.val` 上抛 TypeError —— 而调用方用 try/catch 包着，症状是
 * **该会话直接从列表里消失**，非常难查。
 */
function row(rows, name) {
  const entry = rows?.[name];
  if (entry === undefined || entry === null) return undefined;
  return entry.val;
}

async function listSessionFiles() {
  const names = await readdir(SESSION_DIR);
  return names
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(SESSION_DIR, name));
}

/**
 * 找出「正在跑」的会话：先按 mtime 取最新，再用 FRESH_MS 过滤。
 * @returns {Promise<{ file: string, mtimeMs: number }[]>} 新到旧
 */
export async function findLiveSessions() {
  const files = await listSessionFiles();
  const stats = await Promise.all(
    files.map(async (file) => {
      try {
        const info = await stat(file);
        return { file, mtimeMs: info.mtimeMs };
      } catch {
        return undefined;
      }
    }),
  );
  const now = Date.now();
  return stats
    .filter((item) => item !== undefined && now - item.mtimeMs < FRESH_MS)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** 把一个 todo 清单压成进度数字。 */
function summariseTodos(todos) {
  if (!Array.isArray(todos) || todos.length === 0) {
    return { total: 0, done: 0, active: undefined, percent: undefined, items: [] };
  }
  const done = todos.filter((item) => item.status === 'completed').length;
  const active = todos.find((item) => item.status === 'in_progress');
  return {
    total: todos.length,
    done,
    active: active?.content,
    percent: Math.round((done / todos.length) * 100),
    items: todos,
  };
}

function clip(text, max) {
  if (typeof text !== 'string') return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * 清洗用户输入，去掉图片 / 附件 / 多模态标记，只留人话。
 *
 * 几块屏的宽度都很窄（副标题一行），而用户消息里可能夹着：
 *   - markdown 图片  ![alt](path)
 *   - HTML 图片      <img src="...">
 *   - 裸文件路径     /home/mulbu/.dsh/attachments/v1/objects/e7/e74a...png
 *   - 附件包裹标记   [Image #1] / <attachment>...</attachment>
 *   - data URI       data:image/png;base64,....
 * 这些在屏幕上既占地方又没有信息量，直接剥掉。
 */
function sanitizePrompt(text) {
  if (typeof text !== 'string') return '';
  let out = text;
  // data URI（可能很长，先干掉）
  out = out.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/gi, '');
  // markdown 图片：整段替换成占位，避免把标签本身显示出来
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]');
  // HTML img
  out = out.replace(/<img\b[^>]*>/gi, '[图片]');
  // 附件包裹块
  out = out.replace(/<attachment>[\s\S]*?<\/attachment>/gi, '[附件]');
  // 常见的 CLI 附件标记
  out = out.replace(/\[(?:Image|图片)\s*#?\d*\]/gi, '[图片]');
  // 裸图片文件路径（绝对路径 + 图片扩展名）
  out = out.replace(/\/(?:[\w.\-]+\/)*[\w.\-]+\.(?:png|jpe?g|gif|webp|bmp)\b/gi, '[图片]');
  // 裸文件名（相对路径形式）
  out = out.replace(/\b[\w.\-]+\.(?:png|jpe?g|gif|webp|bmp)\b/gi, '[图片]');
  // 多个占位合并，去掉重复的 [图片][图片]
  out = out.replace(/(\[图片\]\s*)+/g, '[图片] ');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * 采样一个会话文件，产出面板需要的纯数据。
 * @param {string} file 会话投影文件路径
 */
export async function readProgress(file, mtimeMs = 0) {
  const raw = await readFile(file, 'utf8');
  const rows = JSON.parse(raw)?.record?.rows ?? {};
  const todos = summariseTodos(row(rows, 'todos'));
  const stats = row(rows, 'sessionStats') ?? {};
  // 轮次边界：openTurnStartSeq 非空 = 「这一轮用户交的任务还没结束」。
  // 它比 openStep 稳定得多，是判断「还在干活」最可靠的兜底信号。
  const turnBoundary = row(rows, 'turnBoundary') ?? {};
  // 模型请求重试状态：`{ [provider+policyKey]: { retry, retryId } }`。
  // 非空 = 正在重试（模型连接失败），会在 step/start 或 turn/end 时被清空。
  const llmRetry = row(rows, 'llmRetry') ?? {};
  const plan = row(rows, 'plan') ?? {};
  const tokens = row(rows, 'tokenUsage') ?? {};
  const pressure = row(rows, 'contextPressure') ?? {};
  const team = row(rows, 'agentTeam') ?? {};
  const modelSelection = row(rows, 'modelSelection') ?? {};
  const openStep = stats.openStep;

  const teamTasks = Array.isArray(team.tasks) ? team.tasks : [];
  const teamDone = teamTasks.filter((task) => task.status === 'completed').length;

  // token 明细：In = 未缓存输入 + 缓存读取（缓存读取占绝大多数，和截图的
  // "In 4830万" 量级一致），Out = 输出。
  const totals = tokens?.totals ?? {};
  const tokensIn = (totals.uncachedInputTokens ?? 0) + (totals.cacheReadTokens ?? 0);
  const tokensOut = totals.outputTokens ?? 0;

  // 模型名：取 lastUsed.model，去掉厂商前缀，只留模型名
  const modelRaw = modelSelection?.lastUsed?.model ?? '';
  const model = String(modelRaw).split('/').pop() || 'unknown';

  // 用户输入：取 turnOutline 里**最后一轮**的 prompt。
  //
  // 为什么不是第一条：副标题写的是「你现在让我干什么」，首条提问是几十轮之前
  // 的事了，早就过期。看最后一条才知道这个会话当前在忙什么。
  //
  // turnOutline.turns 是完整的时间线（旧 -> 新），最后一轮就是用户最近一次输入。
  const turnOutline = row(rows, 'turnOutline') ?? {};
  const turns = Array.isArray(turnOutline?.turns) ? turnOutline.turns : [];
  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : undefined;
  const lastPrompt = sanitizePrompt(lastTurn?.prompt);
  // 首条 prompt 只用来兜底标题（标题本来就该反映会话主题，用首条合理）
  const firstPrompt = sanitizePrompt(turns[0]?.prompt);

  // 标题：优先会话标题，没有就用首条 prompt 的开头，都没有才叫未命名
  const rawTitle = row(rows, 'title');
  const title = clip(rawTitle, 40) || clip(firstPrompt, 28) || '';

  // 子代理（subagent 工具）也是独立的会话文件，但同样带一行 subagent 投影：
  //   subagent = { ver, seq, val: { identity: { mode, label, seq } } }
  // 主会话这一行的 val 是 {}，没有 identity。所以 identity 是否存在就是
  // 「这是子代理」的判据，比看文件名前缀（子代理文件名没有 session- 前缀）
  // 更可靠——前缀只是存储层的实现细节。
  const subagent = row(rows, 'subagent');
  const isSubagent = Boolean(subagent?.identity);
  const sessionId = path.basename(file, '.json');

  // 挂起的工具调用（有 call 没 result）。
  // 这份数据同时用于两件事：判断「是否在等用户回答」，以及判断「是否在跑工具」。
  // 子代理不会向用户提问（没有 UI 通道），但工具执行状态一样有用，所以照样读。
  const pendingCalls = await pendingCallsOf(sessionId);
  const asking = !isSubagent && pendingCalls.some((call) => call.name === 'ask_user_question');

  // 有没有工具正在跑。
  //
  // 这里必须同时看 openStep 和 pendingCalls —— 单看 openStep 是错的，
  // 实测（同一秒内采样）：
  //   模型思考 / 生成文本时：openStep = {turn,step}   pendingCalls = []
  //   工具真正执行时：        openStep = **NULL**      pendingCalls = [bash]
  // 也就是说工具执行期间 dsh 把 openStep 清空了，只看 openStep 会让「正在跑
  // 命令、正在调工具」的会话显示成空闲，灯就灭了。这正是要修的 bug。
  const toolRunning = pendingCalls.length > 0;

  // 「这一轮任务还没结束」—— 用户发起的 turn 仍在进行中。
  const openTurn = turnBoundary?.openTurnStartSeq !== undefined &&
    turnBoundary?.openTurnStartSeq !== null;

  // 是否还在干活。
  //
  // 三个信号取或，缺一不可：
  //   openStep    模型正在某个 step 里（思考 / 生成）
  //   pendingCalls 工具正在跑（此时 openStep 已经被清空）
  //   openTurn    这一轮任务还没结束（覆盖 step 之间那几毫秒的空档）
  //
  // 前两个是之前就有的；openTurn 是后补的，用来堵住一个真实空档：
  // 实测在两次 step 交界处会出现 openStep=null **且** pendingCalls 为空，
  // 那一刻如果只看前两个信号就会把「正在跑的会话」判成空闲，屏幕闪一下全灭。
  // 60 秒采样里旧逻辑误判 1 次（0.10%），加上 openTurn 之后是 0 次。
  const working = Boolean(openStep) || toolRunning || openTurn;

  // 距离最后一次活动过了多久。
  //
  // 用会话投影文件的 mtime 当「最后一次活动时间」—— 实测空闲会话的 mtime
  // 完全静止（3 分钟采样，5 个旧会话的时间戳一个没动），只有真正在推进的
  // 会话会被重写，所以它等价于「这个会话最后一次干活的时间」。
  const idleMs = mtimeMs > 0 ? Math.max(0, Date.now() - mtimeMs) : Infinity;

  // 模型连接失败：llmRetry 里有任何条目就说明当前正在重试。
  // 取最大重试次数用于显示（retry 从 1 开始递增）。
  const retryEntries = Object.values(llmRetry ?? {}).filter(
    (entry) => entry !== null && typeof entry === 'object',
  );
  const failing = retryEntries.length > 0;
  const retryCount = failing
    ? Math.max(...retryEntries.map((entry) => Number(entry.retry) || 0))
    : 0;

  // 六态灯号，优先级从上到下：
  //   fail 模型连接失败  → 红色闪烁（最该看，压过一切）
  //   ask  询问用户      → 黄色闪烁（要人管）
  //   tool 正在调用工具  → 橙色常亮（跑命令 / 等命令反馈）
  //   run  正在执行      → 蓝色常亮（模型在思考、生成内容）
  //   done 任务完成      → 绿色常亮（这一轮刚正常结束，且不超过 90 秒）
  //   idle 空闲          → 灭灯
  //
  // tool 排在 run 前面：工具执行是「外部世界正在干活」，比模型思考更需要盯。
  // working 排在 done 前面：还在跑的时候橙/蓝比绿更符合实际，等它真停下来才转绿。
  //
  // 绿灯只亮 DONE_HOLD_MS（默认 90 秒）：任务刚跑完先保持绿灯让你能瞥见
  // 「它完成了」，过了这段时间就归到空闲（灭灯）。绿灯表达的是「刚刚发生的
  // 事」，不是历史留痕 —— 否则一旦所有任务都完成，整屏就是一片常亮绿灯。
  //
  // 判定「刚结束」不靠 todos，而是靠 **step 边界事件**：
  //   turnBoundary.lastStepBoundary.kind === 'end'
  // 表示最后一个 step 是正常结束的（不是被中断 / 出错）。这个信号每个会话都有，
  // 而 todos 是**可选的** —— 很多会话压根没调用过 todo_write（实测本机全部
  // 会话的 todos 都是 0/0），靠 todos 判绿灯会让这些会话永远见不到绿灯。
  //
  // 之前用 `todos.total > 0 && todos.done >= todos.total` 就是这个毛病：
  // 我这一轮跑了几百个 step 干完活，因为没用 todo_write，灯直接 idle，
  // 从橙跳到灭，中间的绿灯完全没出现过。
  const allTodosDone = todos.total > 0 && todos.done >= todos.total;
  const finishedByBoundary = turnBoundary?.lastStepBoundary?.kind === 'end';
  // 有 todo 的会话按 todo 判（更精确）；没有 todo 的退回 step 边界判。
  const justDone = allTodosDone || (todos.total === 0 && finishedByBoundary);
  const justFinished = justDone && idleMs < DONE_HOLD_MS;
  const ledState = failing
    ? 'fail'
    : asking
      ? 'ask'
      : toolRunning
        ? 'tool'
        : working
          ? 'run'
          : justFinished
            ? 'done'
            : 'idle';

  return {
    sessionId,
    title,
    isSubagent,
    subagentLabel: isSubagent ? String(subagent.identity.label ?? '') : '',
    ledState,
    asking,
    failing,
    retryCount,
    working,
    toolRunning,
    // 正在跑的工具名（上屏显示「正在执行 bash」之类），没有就是空串
    runningTool: toolRunning ? String(pendingCalls[pendingCalls.length - 1].name ?? '') : '',
    prompt: clip(lastPrompt, 60),
    firstPrompt: clip(firstPrompt, 60),
    updatedAt: mtimeMs,
    // 当前正在做的事：优先 todo 的 in_progress，其次最近一条未完成项
    current: clip(
      todos.active ??
        todos.items.find((item) => item.status !== 'completed')?.content ??
        (plan.active ? '规划中' : '') ??
        '',
      46,
    ),
    todos,
    model,
    turn: stats.lastTurn ?? 0,
    step: openStep?.step ?? stats.steps ?? 0,
    steps: stats.steps ?? 0,
    busy: Boolean(openStep),
    planActive: Boolean(plan.active),
    tokensIn,
    tokensOut,
    contextPercent:
      pressure.contextWindow > 0
        ? Math.round((pressure.pressureTokens / pressure.contextWindow) * 100)
        : undefined,
    // 生成速率（tok/s）：累计输出 token / 累计解码耗时。
    // 这是**整个会话的平均值**，不是瞬时速度 —— dsh 只投影累计量，
    // 没有逐 step 的采样，所以算不出瞬时值。实测约 199 tok/s，和 UI 一致。
    tokensPerSec:
      stats.decodeMs > 0
        ? Math.round((stats.decodeTokens / stats.decodeMs) * 1000)
        : undefined,
    team: { total: teamTasks.length, done: teamDone },
    llmMs: stats.llmMs ?? 0,
    toolMs: stats.toolMs ?? 0,
  };
}

/**
 * 从多个活跃会话里挑「最值得上屏」的那个（单任务视图用）。
 *
 * 只按 mtime 排序会出错：别的标签页里刚碰过的空会话会把正在跑任务的那个挤掉。
 * 所以先按「有没有在推进的 todo / 是不是正在跑一步」加权，再用 mtime 破平。
 *
 * 归档和子代理一律不参与挑选 —— 它们不该顶掉你真正在看的会话。
 *
 * @param {{ file: string, mtimeMs: number }[]} live
 */
async function pickBest(live) {
  const registry = await readRegistry();
  const scored = [];
  for (const item of live) {
    if (!isVisibleSession(path.basename(item.file, '.json'), registry)) continue;
    let progress;
    try {
      progress = await readProgress(item.file, item.mtimeMs);
    } catch {
      continue;
    }
    if (progress.isSubagent) continue;
    let score = 0;
    if (progress.todos.items.some((todo) => todo.status === 'in_progress')) score += 100;
    if (progress.todos.total > 0) score += 40;
    if (progress.busy) score += 30;
    if (progress.team.total > 0) score += 10;
    // mtime 归一化到 0..9，只当破平用
    score += Math.max(0, 9 - (Date.now() - item.mtimeMs) / 60_000);
    scored.push({ progress, score });
  }
  if (scored.length === 0) return undefined;
  scored.sort((a, b) => b.score - a.score);
  return scored[0].progress;
}

/**
 * 列出**最近运行的**若干个会话，供多任务列表上屏。
 *
 * 排序：纯按最近运行时间（会话投影文件的 mtime）倒序。
 * 「最近运行」就是文件最后一次被写的时间 —— dsh 每次推进都会重写投影，
 * 所以它等价于「你最近碰过 / 它最近干过活的会话」。
 *
 * 之所以不再用「busy 加分」那套权重：副屏是给自己看的时间线，正在跑的自然
 * 会因 mtime 最新排在最前；权重反而会让一个早就没动过的 busy 残留顶在上面。
 *
 * 过滤三类：
 *   1. **已归档的会话**（读 ~/.dsh/storages/workspace.json 的 global.archivedSessionIds）
 *      —— 归档的语义就是「从列表里隐藏」，副屏同样不该显示。
 *   2. 子代理会话（subagent 派生的），除非显式 includeSubagents
 *   3. 超过 windowMs 没动过的
 *
 * @param {{limit?: number, windowMs?: number, includeSubagents?: boolean}} [options]
 *   limit            最多几个（默认 6）
 *   windowMs         只看最近这么久内运行过的会话（默认 12 小时）
 *   includeSubagents 是否把子代理会话也算进来（默认 false）
 * @returns {Promise<object[]>}
 */
export async function listTasks(options = {}) {
  const limit = Math.max(1, Math.min(12, options.limit ?? 6));
  const windowMs = options.windowMs ?? 12 * 60 * 60 * 1000;
  const includeSubagents = options.includeSubagents === true;

  const files = await listSessionFiles();
  const stats = await Promise.all(
    files.map(async (file) => {
      try {
        const info = await stat(file);
        return { file, mtimeMs: info.mtimeMs };
      } catch {
        return undefined;
      }
    }),
  );

  const now = Date.now();
  // 过滤发生在读取之后，所以要多预取一些，否则一堆子代理/归档会话会把窗口
  // 占满、把真正要显示的挤出去。
  const prefetch = includeSubagents ? limit * 3 : Math.max(limit * 3, 24);
  const recent = stats
    .filter((item) => item !== undefined && now - item.mtimeMs < windowMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, prefetch);

  const registry = await readRegistry();

  const tasks = [];
  for (const item of recent) {
    const sessionId = path.basename(item.file, '.json');
    // 只显示工作区里登记过、且没归档的会话（见 readRegistry 的说明）
    if (!isVisibleSession(sessionId, registry)) continue;
    try {
      const task = await readProgress(item.file, item.mtimeMs);
      if (!includeSubagents && task.isSubagent) continue;
      tasks.push(task);
    } catch {
      // 单个会话读失败不影响整屏
    }
  }

  // 排序：**需要人介入的一律顶置，其余按最近运行时间倒序。**
  //
  // 只有 4 行可见高度，而列表按 mtime 排序 —— 一个正在等回答的会话如果不
  // 主动刷新自己的投影文件（它确实不会：ask_user_question 挂在那里，日志和
  // 投影都不再变化），mtime 就会冻结，于是每多一个别的会话在跑，它就被往下
  // 挤一行，最终掉出第 4 行、彻底消失。实测 4 个并发会话时，ask 正好落在
  // 第 4 位；再有一个会话动一下，橙闪就看不见了 —— 而它恰恰是最需要你看到
  // 的那个（人不动手，那个会话就一直卡着）。
  //
  // 所以按「要不要人管」分组，组内仍按最近运行倒序：
  //   0. fail 模型连接失败 —— 需要你换 provider / 查网络
  //   1. ask  正在询问用户 —— 需要你回答
  //   2. 其余      —— 它自己在干活，埋掉无所谓
  const priority = (task) => {
    if (task.ledState === 'fail') return 0;
    if (task.ledState === 'ask') return 1;
    return 2;
  };
  tasks.sort((a, b) => {
    const diff = priority(a) - priority(b);
    if (diff !== 0) return diff;
    return b.updatedAt - a.updatedAt;
  });
  return tasks.slice(0, limit);
}

/**
 * 便利入口：取最值得上屏的活跃会话的进度。
 * @param {{ sessionId?: string }} [options] 指定 sessionId 时只看那一个
 */
export async function latestProgress(options = {}) {
  const live = await findLiveSessions();
  if (live.length === 0) return undefined;
  if (options.sessionId) {
    const match = live.find((item) =>
      path.basename(item.file, '.json').includes(options.sessionId),
    );
    return match === undefined ? undefined : readProgress(match.file, match.mtimeMs);
  }
  return pickBest(live);
}
