# ClaudeMeter

*[English](README.md) · 简体中文*

Claude Code 状态栏插件：显示**上下文占用、5 小时窗口、周窗口，以及按模型的额度窗口（Fable）**。

```
◈ Opus 5 1M  …/Project/ClaudeMeter  ⎇ main  $0.42
CTX ▓▓▓░░░░░░░ 31%  5H ▓▓░░░░░░░░ 23% ↻2h13m  WEEK ▓▓▓▓░░░░░░ 41% ↻2d23h  FABLE ▓▓▓▓▓▓▓▓▓░ 95% ↻1d9h
```

## 它解决什么问题

现有的状态栏插件（包括最流行的 claude-hud）都只从 statusline 的 stdin JSON 取额度数据。
这带来两个具体的缺口：

**1. Fable 等按模型的额度永远看不到。**
stdin 的 `rate_limits` 只有 `five_hour` 和 `seven_day` 两个窗口，**没有任何按模型拆分的字段**。
Fable 在 Max 套餐上占用独立的周额度上限（约为周额度的 50%），但状态栏完全不显示——
你可能在毫不知情的情况下已经用掉 95%。

ClaudeMeter 改从 `~/.claude.json` 的 `cachedUsageUtilization` 读取。这是 Claude Code CLI
自己维护的用量缓存，也就是 `/usage` 命令背后的同一份数据，里面的 `limits[]` 数组带有
`kind: "weekly_scoped"` 的条目，模型名在 `scope.model.display_name`。

**2. 周用量经常不显示。**
claude-hud 的 `sevenDayThreshold` 默认是 80，周用量低于 80% 时整段被隐藏——这是它的设计，
不是 bug，但表现出来就是"平时没有、快满了才冒出来"。
**ClaudeMeter 没有这种阈值**，周用量在 0% 时也照常显示。

## 安装

```
/plugin marketplace add q1343135559/ClaudeMeter
/plugin install claudemeter@claudemeter
/claudemeter:setup
```

`/claudemeter:setup` 会检测 node 路径、安装启动器、备份你现有的 statusline 配置
（替换别人的 statusline 之前会先征求同意），然后写入 `settings.json`。
装完重启 Claude Code 或执行 `/reload-plugins`。

用 `/claudemeter:configure` 调整显示内容。

## 各段的含义

| 段 | 含义 | 数据来源 |
|---|---|---|
| `CTX` | 当前上下文窗口占用 | stdin `context_window` |
| `5H` | 5 小时滚动窗口已用额度 | stdin 优先，缺失时用本地缓存 |
| `WEEK` | 周额度已用比例 | 同上 |
| `FABLE` 等 | 该模型的独立周额度 | 仅本地缓存 |
| `↻2h14m` | 距该窗口重置还有多久 | — |
| `~95%` `·22m` | 数据来自本地缓存且已超过 20 分钟未刷新，`·22m` 是实际年龄 | — |
| `≈$25.53` | 本次会话的花费 | stdin `cost.total_cost_usd` |

### 关于花费前面的 ≈

Claude Code 报出的会话花费是**客户端按 API 价目表估算**的，`/clear` 开新会话就归零。
如果你用的是 Claude.ai 订阅（Pro / Max / Team），你并不按 token 付费——
这个数字是"这些 token 若按 API 价格计价大约值多少钱"，**不是账单**。

所以 ClaudeMeter 在检测到订阅账户时会加一个 `≈` 前缀，避免被读成实际扣费。
用 API key 的账户没有这个前缀，因为那种情况下它接近真实开销。
不想看到这一段就把 `showCost` 设成 `false`。

### 配色

进度条按剩余额度分三档，已用部分着色、未用部分暗灰：

| 档位 | 颜色 | 默认阈值 |
|---|---|---|
| 额度充足 | 绿色 | 已用 < 50% |
| 用掉过半 | 黄色 | 已用 ≥ 50% |
| 只剩两成 | 淡红色 | 已用 ≥ 80% |

淡红用的是 bright red（ANSI 91）而不是 red（31）——后者在深色终端上偏暗发褐，
夹在一排彩色进度条中间反而不够醒目。

Anthropic 会随额度数据下发自己的严重度判定（`normal` / `warning` / `critical`）。
ClaudeMeter 取**服务端判定与本地阈值中更严重的那个**：服务端可以把某个窗口主动升级成告警
（它知道你账户的真实档位），但它标成 `normal` 不会把本地阈值压回绿色——
否则"过半变黄"这条规则在大多数时候都不会生效。

阈值和颜色都可以在配置里改，上下文条有独立的一套阈值（`contextWarning` / `contextCritical`），
因为它逼近上限的后果是触发压缩，与额度耗尽不是一回事。

### 关于陈旧标记

`5H` 和 `WEEK` 是搭每次 API 响应头的便车来的，所以只要 stdin 里带着，它俩就和你最后一条消息一样新。
按模型的窗口不在那些响应头里，只存在于本地缓存中，而 Claude Code 是按自己的节奏去调用量接口回填的。

**这个节奏不是固定定时器。** 在本机采样得到的间隔有 5 分钟、10 分钟，以及一段超过 17 分钟的静默——
看起来是"缓存超过一个较短的 TTL 之后，还需要会话里有事件触发才会去拉"，所以会话越闲、间隔拖得越长。

因此 ClaudeMeter 在缓存数据超过 20 分钟时标上 `~` 前缀和实际年龄。阈值刻意定在正常区间之上：
平时不打扰你，而在你离开一段时间后回到会话时才出声——那正是这个数字最可能已经过期的时刻。
它不会轮询、不会起后台刷新进程、也不会调 API 去掩盖这个滞后，只是如实告诉你数据落后了。

想立刻刷新，在任意会话里跑一次 `/usage`，它会拉取新数据并写回缓存。

想让年龄始终可见，把 `staleWarnMs` 设成 `0`；不想看到年龄，把 `showStaleAge` 设成 `false`。

## 数据与隐私

ClaudeMeter **只读三样东西，全部在本地**：

1. Claude Code 通过 stdin 传进来的会话 JSON
2. `~/.claude.json` 里的 `cachedUsageUtilization`，以及 `oauthAccount` 里的两个非身份字段
   `organizationType`（判断是否订阅账户，决定花费要不要加 `≈`）与 `organizationRateLimitTier`（套餐档位）
3. 当前目录向上最近的 `.git/HEAD`（用于显示分支名）

明确**不做**的事：

- **不发任何网络请求。** 特别是不调用 `api.anthropic.com/api/oauth/usage` —— 那个接口的响应
  正是 `cachedUsageUtilization` 缓存的内容，本地已经有了；而且它限流极其严重，
  状态栏这种高频调用者会很快被 429，反过来影响你真实会话的可用性。
- **不读取任何凭证。** 不碰 `~/.claude/.credentials.json`，不碰 macOS Keychain。
- **不起子进程。** 分支名靠直接读 `.git/HEAD` 得到，不 fork `git`。
- **不外传任何东西。** `~/.claude.json` 里同时存有邮箱、账号 UUID、机器 ID 和全部项目历史；
  本插件只提取上面列出的白名单字段，其余一概不读出。测试里有一条专门断言返回结构中
  不含邮箱、UUID、机器 ID 与项目历史。

`plugin/dist/index.js` **不做压缩混淆**，就是为了让你能直接读一遍确认上面这些说法。

临时关闭：`CLAUDEMETER_DISABLE=1 claude`。

## 配置

配置文件：`{CLAUDE_CONFIG_DIR:-~/.claude}/claudemeter/config.json`。
不存在、或写坏了，都会安静地回退到默认值——**配置错误不会让状态栏消失**。
完整配置项见 `/claudemeter:configure` 的输出，或 [`commands/configure.md`](commands/configure.md)。

常用的几个：

```jsonc
{
  "scopedFilter": ["Fable"],  // 只显示 Fable 的周额度
  "barWidth": 0,              // 不画进度条，只留百分比数字
  "showLine1": false,         // 只保留用量行
  "staleWarnMs": 0,           // 缓存数据的年龄始终可见
  "thresholds": { "warning": 60, "critical": 85 },   // 调整变黄/变红的时机
  "colors": { "critical": "red", "barEmpty": "none" } // 换配色
}
```

## 看不到用量段怎么办

按可能性排序：

1. **不是 Claude.ai 订阅用户**（用 API key，或 Bedrock / Vertex）——这类账户没有订阅额度窗口，
   `rate_limits` 和 `cachedUsageUtilization` 都不会存在。
2. **Claude Code 还没写过用量缓存** —— 在任意会话里执行一次 `/usage` 即可。
3. **缓存超过 24 小时** —— 超过 `staleMaxMs` 的数据会被丢弃而不是显示一个远古数字。同样执行一次 `/usage`。

**某一段突然消失了。** 本地缓存里已经**跨过重置时刻**的窗口会被主动丢弃：那种情况下百分比是
*可证伪的错误*而不只是旧，显示出来比不显示更糟。5 小时窗口尤其容易碰上——缓存动辄陈旧十几分钟，
经常正好跨过重置点，所以 `5H` 会消失而不是停在旧值上。

**但"旧"本身不会让窗口消失。** `staleMaxMs` 只是防远古数据的兜底，24 小时这个值刻意定得远高于
你离开期间攒下的滞后：一个明天才重置的周窗口，即使读数旧了几个小时，标成 `~95% ·14h` 显示出来
仍然有用。

## 开发

```bash
npm install
npm run build        # esbuild 打包成单文件 plugin/dist/index.js
npm test             # node --test，64 个用例
npm run demo         # 用内置假数据渲染一次
```

本地开发时不必反复安装插件，直接指向仓库里的产物：

```bash
CLAUDEMETER_DIST=$PWD/plugin/dist/index.js node plugin/bin/launcher.mjs --demo
```

### 发布一次改动

```bash
npm run build && npm test      # 重新构建 plugin/dist 并验证
npm run bump -- 0.2.1          # 一次性改掉三个文件里的版本号
npm run build                  # 让 dist 与新版本号一致
git commit -am "..." && git push
```

真正起作用的是 `plugin/.claude-plugin/plugin.json` 里的 `version`。Claude Code 拿它当更新判定的
缓存键，版本号没变就意味着已安装的用户永远收不到这次改动，`/plugin update` 还会回报
"already at the latest version" —— 而构建是绿的、推送是成功的、没有任何报错。
另外两个版本字段只是信息性的：`package.json` 从不发布到 npm，`marketplace.json` 里那个是
**市场清单**的版本而非插件的版本。

两个 CI job 让这种错误发不出去：`dist-is-current` 会重新构建并在 `plugin/dist/` 与 `src/`
不同步时失败；`version-bumped` 会在 `plugin/` 有改动而版本号没动时失败。
确实想跳过第二个时，在提交信息里写 `[skip version check]`。

用户这样拿到新版本：

```
/plugin marketplace update claudemeter
```

或在 shell 里 `claude plugin marketplace update claudemeter`。第三方市场的自动更新默认是**关闭**的，
用户可以在 `/plugin` 的 **Marketplaces** 标签页里打开。

### 仓库结构

```
.claude-plugin/marketplace.json   市场目录
plugin/                           ← 安装时只复制这一个目录
  .claude-plugin/plugin.json
  commands/                       /claudemeter:setup 与 :configure
  bin/launcher.mjs                版本发现启动器
  dist/index.js                   已提交的构建产物
src/ tests/ scripts/              构建与测试，不随插件分发
```

构建工具链刻意留在仓库根目录：Claude Code 会对安装后的插件目录自动执行 `npm install`
（只要里面有 `package.json` 和 lockfile），把它挡在 `plugin/` 之外，安装体积就从 35MB
降到约 100KB —— 那 35MB 是 esbuild 和 typescript，运行时一个字节都用不到。

零运行时依赖，只用 `node:` 内置模块。`plugin/dist/` 会提交进仓库，因为 marketplace
安装的是仓库快照。

## License

MIT
