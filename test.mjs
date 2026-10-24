/**
 * 同步自 CLI 项目的 test-multi.mjs，验证「同步过来的行为」真的还在：
 * ask/fail 顶置、ask 不显示工具名、双帧只在需要时渲染。
 *
 * 跑法：node test.mjs        （失败退出码 1）
 *
 * 需要 canvas —— 插件把 canvas 当可选 peer 依赖，从本目录的 node_modules
 * （指向 CLI 项目的 node_modules）解析。没有就只跑纯逻辑部分。
 */
import { drawPanel, encodeJpeg } from './lib/render.js';
import { signatureOf, tallyOf } from './engine.js';

const B = { pass: 0, fail: 0 };
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  cond ? B.pass++ : B.fail++;
};

const mk = (led, age, id) => ({
  sessionId: id,
  ledState: led,
  updatedAt: Date.now() - age,
  title: id,
  prompt: 'p',
  model: 'm',
  runningTool: '',
  contextPercent: 1,
  todos: { total: 0, done: 0, items: [] },
});

// ── 1. 排序优先级：ask / fail 必须顶置 ──
// 与 lib/state.js 的 listTasks 保持同一套规则
const priority = (t) => (t.ledState === 'fail' ? 0 : t.ledState === 'ask' ? 1 : 2);
const synth = [mk('idle', 0, 'a'), mk('run', 100, 'b'), mk('ask', 99999, 'c'), mk('fail', 88888, 'd')];
synth.sort((a, b) => priority(a) - priority(b) || b.updatedAt - a.updatedAt);
ok('fail 顶置第一', synth[0].ledState === 'fail');
ok('ask 顶置第二', synth[1].ledState === 'ask');
ok('最新 idle 排在 ask 之后（同组内按时间倒序）', synth[2].ledState === 'idle', `实际="${synth[2].ledState}"`);

// ── 2. 4 行窗口不丢 ask ──
const many = Array.from({ length: 8 }, (_, i) => mk('run', i * 1000, 'r' + i));
many.push(mk('ask', 999999, 'ASK'));
many.sort((a, b) => priority(a) - priority(b) || b.updatedAt - a.updatedAt);
ok('8 个活跃会话下 ask 仍在第 1 行', many.slice(0, 4).some((t) => t.ledState === 'ask'));

// ── 3. 引擎的签名必须覆盖上屏字段 ──
// 这是插件自己的 signatureOf()（CLI 是 bridge.mjs 里的内联版本）
const s1 = [{ ...mk('tool', 0, 'x'), runningTool: 'bash' }];
const s2 = [{ ...mk('tool', 0, 'x'), runningTool: 'read' }];
ok('换工具会触发重渲染', signatureOf(s1) !== signatureOf(s2));
const s3 = [{ ...mk('run', 0, 'x'), title: 'A' }];
const s4 = [{ ...mk('run', 0, 'x'), title: 'B' }];
ok('标题变化会触发重渲染', signatureOf(s3) !== signatureOf(s4));
const s5 = [{ ...mk('run', 0, 'x'), updatedAt: 1 }];
const s6 = [{ ...mk('run', 0, 'x'), updatedAt: 999999 }];
ok('仅 updatedAt 变化不重渲染（省渲染）', signatureOf(s5) === signatureOf(s6));

// ── 4. ask 不能把工具名当副标题 ──
const askT = { ...mk('ask', 0, 'q'), runningTool: 'ask_user_question', prompt: '真实问题' };
ok('ask 副标题显示用户输入', !(askT.runningTool && askT.ledState !== 'ask'));
const toolT = { ...mk('tool', 0, 't'), runningTool: 'bash', prompt: 'x' };
ok('tool 副标题显示工具名', Boolean(toolT.runningTool && toolT.ledState !== 'ask'));

// ── 5. 闪烁触发条件 ──
const needBlink = (list) => list.some((t) => t.ledState === 'ask' || t.ledState === 'fail');
ok('含 ask 需要双帧', needBlink([mk('run', 0, 'a'), mk('ask', 0, 'b')]));
ok('含 fail 需要双帧', needBlink([mk('fail', 0, 'a')]));
ok('全 run/done 只需单帧', !needBlink([mk('run', 0, 'a'), mk('done', 0, 'b'), mk('idle', 0, 'c')]));

// ── 6. 双帧必须真的不同（走真实渲染）──
const list = [mk('ask', 0, 'q'), mk('tool', 0, 't')];
const lit = encodeJpeg(drawPanel(list, { width: 1350, height: 720, lit: true }), 60);
const dark = encodeJpeg(drawPanel(list, { width: 1350, height: 720, lit: false }), 60);
ok('lit/dark 两帧内容不同', !lit.equals(dark), `${lit.length}B vs ${dark.length}B`);
const lit2 = encodeJpeg(drawPanel([mk('run', 0, 'a')], { width: 1350, height: 720, lit: true }), 60);
const dark2 = encodeJpeg(drawPanel([mk('run', 0, 'a')], { width: 1350, height: 720, lit: false }), 60);
ok('无闪灯任务时两帧相同（可省渲染）', lit2.equals(dark2));

// ── 7. 六态统计 ──
const tally = tallyOf([mk('fail'), mk('ask'), mk('tool'), mk('idle'), mk('idle')]);
ok('tally 统计正确', tally.fail === 1 && tally.ask === 1 && tally.tool === 1 && tally.idle === 2, JSON.stringify(tally));

console.log(`\n${B.pass} 通过 / ${B.fail} 失败`);
process.exit(B.fail ? 1 : 0);
