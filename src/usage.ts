/**
 * 多来源额度数据的合并。
 *
 * 两个来源各有短板，必须取长补短：
 *   - statusline stdin：每次 API 响应都刷新，最新鲜，但只有 five_hour / seven_day 两个窗口，
 *     而且仅 Pro/Max 订阅、且本会话已发生过第一次响应之后才出现，两个窗口还能各自独立缺失。
 *   - ~/.claude.json 的缓存：含按模型的窗口（Fable），但由 Claude Code 自己按节奏刷新，
 *     实测可能陈旧 10 分钟以上。
 *
 * 合并的核心是"并集"而非"替换"：只存在于缓存里的窗口照样渲染。
 * 这正是本插件能显示 Fable、而只吃 stdin 的 claude-hud 做不到的原因。
 */
import { normalizePercent } from './stdin.js';
import type { ClaudeJsonSnapshot } from './claude-config.js';
import type { Config } from './config.js';
import type { MeterWindow, StdinData, StdinRateLimitWindow } from './types.js';

/**
 * 把 stdin 里的一个限额窗口转成 MeterWindow。
 *
 * 注意 stdin 的 resets_at 是 **Unix 秒**，与 ~/.claude.json 里的 ISO 字符串不同格式。
 *
 * Args:
 *   raw: stdin 的 rate_limits.five_hour 或 .seven_day。
 *   key: 窗口标识。
 *   label: 显示标签。
 *
 * Returns:
 *   MeterWindow；百分比缺失或非法时返回 null。
 */
function fromStdinWindow(
  raw: StdinRateLimitWindow | undefined,
  key: string,
  label: string,
): MeterWindow | null {
  const percent = normalizePercent(raw?.used_percentage);
  if (percent === null) return null;
  const seconds = raw?.resets_at;
  const resetAt =
    typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? new Date(seconds * 1000)
      : null;
  return { key, label, percent, resetAt, severity: null, source: 'stdin', ageMs: null };
}

/**
 * 判断某个窗口是否应该按用户配置显示。
 *
 * Args:
 *   win: 待判断的窗口。
 *   config: 用户配置。
 *
 * Returns:
 *   应当显示时返回 true。
 */
function isVisible(win: MeterWindow, config: Config): boolean {
  if (win.key === 'session') return config.showFiveHour;
  if (win.key === 'weekly') return config.showWeekly;
  if (win.key.startsWith('scoped:')) {
    if (!config.showScoped) return false;
    // scopedFilter 为空表示不过滤；非空时只保留列出的模型
    if (config.scopedFilter.length === 0) return true;
    return config.scopedFilter.includes(win.label.toUpperCase());
  }
  return config.showUnknownWindows;
}

/**
 * 判断一条来自缓存的窗口是否已经不可信。
 *
 * 两条规则，分工不同，不能互相替代：
 *   1. resets_at 已经早于当前时刻 —— 窗口已经翻篇，缓存里那个百分比是**可证伪的错误**，
 *      无论数据多新都必须丢弃。这一条对 5 小时窗口尤其关键：缓存动辄陈旧十几分钟，
 *      经常正好跨过重置点。
 *   2. 数据年龄超过 staleMaxMs —— 纯兜底，拦的是"旧到连大致参考价值都没有"的数据。
 *      注意它只会咬到长窗口：5 小时窗口的缓存一旦超过 5 小时，规则 1 早就拦掉了。
 *      所以这个阈值定得过短会适得其反 —— 把一个重置时刻还在明天、只是读数偏旧的
 *      周窗口整段抹掉，比带着年龄标记显示出来更糟。
 *
 * Args:
 *   win: 待判断的窗口。
 *   config: 用户配置。
 *   now: 当前时刻（毫秒）。
 *
 * Returns:
 *   应当丢弃时返回 true。
 */
function isCacheWindowExpired(win: MeterWindow, config: Config, now: number): boolean {
  if (win.source !== 'cache') return false;
  if (win.ageMs !== null && win.ageMs > config.staleMaxMs) return true;
  if (win.resetAt !== null && win.resetAt.getTime() <= now) return true;
  return false;
}

/**
 * 合并 stdin 与本地缓存，产出最终要渲染的窗口列表。
 *
 * 合并规则：
 *   1. 以缓存里的 limits[] 为基础集合（它是唯一能提供按模型窗口的来源）。
 *   2. stdin 的 five_hour / seven_day 整体覆盖对应窗口 —— percent 与 resetAt 必须成对替换，
 *      绝不能把 stdin 的百分比配上缓存的重置时刻，那会得到一个自相矛盾的组合。
 *   3. 缓存缺席时，stdin 的两个窗口依然独立成条目（并集语义）。
 *   4. 不设任何"低于 N% 就隐藏"的门槛：周用量在 0% 时也照常显示。
 *
 * Args:
 *   stdin: statusline 传入的会话数据，可能为 null。
 *   snapshot: ~/.claude.json 的用量快照，可能为 null。
 *   config: 用户配置。
 *   now: 当前时刻（毫秒）。
 *
 * Returns:
 *   按 5 小时 → 周 → 按模型 → 其它 的顺序排好的窗口列表。
 */
export function mergeWindows(
  stdin: StdinData | null,
  snapshot: ClaudeJsonSnapshot | null,
  config: Config,
  now: number,
): MeterWindow[] {
  const byKey = new Map<string, MeterWindow>();

  for (const win of snapshot?.windows ?? []) {
    if (isCacheWindowExpired(win, config, now)) continue;
    byKey.set(win.key, win);
  }

  const stdinFive = fromStdinWindow(stdin?.rate_limits?.five_hour, 'session', config.labels.fiveHour);
  if (stdinFive) byKey.set('session', stdinFive);
  const stdinWeek = fromStdinWindow(stdin?.rate_limits?.seven_day, 'weekly', config.labels.weekly);
  if (stdinWeek) byKey.set('weekly', stdinWeek);

  // 标签统一走配置，这样用户改 labels 对两个来源都生效
  const session = byKey.get('session');
  if (session) session.label = config.labels.fiveHour;
  const weekly = byKey.get('weekly');
  if (weekly) weekly.label = config.labels.weekly;

  const ordered: MeterWindow[] = [];
  if (session) ordered.push(session);
  if (weekly) ordered.push(weekly);
  for (const [key, win] of byKey) {
    if (key === 'session' || key === 'weekly') continue;
    if (key.startsWith('scoped:')) ordered.push(win);
  }
  for (const [key, win] of byKey) {
    if (key.startsWith('other:')) ordered.push(win);
  }

  return ordered.filter((win) => isVisible(win, config));
}
