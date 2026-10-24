/**
 * dsh-odospace 插件（Host 半边）。
 *
 * 把原项目 dsh-odospace 从「一个 systemd 常驻的 CLI 脚本」变成 Harness 内的
 * 一个插件：随 profile 一起加载、配置写在 `cordis.patch.yml`、Web UI 里有一页
 * 实时面板可以看，模型也可以用工具去查/推。
 *
 * 三块能力：
 *   1. **推流引擎** —— `engine.js`，照搬原 bridge.mjs 的灯效/轮询逻辑，
 *      定时渲染 dsh 任务进度并推到 Odospace 接收端（手机 Remote Panel）。
 *   2. **同源 API** —— `GET /dsh-odospace/api`，给 UI 页面读实时状态；
 *      `POST /dsh-odospace/api/push` 让页面手动推一帧。
 *   3. **工具** —— `odospace_panel`：status 看状态、preview 出图、
 *      push 立即推一帧。默认 **不注册**（`tool: false`），避免给每步请求
 *      加 schema；需要时在配置里打开。
 *
 * AIDA64 直连手机推 page 0，本插件只负责 page 1，两者互不知情 —— 详见原项目 README。
 *
 * @module @mulbu/dsh-odospace
 */

import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createBridge, visibleTasks } from './engine.js';

/** 同源路由前缀：UI 页面和工具共用。 */
const ROUTE_PREFIX = '/dsh-odospace/api';
/** 本插件在 profile patch 层里的行 id（configEditor 用它定位配置）。 */
const ROW_ID = 'dsh-odospace';

/** Cordis 插件名；与 cordis.patch.yml 的行 id 一致。 */
export const name = 'dsh-odospace';

/**
 * 客户端订阅项。这里**不声明 `webServer`**：纯对话部署没有这个服务时，
 * 插件应当安静地不激活推流，而不是抛错阻止整个 profile 加载。
 */
export const inject = [];

/**
 * 配置字段表：**唯一事实来源**。
 *
 * 三项共用它：Cordis 的 `Config`（Schemastery）、`resolveConfig()` 的归一化、
 * 以及拒绝未知键的检查。加一个字段只改这一处。
 *
 * `kind` 决定 Schemastery 构建器与默认值类型；`min`/`max` 只对 number 生效。
 */
const FIELDS = [
  { key: 'enabled', kind: 'boolean', default: true, description: '是否启动推流引擎。关掉后只保留 UI 页面。' },
  { key: 'host', kind: 'string', default: '', description: 'Odospace 接收端 IP。留空 = 不启动推流。' },
  { key: 'port', kind: 'number', default: 38000, min: 1, max: 65535, description: 'Odospace 端口。' },
  { key: 'page', kind: 'number', default: 1, min: 0, max: 9, description: 'dsh 进度写到第几页 0..9。AIDA64 直连手机时用 page 0，这里保持 1。' },
  { key: 'size', kind: 'string', default: '1350x720', description: '面板分辨率，任意 "WxH"。' },
  { key: 'tasks', kind: 'number', default: 4, min: 0, max: 8, description: '列表视图显示几个会话；0 = 单任务大字号视图。' },
  { key: 'includeSubagents', kind: 'boolean', default: false, description: '把子代理会话也算进列表。' },
  { key: 'fps', kind: 'number', default: 1, min: 0, max: 12, description: '灯效开关。>0 = 开启（红/橙闪 0.5 秒一次）；0 = 只在内容变化时推一帧。' },
  { key: 'quality', kind: 'number', default: 60, min: 1, max: 100, description: 'JPEG 质量 1..100。' },
  { key: 'alwaysPush', kind: 'boolean', default: true, description: '每轮都重推（不做内容去重）。手机端靠“收到新帧”判断在线。' },
  { key: 'idleFrames', kind: 'boolean', default: false, description: '没有活跃会话时也推「空闲」帧。' },
  { key: 'checkIntervalMs', kind: 'number', default: 2000, min: 500, max: 60000, description: '多久重新读一次会话投影文件（ms）。' },
  { key: 'intervalMs', kind: 'number', default: 2000, min: 500, max: 60000, description: 'fps = 0 时的轮询间隔（ms）。' },
  { key: 'dryRun', kind: 'boolean', default: false, description: '只渲染不推送（调版面用）。' },
  { key: 'out', kind: 'string', default: '', description: '把每帧额外落盘到这个路径（调试用）。留空 = 不落盘。' },
  { key: 'serve', kind: 'number', default: 0, min: 0, max: 65535, description: '另外开一个带 token 的 HTTP 接口。0 = 不开。' },
  { key: 'serveHost', kind: 'string', default: '127.0.0.1', description: 'serve 的绑定地址；让局域网里的 Windows 推数据要设 0.0.0.0。' },
  { key: 'serveToken', kind: 'string', default: '', description: 'serve 的鉴权 token（会写进 patch，不推荐）。' },
  { key: 'serveTokenFile', kind: 'string', default: '', description: '从文件读 serve token，格式 `DSH_ODO_SERVE_TOKEN=<token>`。' },
  { key: 'tool', kind: 'boolean', default: false, description: '注册 `odospace_panel` 工具（status/preview/push）。' },
];

/** 每种 kind 对应的 Schemastery 构建器。 */
const BUILDERS = {
  boolean: (z) => z.boolean(),
  number: (z, field) => {
    let schema = z.number();
    if (field.min !== undefined) schema = schema.min(field.min);
    if (field.max !== undefined) schema = schema.max(field.max);
    return schema;
  },
  string: (z) => z.string(),
};

/**
 * 不依赖 Schemastery 的最小 `~standard` 校验器。
 *
 * Cordis 只需要 `Config['~standard'].validate(raw)`，同步返回 `{value}` 或
 * `{issues}`。插件是本地包、依赖解析随部署方式变（pnpm 的 workspace 本地依赖
 * 一律软链，软链让 Node 从**真实路径**解析，于是 `@deepseek-ai/schemastery`
 * 可能找不到），所以要有一条不依赖包解析的回退路径。
 *
 * @param {Array<object>} fields 字段表
 */
function plainSchema(fields) {
  return {
    '~standard': {
      version: 1,
      vendor: 'dsh-odospace',
      validate(raw) {
        const input = raw === null || typeof raw !== 'object' ? {} : raw;
        const value = {};
        const issues = [];
        for (const field of fields) {
          const current = input[field.key];
          if (current === undefined) {
            value[field.key] = field.default;
            continue;
          }
          if (typeof current !== field.kind) {
            issues.push({ message: `${field.key} 必须是 ${field.kind}`, path: [field.key] });
            continue;
          }
          if (field.kind === 'number' && ((field.min !== undefined && current < field.min) || (field.max !== undefined && current > field.max))) {
            issues.push({
              message: `${field.key} 必须在 ${field.min}..${field.max} 之间`,
              path: [field.key],
            });
            continue;
          }
          value[field.key] = current;
        }
        // Schemastery 会保留未知字段，这里保持一致：归一化那层再用 unknownKeys() 报出来。
        for (const key of Object.keys(input)) {
          if (!(key in value)) value[key] = input[key];
        }
        return issues.length > 0 ? { issues } : { value };
      },
    },
  };
}

/**
 * 解析 Schemastery。
 * @returns {Promise<object | undefined>} 命名空间；undefined 表示用回退实现
 */
async function loadSchemastery() {
  for (const specifier of resolveCandidates('@deepseek-ai/schemastery', 'lib', 'index.mjs')) {
    try {
      const module = await import(specifier);
      const loaded = module.default ?? module;
      if (typeof loaded?.object === 'function') return loaded;
    } catch {
      /* 试下一个 */
    }
  }
  return undefined;
}

/** Schemastery 命名空间，异步解析后填上；解析完成前 apply 不会跑。 */
let z;

/** 用已知的 Schemastery（或回退实现）构建 Config。 */
function buildConfig() {
  if (z === undefined) return plainSchema(FIELDS);
  const shape = {};
  for (const field of FIELDS) {
    shape[field.key] = BUILDERS[field.kind](z, field).default(field.default).description(field.description);
  }
  return z.object(shape);
}

/**
 * 配置 Schema。
 *
 * 导出时先用回退实现占位（这样 `import` 到 `apply` 之间 `Config` 一定可用），
 * `apply` 里会用真正的 Schemastery 重建一次 —— 重建前的校验走回退实现，
 * 两者的**接受集合相同**（同源 FIELDS），所以行为一致。
 */
export let Config = buildConfig();

/**
 * 解析并安装真正的 Schemastery。失败时保留回退实现。
 * @returns {Promise<void>}
 */
export async function installConfig() {
  if (z !== undefined) return;
  const loaded = await loadSchemastery();
  if (loaded === undefined) return;
  z = loaded;
  Config = buildConfig();
}

/** 已知字段名，用于拒绝拼错的配置键。 */
const KNOWN_KEYS = new Set(FIELDS.map((field) => field.key));

/**
 * 拒绝未知配置字段。
 *
 * Schemastery 的 object() 会把未知字段原样带过去，所以 `hosst: '1.2.3.4'` 这种
 * 拼错会静默变成「host 未配置、不推流」，很难查。这里显式报出来。
 *
 * @param {object | undefined} config 行配置
 * @returns {string[]} 未知字段名
 */
export function unknownKeys(config) {
  if (config === null || typeof config !== 'object') return [];
  return Object.keys(config).filter((key) => !KNOWN_KEYS.has(key));
}

/** 取一个字符串配置项；空白视为未设置。 */
function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

/** 取一个数字配置项并夹在范围内。 */
function number(value, fallback, min, max) {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/**
 * 解析 `"1350x720"`。解析失败的项退回 1350x720（原项目的默认值），
 * 而不是抛错 —— 一个笔误不该让整个插件不激活。
 */
function parseSize(value) {
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(text(value, '1350x720'));
  if (match === null) return [1350, 720];
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return [1350, 720];
  return [Math.min(8192, width), Math.min(8192, height)];
}

/**
 * 从 `DSH_ODO_SERVE_TOKEN=<token>` 形式的文件里读 token。
 *
 * 这样 token 不用写进 `cordis.patch.yml`（它会被提交/备份），沿用原项目
 * `~/.config/dsh-odospace/token.env` 的约定即可。
 *
 * @param {string} file 路径；支持 `~/` 前缀。读不到就返回 undefined。
 */
async function readTokenFile(file) {
  if (file === '') return undefined;
  const target = file.startsWith('~') ? path.join(homedir(), file.slice(1)) : file;
  try {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(target, 'utf8');
    const match = /^\s*(?:export\s+)?DSH_ODO_SERVE_TOKEN\s*=\s*(.+?)\s*$/m.exec(content);
    if (match === null) return undefined;
    return match[1].replace(/^(['"])(.*)\1$/, '$2');
  } catch {
    return undefined;
  }
}

/**
 * 把插件配置归一化成一个普通对象。
 * @param {object | undefined} config Loader 传进来的行配置（已按 Config 校验）
 */
export function resolveConfig(config = {}) {
  const serveTokenFile = text(config.serveTokenFile);
  const [width, height] = parseSize(config.size);
  return {
    enabled: config.enabled !== false,
    host: text(config.host),
    port: number(config.port, 38000, 1, 65535),
    page: number(config.page, 1, 0, 9),
    size: [width, height],
    tasks: number(config.tasks, 4, 0, 8),
    includeSubagents: config.includeSubagents === true,
    fps: number(config.fps, 1, 0, 12),
    quality: number(config.quality, 60, 1, 100),
    alwaysPush: config.alwaysPush !== false,
    idleFrames: config.idleFrames === true,
    checkIntervalMs: number(config.checkIntervalMs, 2000, 500, 60000),
    intervalMs: number(config.intervalMs, 2000, 500, 60000),
    dryRun: config.dryRun === true,
    out: text(config.out),
    serve: number(config.serve, 0, 0, 65535) || undefined,
    serveHost: text(config.serveHost, '127.0.0.1'),
    serveToken: text(config.serveToken),
    serveTokenFile,
    tool: config.tool === true,
  };
}

/** 用一个普通 logger 形状适配 Cordis 的 ctx.logger。 */
function makeLogger(ctx) {
  const emit = (level, event) => {
    const suffix =
      event.tally === undefined
        ? ''
        : `（红 ${event.tally.fail} / 橙 ${event.tally.tool} / 蓝 ${event.tally.run}` +
          ` / 绿 ${event.tally.done} / 橙闪 ${event.tally.ask} / 灭 ${event.tally.idle}）`;
    const message = `dsh-odospace: ${event.message}${suffix}`;
    if (level === 'warn') ctx.logger?.warn?.(message);
    else if (level === 'debug') ctx.logger?.debug?.(message);
    else ctx.logger?.info?.(message);
  };
  return (event) => emit(event.level ?? 'info', event);
}

/**
 * 注册 `odospace_panel` 工具。
 *
 * 三条动作：
 *   - `status`：返回当前面板配置、任务六态统计、推送计数。
 *   - `preview`：渲染一帧并按需落盘，返回路径和字节数。
 *   - `push`：立即渲染并推送一帧到接收端。
 *
 * @param {object} ctx Cordis 上下文
 * @param {{ bridge: object }} deps
 */
function registerTool(ctx, { bridge }) {
  /** 预览图落到临时目录：模型可以用 read_image 直接看。 */
  const previewPath = () => path.join(homedir(), '.dsh-odospace-preview.jpg');

  return ctx.tools.register(
    defineTool({
      name: 'odospace_panel',
      description:
        'Inspect or drive the Odospace status panel this machine pushes to (dsh task progress → a phone Remote Panel). ' +
        'Use action=status to read the live panel config and per-task LED states; ' +
        'action=preview to render one frame to a JPEG file so it can be viewed; ' +
        'action=push to force one frame to the receiver immediately.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['status', 'preview', 'push'],
          description: 'status (read state) | preview (render one frame to a file) | push (send one frame now).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ok: { type: 'boolean', required: true },
            action: { type: 'string', required: true },
            text: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: String(value.text ?? '') }],
      },
      async execute(args) {
        const config = bridge.config;

        if (args.action === 'preview') {
          const frame = await bridge.renderPreview();
          const file = previewPath();
          const { writeFile } = await import('node:fs/promises');
          await writeFile(file, frame);
          return {
            ok: true,
            action: 'preview',
            file,
            bytes: frame.length,
            text: `已渲染一帧 ${config.size[0]}x${config.size[1]}，${frame.length} 字节 → ${file}`,
          };
        }

        if (args.action === 'push') {
          const result = await bridge.pushNow();
          return {
            ok: true,
            action: 'push',
            ...result,
            text: result.dryRun
              ? `dry-run 已开启，只渲染未推送（${result.bytes} 字节）。`
              : `已推送一帧 ${result.bytes} 字节 → ${config.host}:${config.port} page=${config.page}（累计 ${result.pushed} 帧）。`,
          };
        }

        // status
        const tasks = await listPanelTasks(config);
        const tally = tallyOf(tasks);
        const stats = bridge.stats;
        const lines = [
          `接收端 ${config.host === '' ? '(未配置)' : `${config.host}:${config.port}`} page=${config.page}`,
          `面板 ${config.size[0]}x${config.size[1]}，列表 ${config.tasks} 条，fps=${config.fps}，dryRun=${config.dryRun}`,
          `推送 ${stats.pushed} 帧 / 渲染 ${stats.rendered} 帧 / 失败 ${stats.pushErrors} 次`,
          stats.lastError === null ? null : `最近错误：${stats.lastError}`,
          '',
          `当前任务（红 ${tally.fail} / 橙 ${tally.tool} / 蓝 ${tally.run} / 绿 ${tally.done} / 橙闪 ${tally.ask} / 灭 ${tally.idle}）：`,
          ...tasks.map(
            (task) => `- [${task.ledState}] ${task.title || '(无标题)'} — ${task.current || ''}`,
          ),
        ].filter((line) => line !== null);
        return {
          ok: true,
          action: 'status',
          config,
          tasks,
          tally,
          stats,
          text: lines.join('\n'),
        };
      },
    }),
  );
}

/**
 * 页面上要显示的任务列表 —— 必须和推流用的是**同一份过滤逻辑**，
 * 否则页面上会多出面板上根本没有的「未命名任务」行。
 */
async function listPanelTasks(config) {
  return visibleTasks({
    limit: config.tasks > 0 ? config.tasks : 4,
    includeSubagents: config.includeSubagents,
  }).catch(() => []);
}

/** 与 engine.js 保持同一套六态统计（工具里用，避免重复 import）。 */
function tallyOf(tasks) {
  const tally = { fail: 0, tool: 0, run: 0, done: 0, ask: 0, idle: 0 };
  for (const task of tasks) {
    if (task.ledState in tally) tally[task.ledState] += 1;
  }
  return tally;
}

/**
 * `defineTool` 从 `@deepseek-ai/dsh-tools` 拿。插件包不声明这个依赖（它由 dsh
 * 自身提供，profile 里按解析路径可见），所以这里做一次延迟、可失败的 import：
 * 拿不到就跳过工具注册，**推流和 UI 页面照常工作**。
 */
async function loadDefineTool() {
  for (const specifier of resolveCandidates('@deepseek-ai/dsh-tools', 'lib', 'index.js')) {
    try {
      const module = await import(specifier);
      if (typeof module.defineTool === 'function') return module.defineTool;
    } catch {
      /* 试下一个 */
    }
  }
  return undefined;
}

/**
 * 一个 `@deepseek-ai/*` 包的可能入口：先包名，再 profile 的 node_modules，
 * 最后 dsh 安装目录（`<root>/lib/node_modules/@deepseek-ai/dsh/node_modules/...`）。
 *
 * pnpm 的 workspace 本地依赖一律软链，软链让 Node 从真实路径解析，所以包名
 * 那一步对本地插件不保证成功 —— 后面两个位置才是稳的。
 *
 * @param {string} pkg 包名
 * @param {...string} tail 包内路径
 * @returns {string[]} 依次尝试的 specifier
 */
function resolveCandidates(pkg, ...tail) {
  const at = (...segments) => pathToFileURL(path.join(...segments)).href;
  const [scope, name] = pkg.split('/');
  const dshRoot = path.dirname(path.dirname(process.execPath));
  const candidates = [pkg];
  if (process.env.DSH_PROFILE_DIR) {
    candidates.push(at(process.env.DSH_PROFILE_DIR, 'node_modules', scope, name, ...tail));
  }
  candidates.push(
    at(dshRoot, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', scope, name, ...tail),
    at(dshRoot, 'lib', 'node_modules', scope, name, ...tail),
  );
  return candidates;
}

/** 工具注册需要 `defineTool`，它在 apply 里是异步取的，所以这里做一个缓存。 */
let defineTool = undefined;

/**
 * 设置页的写入口：**只允许改这三类运行时可调项**。
 *
 * 用户在页面上改的是「推送到哪、推第几页、列几行」这种日常调整；改完要立刻
 * 生效，不能要求重启 dsh。所以这里做两步：
 *
 *   1. `configEditor.edit()` —— 把新值写进 profile 的 patch 层，让设置在
 *      重启后还在（否则内存里改了、一重启又退回文件里的旧值）。
 *   2. `bridge.update()` —— 原地换掉运行中的目标/页号/行数，下一个推送周期
 *      就按新值跑，不中断推流。
 *
 * 第 1 步失败（例如没有 configEditor 服务、或 patch 是只读的）时仍然做第 2 步：
 * 本次运行照新值走，只是重启后会退回文件里的值 —— 并在响应里说明，不静默。
 *
 * @param {object} ctx 插件上下文
 * @param {object} bridge 运行中的桥
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
async function handleSettings(ctx, bridge, request, response) {
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

  // 会话标题级别的数据同样不走这里，但设置同样是同源才有意义
  const origin = request.headers.origin;
  const hostHeader = request.headers.host;
  if (
    request.headers['sec-fetch-site'] === 'cross-site' ||
    (origin !== undefined && hostHeader !== undefined && new URL(origin).host !== hostHeader)
  ) {
    return json(403, { ok: false, error: 'forbidden' });
  }

  /**
   * 严格校验一个整数输入。
   *
   * 这里**不能**用 `number()` —— 它是给配置文件兜底的，会把超范围的值夹到边界
   * （`port: 99999` 变成 65535）。设置页面对的是人，越界必须报错：悄悄改成
   * 65535 会让人对着一个自己没填过的端口找半天。
   *
   * @param {unknown} value 用户输入
   * @param {number} min 下界
   * @param {number} max 上界
   * @returns {number | undefined} 合法时返回整数，否则 undefined
   */
  const strictInt = (value, min, max) => {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (typeof value === 'boolean' || value === null || value === '') return undefined;
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return undefined;
    if (parsed < min || parsed > max) return undefined;
    return parsed;
  };

  /** 页面能改的字段白名单：字段名 -> 严格校验。 */
  const EDITABLE = {
    host: (value) => (typeof value === 'string' ? value.trim() : undefined),
    port: (value) => strictInt(value, 1, 65535),
    page: (value) => strictInt(value, 0, 9),
    tasks: (value) => strictInt(value, 0, 8),
    // `"1350x720"` or `"1350 x 720"`; anything else is rejected rather than
    // silently falling back, so a typo cannot resize the panel behind your back.
    size: (value) => {
      if (typeof value !== 'string') return undefined;
      const match = /^\s*(\d{2,5})\s*[x×*]\s*(\d{2,5})\s*$/i.exec(value);
      if (match === null) return undefined;
      const width = Number(match[1]);
      const height = Number(match[2]);
      if (width < 64 || width > 8192 || height < 64 || height > 8192) return undefined;
      return `${width}x${height}`;
    },
  };

  if (request.method === 'GET' || request.method === 'HEAD') {
    const live = bridge.config;
    return json(200, {
      ok: true,
      settings: {
        host: live.host,
        port: live.port,
        page: live.page,
        tasks: live.tasks,
        size: `${live.size[0]}x${live.size[1]}`,
      },
      bounds: {
        port: { min: 1, max: 65535 },
        page: { min: 0, max: 9 },
        tasks: { min: 0, max: 8, hint: '0 = 单任务大字号视图' },
        size: { min: 64, max: 8192, hint: '格式 WxH，例如 1350x720' },
      },
      // 保存到 patch 层需要 configEditor；没有就只做内存热更新
      persistable: typeof ctx.get?.('configEditor')?.edit === 'function',
    });
  }

  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'GET, HEAD, POST' });
    response.end();
    return undefined;
  }

  // 读请求体
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) {
      response.writeHead(413).end();
      return undefined;
    }
    chunks.push(chunk);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch (error) {
    return json(400, { ok: false, error: `bad json: ${error.message}` });
  }

  // 只取白名单字段并归一化
  const next = {};
  const rejected = [];
  for (const [key, normalize] of Object.entries(EDITABLE)) {
    if (payload[key] === undefined) continue;
    const value = normalize(payload[key]);
    if (value === undefined) {
      rejected.push({ key, value: payload[key] });
      continue;
    }
    next[key] = value;
  }
  if (rejected.length > 0) {
    return json(400, { ok: false, error: 'invalid values', rejected });
  }
  if (Object.keys(next).length === 0) {
    return json(400, { ok: false, error: 'no editable field in body' });
  }

  // 第一步：持久化到 patch 层（让重启后仍然有效）
  const editor = ctx.get?.('configEditor');
  let persisted = false;
  let persistError;
  if (typeof editor?.edit === 'function') {
    try {
      const rows = editor.entries();
      const entry = rows.find((candidate) => candidate.options?.id === ROW_ID);
      if (entry === undefined) {
        const seen = rows.map((candidate) => candidate.options?.id).filter(Boolean);
        throw new Error(`找不到 patch 行 ${ROW_ID}（可见行: ${seen.slice(0, 12).join(', ') || '无'}）`);
      }
      await editor.edit(entry, (current) => ({ ...current, ...next }));
      persisted = true;
    } catch (error) {
      persistError = String(error?.message ?? error);
      ctx.logger?.warn?.(`dsh-odospace: 保存设置失败（仅本次运行生效）：${persistError}`);
    }
  } else {
    persistError = 'configEditor 服务不可用';
  }

  // 第二步：热更新运行中的桥
  // `size` arrives as a normalised "WxH" string; the engine works in tuples.
  const patch = { ...next };
  if (typeof patch.size === 'string') {
    const [width, height] = patch.size.split('x').map(Number);
    patch.size = [width, height];
  }
  const result = bridge.update(patch);

  return json(200, {
    ok: true,
    applied: result.changed,
    persisted,
    ...(persistError === undefined ? {} : { persistError }),
    settings: bridge.config.snapshot(),
  });
}

/**
 * Host 插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config Loader 校验过的行配置
 */
export function apply(ctx, config) {
  // Schemastery 会放行未知字段，所以拼错的键在这里报出来 —— 否则
  // `hosst: '1.2.3.4'` 会静默变成「未配置 host、不推流」。
  const unknown = unknownKeys(config);
  if (unknown.length > 0) {
    ctx.logger?.warn?.(
      `dsh-odospace: 配置里有未知字段 ${unknown.map((key) => `"${key}"`).join(', ')}，已被忽略`,
    );
  }

  const resolved = resolveConfig(config);
  const log = makeLogger(ctx);

  if (!resolved.enabled) {
    log({ level: 'info', message: 'enabled=false，推流引擎不启动（UI 页面仍可用）' });
  } else if (resolved.host === '') {
    log({
      level: 'warn',
      message: 'host 未配置，不启动推流引擎。在 cordis.patch.yml 的 dsh-odospace 行里设置 host。',
    });
  }

  // token 文件是异步读的，所以整块放进一个 async 初始化里；
  // ctx.effect 负责把 push 出来的 disposer 挂到插件生命周期上。
  let bridge;
  let disposed = false;

  const ready = (async () => {
    // Config 在模块加载时用的是回退校验器（见 buildConfig 的说明）；Loader 已经
    // 用它校验过行配置了，这里切到真正的 Schemastery，让「配置注入」界面能拿到
    // 完整 schema（类型、范围、描述）。
    await installConfig().catch(() => {});

    if (resolved.serveToken === '' && resolved.serveTokenFile !== '') {
      const fromFile = await readTokenFile(resolved.serveTokenFile);
      if (fromFile !== undefined) resolved.serveToken = fromFile;
      else log({ level: 'warn', message: `读不到 serveTokenFile: ${resolved.serveTokenFile}` });
    }

    if (disposed) return undefined;
    bridge = createBridge(resolved, { log });
    if (resolved.enabled && resolved.host !== '') bridge.start();
    return bridge;
  })();

  /** 同源 API 路由。没有 webServer 的部署（纯对话）直接跳过。 */
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() => {
        let disposeRoute = () => {};
        let cancelled = false;
        void ready
          .then((instance) => {
            if (instance === undefined || cancelled) return;
            disposeRoute = webCtx.webServer.register({
              kind: 'prefix',
              path: ROUTE_PREFIX,
              handler: async (request, response) => {
                // 设置页的读写走这里：GET /settings 读当前行配置，
                // POST /settings 校验 + 持久化 + 热更新。
                const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'x'}`);
                if (url.pathname.endsWith('/settings')) {
                  return handleSettings(ctx, instance, request, response);
                }
                return instance.handleRoute(request, response);
              },
            });
          })
          .catch((error) => {
            ctx.logger?.warn?.(`dsh-odospace: 路由注册失败 ${String(error)}`);
          });
        return () => {
          cancelled = true;
          disposeRoute();
        };
      }, 'dsh-odospace: /dsh-odospace/api');
    });
  }

  /** 可选的模型工具。默认关闭（`tool: false`），不在每步请求里加 schema 字节。 */
  if (resolved.tool && typeof ctx.inject === 'function') {
    ctx.inject(['tools'], (toolCtx) => {
      void ready
        .then(async (instance) => {
          if (instance === undefined) return;
          defineTool ??= await loadDefineTool();
          if (defineTool === undefined) {
            ctx.logger?.warn?.('dsh-odospace: 找不到 @deepseek-ai/dsh-tools，跳过 odospace_panel 工具');
            return;
          }
          toolCtx.effect(() => registerTool(toolCtx, { bridge: instance }), 'dsh-odospace: tool');
        })
        .catch((error) => {
          ctx.logger?.warn?.(`dsh-odospace: 工具注册失败 ${String(error)}`);
        });
    });
  }

  // 卸载：停掉推流循环、关掉 serve 端口。
  ctx.effect(
    () => () => {
      disposed = true;
      void ready
        .then((instance) => instance?.dispose())
        .catch(() => {});
    },
    'dsh-odospace: bridge lifecycle',
  );
}
