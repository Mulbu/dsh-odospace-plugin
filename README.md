# dsh-odospace 插件

把 [dsh-odospace](../../dsh-odospace) 从「一个 systemd 常驻的 CLI 脚本」变成
Harness 内的一个插件。功能不变（dsh 任务进度 → Odospace 接收端），换来的好处：

| | 原 CLI 项目 | 本插件 |
|---|---|---|
| 启动 | systemd unit + `run-bridge.sh` 拼参数 | 随 profile 加载，装一次就好 |
| 配置 | 环境变量 + 命令行参数两套 | 一处 `cordis.patch.yml` 的 config |
| 看状态 | `journalctl -u dsh-odospace` | Web UI 左侧「Odospace 面板」页 |
| 日志 | stdout | `ctx.logger`（进 dsh 的日志体系） |
| 给模型用 | — | 可选注册 `odospace_panel` 工具 |

桥只负责 **page 1**（dsh 进度）。AIDA64 是直连手机推 **page 0** 的，两边互不知情 ——
详见原项目 README 的「与 AIDA64 共存」。

## 目录

```
index.js            Host 插件入口：Config schema、同源路由、可选工具
engine.js           推流引擎：灯效循环 / 轮询、渲染、推送、HTTP 路由
client.js           Client 半边：侧边栏图标 + 面板页（React 组件）
cordis.patch.yml    bundle 的 loader patch：插入 dsh-odospace 行
lib/render.js       node-canvas 画版面（从原项目搬来，未改动）
lib/state.js        读会话投影、算六态 ledState
lib/logtail.js      扫会话日志尾部，判断「是否在等用户回答」
lib/sensors.js      传感器缓存（只给 HTTP 接口用，不上屏）
lib/odospace.js     Odospace 协议：组帧 + 推送
icon.svg            插件卡片图标
locale/{zh,en}.json 插件标题/描述
```

`lib/` 下的五个模块与原项目**逐字节相同**（只把 `.mjs` 改成 `.js`、把
`./logtail.mjs` 的 import 后缀改掉）。所以版面、状态判定、协议这些「踩过坑的
逻辑」没有重新实现，只是换了宿主。改版面还是要改原项目再同步过来。

## 配置

`cordis.patch.yml` 里 `dsh-odospace` 行的 config：

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 是否启动推流引擎。关掉只保留 UI 页面 |
| `host` | `''` | 接收端 IP。**留空 = 不启动推流**（页面仍可看任务状态） |
| `port` | `38000` | Odospace 端口 |
| `page` | `1` | dsh 进度写第几页（AIDA64 直连用 page 0） |
| `size` | `1350x720` | 面板分辨率 `WxH` |
| `tasks` | `4` | 列表视图显示几个会话；0 = 单任务大字号 |
| `includeSubagents` | `false` | 子代理会话是否也进列表 |
| `fps` | `1` | 灯效：>0 开启（红/橙闪 0.5 秒一次）；0 = 只在内容变化时推 |
| `quality` | `60` | JPEG 质量 |
| `alwaysPush` | `true` | 每轮都重推。手机靠「收到新帧」判断在线，去重会看起来卡住 |
| `idleFrames` | `false` | 没有活跃会话时也推「空闲」帧 |
| `checkIntervalMs` | `2000` | 多久重读一次会话投影 |
| `intervalMs` | `2000` | `fps=0` 时的轮询间隔 |
| `dryRun` | `false` | 只渲染不推送（调版面用）；页面预览和「立即推一帧」不受影响 |
| `out` | `''` | 每帧额外落盘路径（调试） |
| `serve` | `0` | 另开一个带 token 的 HTTP 接口（Windows 脚本用）。0 = 不开 |
| `serveHost` | `127.0.0.1` | serve 绑定地址 |
| `serveToken` | `''` | serve token（会写进 patch，不推荐） |
| `serveTokenFile` | `''` | **推荐**：从文件读 token，格式 `DSH_ODO_SERVE_TOKEN=<token>` |
| `tool` | `false` | 注册 `odospace_panel` 工具（status/preview/push） |

> `config` 是**整行替换**而非深合并，所以覆盖时要把用到的默认值一起写上。
> schema 是 `additionalProperties: false`，拼错字段名会直接报错，不会静默走默认值。

## Web UI 面板

左侧栏「Odospace 面板」页（`sidebar.panellist` 图标 + `main` 页）显示：

- **状态条**：推流中 / 未配置接收端 / 只渲染不推送，加上已推送帧数、渲染次数、失败次数、运行时长
- **实时预览**：直接拉 `GET /dsh-odospace/api/preview` 返回的 JPEG —— 就是推给接收端的那张图
- **配置摘要**：接收端、页号、分辨率、视图、灯效、JPEG 质量、最近推送时间、最近错误
- **会话列表**：每行一个会话，左侧灯色与面板上的方块一致，右侧是上下文百分比 + 状态文字
- **动作**：「立即推一帧」（`POST /dsh-odospace/api/push`）、「刷新预览」

页面每 2 秒轮询 `GET /dsh-odospace/api`，标签页隐藏时停轮询；请求失败时保留上一份
数据（变暗）而不是清空。

### 页内设置（推送 IP / 端口 / 页号 / 行数）

页面下半部有「设置」卡片，四个字段直接可改：

| 字段 | 范围 | 作用 |
|---|---|---|
| 推送 IP | 任意字符串 | 接收端地址；留空 = 不推流 |
| 端口 | 1..65535 | Odospace 端口 |
| 面板页号 | 0..9 | AIDA64 直连占 0，本插件用 1 |
| 列表行数 | 0..8 | 0 = 单任务大字号视图 |

保存后**立即生效，不用重启**：

1. `configEditor.edit()` 把新值写进 profile 的 `cordis.patch.yml`（重启后还在）；
2. `bridge.update()` 原地替换运行中桥的 `host/port/page/tasks`，下一个推送周期
   就按新值跑，推流不中断。

两个细节：

- **越界是报错，不是夹取**。配置文件里的数字可以夹（笔误不该让插件不激活），
  但设置页面向人负责：`port: 99999` 会被拒绝并标红，而不是悄悄改成 65535 ——
  否则你对着一个自己没填过的端口查半天。表单在值非法时直接禁用保存。
- 写回配置文件失败（例如没有 `configEditor` 服务）时仍然热更新内存里的值，
  响应里 `persisted: false`、页面提示「已生效（重启后会恢复旧值）」，不静默。

协议：`GET /dsh-odospace/api/settings` 读当前值与合法范围，
`POST` 同一个地址写。只接受这四个字段，其余忽略。

> 为什么不能热改 `serve`（独立 token 端口）：那要关掉再重开 socket，
> 会打断正在连接的外部脚本，所以它只从插件配置读，改了需要重启。

### 同源 API

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/dsh-odospace/api` | 状态 JSON（配置、任务、六态统计、推送计数） |
| `GET` | `/dsh-odospace/api/preview` | 当前帧 JPEG |
| `POST` | `/dsh-odospace/api/push` | 渲染并推送一帧 |
| `GET` | `/dsh-odospace/api/settings` | 读设置与合法范围 |
| `POST` | `/dsh-odospace/api/settings` | 改设置（校验 + 持久化 + 热更新） |
| `POST` | `/dsh-odospace/api/sensors` | 外部推传感器 JSON |

**只接受同源请求**：payload 里有会话标题，`Origin`/`Host` 不匹配或
`Sec-Fetch-Site: cross-site` 一律 403。不用 token 是因为它只服务浏览器页面。

## 模型工具（可选）

`tool: true` 时注册 `odospace_panel`，三个动作：

- `status` —— 接收端配置、推送计数、最近错误、每个会话的灯态
- `preview` —— 渲染一帧落盘到 `~/.dsh-odospace-preview.jpg`，可以接着 `read_image` 看
- `push` —— 立即推一帧到接收端

默认 **关闭**：工具 schema 会在每次模型请求里占字节，而「看一眼副屏」通常不需要
模型来做。

## 安装

```bash
# 在 dsh 会话里（需要 Full access）
plugin_manager action=install_bundle target=/home/mulbu/work/dsh-odospace-plugin
```

安装后 `install_bundle` 会把本包加进 profile 的 `package.json` 依赖和 bundles 列表，
Loader 按 `cordis.patch.yml` 插入 `dsh-odospace` 行。之后改配置只改
`~/.dsh/profiles/web/cordis.patch.yml` 里对应的 override（或直接改建好的
`~/work/dsh-odospace-plugin/cordis.patch.yml` 再重装）。

`canvas` 是 **peerDependency（optional）**：不装依赖，靠机器上已有的
`node_modules/canvas` 解析（本机是原项目的 `node_modules`）。缺失时
`engine.js` 顶层的 import 会失败、插件不激活 —— 这时要么 `pnpm add canvas`，
要么把原项目的 `node_modules` link 过来。

## 与 systemd 版本的关系

**两者都开会在同一个端口上抢**：插件默认 `serve: 3099`，原 unit 也是 3099。
插件推出第一帧之后就该停掉旧 unit：

```bash
sudo systemctl disable --now dsh-odospace
```

反过来想回到 CLI 版就 `systemctl enable --now dsh-odospace`，并在插件配置里
设 `enabled: false`。两边的 `host` / `page` / `size` 等取值要一致，否则手机上
看到的版面会变。

## 验证

```bash
# 引擎 + 路由 + 协议（不需要真手机）
node /tmp/engine-test.mjs      # 见原项目的 mock-receiver.mjs 也可
node /tmp/receiver-test.mjs
```

面板页的实际效果需要在浏览器里看：装好后点左侧栏的 Odospace 图标。
