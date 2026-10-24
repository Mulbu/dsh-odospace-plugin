/**
 * 会话日志尾部扫描 —— 回答一个问题：**这个会话现在是不是在等用户回答？**
 *
 * 为什么不读 userQuestions 投影：
 *   dsh 的 `tool-ask-user` 插件有两种模式，`legacy`（默认）和 `timed`。
 *   只有 timed 版工具的参数里才有 `timeout` 字段，而 `userQuestions` 投影的
 *   fold 第一句就是 `if (!fold.timed) return fold` —— 本机部署的是 legacy，
 *   所以那条投影**永远是空的**。实测 39 个会话文件，`timed` 全是 false，
 *   `questions.active` 全是 []。指望它判断"正在询问用户"是不可能的。
 *
 * 所以改读会话事件日志的尾部：会话日志是
 *   ~/.dsh/sessions/<工作区分组>/<会话id>/session.v4.jsonl.zstd
 * 每批事件各自一个独立 zstd frame（可以直接单帧解压，不用整文件解），
 * 事件里 `tool/call` 带工具名、`tool/result` 带 callId。尾部里"有 call 没有
 * result"的就是还挂着的工具调用 —— 名字是 ask_user_question 就说明在等用户。
 *
 * 两个关键优化：
 *   1. 只解压尾部若干帧，从最后一帧往回走，碰到 step/turn 边界就停 ——
 *      "挂着的调用"必定在当前这个还没结束的 step 里，更早的帧不用看。
 *   2. 结果按 (size, mtime) 缓存。工具挂起期间日志不再增长，所以同一次等待
 *      只会真正扫描一次，后续轮询全部命中缓存。
 */

import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const SESSIONS_ROOT = path.join(homedir(), '.dsh', 'sessions');

/** zstd frame 的魔数（小端 0xFD2FB528），用于定位帧边界。 */
const ZSTD_MAGIC = 0xfd2fb528;

/** 每次从日志尾部读多少字节。一帧通常 1~30KB，64KB 够覆盖十几个帧。 */
const TAIL_BYTES = 64 * 1024;

/** 往回最多走多少个帧，防止畸形日志把内存吃满。 */
const MAX_FRAMES = 64;

/** 会话目录名 → 日志文件路径的索引（懒建、按需刷新）。 */
let dirIndex;

/**
 * 建立「会话目录名 → session.v4.jsonl.zstd」索引。
 *
 * 目录名和各处用的会话 id 是完全一致的（带不带 `session-` 前缀都照原样），
 * 所以直接拿 projcache 的文件名当 key 就能命中，不用去猜 cwd 的路径转义规则。
 */
async function buildDirIndex() {
  const index = new Map();
  let groups;
  try {
    groups = await readdir(SESSIONS_ROOT, { withFileTypes: true });
  } catch {
    return index;
  }
  for (const group of groups) {
    if (!group.isDirectory()) continue;
    const groupPath = path.join(SESSIONS_ROOT, group.name);
    let dirs;
    try {
      dirs = await readdir(groupPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      index.set(dir.name, path.join(groupPath, dir.name, 'session.v4.jsonl.zstd'));
    }
  }
  return index;
}

/**
 * 找某个会话的事件日志。
 * @param {string} sessionKey projcache 文件名去掉 `.json`（即会话目录名）
 * @returns {Promise<string|undefined>}
 */
export async function findSessionLog(sessionKey) {
  if (dirIndex === undefined) dirIndex = await buildDirIndex();
  const hit = dirIndex.get(sessionKey);
  if (hit !== undefined) return hit;
  // 新会话可能是在索引建好之后才出现的，重建一次再试
  dirIndex = await buildDirIndex();
  return dirIndex.get(sessionKey);
}

/** 从尾部读一段字节。文件比 limit 小时读全部。 */
async function readTail(logPath, limit) {
  const info = await stat(logPath);
  const size = Math.min(info.size, limit);
  const buffer = Buffer.alloc(size);
  const handle = await open(logPath, 'r');
  try {
    await handle.read(buffer, 0, size, info.size - size);
  } finally {
    await handle.close();
  }
  return { buffer, size: info.size, from: info.size - size };
}

/** 找出缓冲区里所有 zstd frame 的起始偏移。 */
function frameOffsets(buffer) {
  const offsets = [];
  for (let i = 0; i + 4 <= buffer.length; i += 1) {
    if (buffer.readUInt32LE(i) === ZSTD_MAGIC) offsets.push(i);
  }
  return offsets;
}

/** 解压一个 frame 里的所有 JSON 行。解不开就返回空数组（可能正在写入）。 */
function eventsOf(buffer, from, to) {
  let text;
  try {
    text = zstdDecompressSync(buffer.subarray(from, to)).toString('utf8');
  } catch {
    return [];
  }
  const events = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // 半行（正在追加）直接跳过
    }
  }
  return events;
}

/** 是不是「一个 step / turn 结束」这类边界事件。 */
function isBoundary(event) {
  const type = event?.type;
  return (
    type === 'step/start' ||
    type === 'step/end' ||
    type === 'turn/start' ||
    type === 'turn/end'
  );
}

/**
 * 扫描日志尾部，列出所有「有 tool/call 但没有对应 tool/result」的调用。
 *
 * 从最后一帧往回解压，收集到边界事件就停 —— 未结束的 step 一定在最后，
 * 再往前的帧里不会有还挂着的调用。
 *
 * @param {string} logPath
 * @returns {Promise<{callId: string, name: string}[]>}
 */
export async function pendingToolCalls(logPath) {
  let tail;
  try {
    tail = await readTail(logPath, TAIL_BYTES);
  } catch {
    return [];
  }
  const offsets = frameOffsets(tail.buffer);
  if (offsets.length === 0) return [];

  /** 从后往前收集到的事件（顺序是倒的）。 */
  const reversed = [];
  let sawBoundary = false;
  const first = Math.max(0, offsets.length - MAX_FRAMES);
  for (let k = offsets.length - 1; k >= first; k -= 1) {
    const from = offsets[k];
    const to = k + 1 < offsets.length ? offsets[k + 1] : tail.buffer.length;
    const events = eventsOf(tail.buffer, from, to);
    // 帧内事件是正序，倒着塞进 reversed
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (isBoundary(event)) {
        sawBoundary = true;
        break;
      }
      reversed.push(event);
    }
    if (sawBoundary) break;
  }

  // 再翻回正序，从前往后配对 call / result
  const settled = new Set();
  const pending = [];
  for (let i = reversed.length - 1; i >= 0; i -= 1) {
    const event = reversed[i];
    const type = event?.type;
    if (type === 'tool/result') {
      const callId =
        event.data?.message?.source?.callId ?? event.data?.message?.toolCallId;
      if (typeof callId === 'string') settled.add(callId);
      continue;
    }
    if (type === 'tool/call') {
      const callId = event.data?.callId;
      if (typeof callId !== 'string') continue;
      const name = String(event.data?.name ?? '');
      pending.push({ callId, name });
    }
  }
  // 已经拿到结果的剔除
  return pending.filter((item) => !settled.has(item.callId));
}

/** 每个会话上一次扫描的结果缓存：key → { sig, value }。 */
const scanCache = new Map();

/**
 * 这个会话当前挂着的工具调用有哪些（带工具名）。
 *
 * 工具执行期间日志不再增长，所以按 (size:mtime) 缓存之后，同一次等待只会真正
 * 扫描一遍；只有当调用结束、日志继续追加时才需要重新扫。
 *
 * @param {string} sessionKey
 * @returns {Promise<{callId: string, name: string}[]>}
 */
export async function pendingCallsOf(sessionKey) {
  const logPath = await findSessionLog(sessionKey);
  if (logPath === undefined) return [];

  let signature;
  try {
    const info = await stat(logPath);
    signature = `${info.size}:${info.mtimeMs}`;
  } catch {
    return [];
  }

  const cached = scanCache.get(sessionKey);
  if (cached !== undefined && cached.sig === signature) return cached.value;

  const value = await pendingToolCalls(logPath);
  scanCache.set(sessionKey, { sig: signature, value });
  return value;
}

/** 会话是不是正在等用户回答（有挂起的 ask_user_question 调用）。 */
export async function isAskingUser(sessionKey) {
  const calls = await pendingCallsOf(sessionKey);
  return calls.some((call) => call.name === 'ask_user_question');
}

/** 清掉某个会话的缓存（会话删掉时用，避免无限增长）。 */
export function forgetSession(sessionKey) {
  scanCache.delete(sessionKey);
}
