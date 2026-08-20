/**
 * 状态栏两行文本的组装。
 *
 * 宽度处理是这个模块的主要复杂度来源：状态栏一旦超出终端宽度就会折行，
 * 把 Claude Code 的输入区顶乱。因此这里不做"算好宽度再拼"，而是生成一组
 * 由宽到窄的候选方案，挑第一个放得下的——这样降级顺序是显式声明的、可测试的，
 * 而不是散落在各处的 if 判断。
 */
import type { Config } from '../config.js';
import type { MeterContext, MeterWindow } from '../types.js';
import { splitBar } from './bar.js';
import { levelColor, paint } from './colors.js';
import { formatPath } from './path.js';
import { formatAge, formatDuration } from './time.js';
import { stringWidth, truncate } from './width.js';

/** 段与段之间的分隔。 */
const GAP = '  ';

/** 一种候选渲染方案的参数组合。 */
interface Variant {
  /** 进度条格数，0 表示不画条只给数字。 */
  barWidth: number;
  /** 是否显示重置倒计时。 */
  countdown: boolean;
  /** 最多渲染几个限额窗口。 */
  maxWindows: number;
}

/**
 * 根据终端宽度推导默认进度条格数。
 *
 * Args:
 *   columns: 可用列数。
 *
 * Returns:
 *   进度条格数。
 */
function autoBarWidth(columns: number): number {
  if (columns >= 110) return 10;
  if (columns >= 80) return 6;
  if (columns >= 60) return 4;
  return 0;
}

/**
 * 渲染一个限额窗口（5H / WEEK / FABLE 等）。
 *
 * Args:
 *   win: 窗口数据。
 *   config: 用户配置。
 *   variant: 当前候选方案。
 *   now: 当前时刻（毫秒）。
 *
 * Returns:
 *   该段的显示字符串。
 */
function renderWindow(win: MeterWindow, config: Config, variant: Variant, now: number): string {
  const color = levelColor(win.percent, win.severity, config, config.colors.usage);
  const parts: string[] = [paint(win.label, config.colors.label)];

  if (variant.barWidth > 0) {
    const bar = splitBar(win.percent, variant.barWidth, config);
    parts.push(paint(bar.filled, color) + paint(bar.empty, config.colors.barEmpty));
  }

  // 缓存来源且已经明显陈旧时，用 ~ 前缀表明这是个近似值
  const isStale = win.source === 'cache' && win.ageMs !== null && win.ageMs > config.staleWarnMs;
  parts.push(paint((isStale ? '~' : '') + win.percent + '%', color));

  if (variant.countdown && config.showResetCountdown && win.resetAt) {
    const remaining = formatDuration(win.resetAt.getTime() - now);
    if (remaining) parts.push(paint('↻' + remaining, config.colors.label));
  }

  if (isStale && config.showStaleAge && win.ageMs !== null) {
    const age = formatAge(win.ageMs);
    if (age) parts.push(paint('·' + age, config.colors.label));
  }

  return parts.join(' ');
}

/**
 * 在窗口放不下时挑出最该保留的那几个。
 *
 * 取舍依据是"紧急程度"而不是出现顺序：服务端标为 critical 的窗口、以及百分比更高的窗口
 * 更值得占用这点宝贵的宽度。否则在窄终端下会出现"把已经 95% 的 Fable 丢掉、
 * 留下 41% 的周用量"这种正好相反的结果。挑完之后仍按原顺序渲染，避免位置跳动。
 *
 * Args:
 *   windows: 全部候选窗口。
 *   max: 最多保留几个。
 *
 * Returns:
 *   保留下来的窗口，顺序与输入一致。
 */
function selectWindows(windows: MeterWindow[], max: number): MeterWindow[] {
  if (max >= windows.length) return windows;
  const rank = (win: MeterWindow): number => {
    const severityBoost = win.severity === 'critical' ? 200 : win.severity === 'warning' ? 100 : 0;
    return severityBoost + win.percent;
  };
  const keep = new Set(
    [...windows].sort((a, b) => rank(b) - rank(a)).slice(0, max),
  );
  return windows.filter((win) => keep.has(win));
}

/**
 * 按给定方案渲染用量行。
 *
 * Args:
 *   ctx: 渲染上下文。
 *   config: 用户配置。
 *   variant: 当前候选方案。
 *   now: 当前时刻（毫秒）。
 *
 * Returns:
 *   用量行字符串；没有任何可显示内容时返回空串。
 */
function renderUsageLine(ctx: MeterContext, config: Config, variant: Variant, now: number): string {
  const segments: string[] = [];

  if (config.showContext && ctx.context) {
    // 上下文有自己的一套阈值：它逼近上限的后果（触发压缩）与额度耗尽不同，
    // 值得单独调，所以这里显式传入而不是复用额度阈值
    const color = levelColor(
      ctx.context.percent,
      null,
      config,
      config.colors.context,
      config.thresholds.contextWarning,
      config.thresholds.contextCritical,
    );
    const parts = [paint(config.labels.context, config.colors.label)];
    if (variant.barWidth > 0) {
      const bar = splitBar(ctx.context.percent, variant.barWidth, config);
      parts.push(paint(bar.filled, color) + paint(bar.empty, config.colors.barEmpty));
    }
    parts.push(paint(ctx.context.percent + '%', color));
    segments.push(parts.join(' '));
  }

  for (const win of selectWindows(ctx.windows, variant.maxWindows)) {
    segments.push(renderWindow(win, config, variant, now));
  }

  return segments.join(GAP);
}

/**
 * 渲染第一行（模型 / 路径 / 分支 / 花费）。
 *
 * Args:
 *   ctx: 渲染上下文。
 *   config: 用户配置。
 *   pathLevels: 本次尝试保留的路径级数。
 *   showCost: 本次尝试是否显示花费。
 *   showBranch: 本次尝试是否显示分支。
 *
 * Returns:
 *   第一行字符串；无内容时返回空串。
 */
function renderIdentityLine(
  ctx: MeterContext,
  config: Config,
  pathLevels: number,
  showCost: boolean,
  showBranch: boolean,
): string {
  const segments: string[] = [];

  if (ctx.modelName) {
    const name = ctx.modelName + (ctx.isExtendedContext ? ' 1M' : '');
    segments.push(paint('◈ ' + name, config.colors.model));
  }

  const shortPath = formatPath(ctx.projectPath, pathLevels);
  if (shortPath) segments.push(paint(shortPath, config.colors.project));

  if (showBranch && config.showGitBranch && ctx.branch) {
    segments.push(paint('⎇ ' + ctx.branch, config.colors.git));
  }

  if (showCost && config.showCost && ctx.costUsd !== null && ctx.costUsd > 0) {
    // 订阅账户看到的花费不是账单，而是"这些 token 按 API 价目表值多少钱"，
    // 加 ≈ 是为了避免被读成"我这次对话被扣了 25 美元"
    const marker = ctx.costIsEstimate ? '≈' : '';
    segments.push(paint(marker + '$' + ctx.costUsd.toFixed(2), config.colors.cost));
  }

  return segments.join(GAP);
}

/**
 * 渲染完整的状态栏。
 *
 * 先各自为两行生成由宽到窄的候选方案，取第一个放得下的；全都放不下时用最紧凑的
 * 那一版再硬截断，保证任何情况下都不折行。
 *
 * Args:
 *   ctx: 渲染上下文。
 *   config: 用户配置。
 *   now: 当前时刻（毫秒）。
 *
 * Returns:
 *   可直接写到 stdout 的多行字符串（不含结尾换行）。
 */
export function render(ctx: MeterContext, config: Config, now: number): string {
  const columns = config.maxWidth ?? ctx.columns;
  const lines: string[] = [];

  if (config.showLine1) {
    // 第一行降级顺序：完整 → 去花费 → 去分支 → 路径只留一级 → 硬截断
    const candidates = [
      renderIdentityLine(ctx, config, config.pathLevels, true, true),
      renderIdentityLine(ctx, config, config.pathLevels, false, true),
      renderIdentityLine(ctx, config, config.pathLevels, false, false),
      renderIdentityLine(ctx, config, 1, false, false),
    ];
    const fitted = candidates.find((line) => stringWidth(line) <= columns);
    const chosen = fitted ?? truncate(candidates[candidates.length - 1] ?? '', columns);
    if (chosen) lines.push(chosen);
  }

  const baseBar = config.barWidth === 'auto' ? autoBarWidth(columns) : config.barWidth;
  const windowCount = ctx.windows.length;
  // 用量行降级顺序：满配 → 去倒计时 → 缩短进度条 → 去掉进度条 → 逐个丢弃靠后的窗口
  const variants: Variant[] = [
    { barWidth: baseBar, countdown: true, maxWindows: windowCount },
    { barWidth: baseBar, countdown: false, maxWindows: windowCount },
    { barWidth: Math.min(baseBar, 6), countdown: false, maxWindows: windowCount },
    { barWidth: Math.min(baseBar, 4), countdown: false, maxWindows: windowCount },
    { barWidth: 0, countdown: false, maxWindows: windowCount },
  ];
  for (let count = windowCount - 1; count >= 1; count--) {
    variants.push({ barWidth: 0, countdown: false, maxWindows: count });
  }

  const usageCandidates = variants.map((v) => renderUsageLine(ctx, config, v, now));
  const fittedUsage = usageCandidates.find((line) => stringWidth(line) <= columns);
  const usageLine = fittedUsage ?? truncate(usageCandidates[usageCandidates.length - 1] ?? '', columns);
  if (usageLine) lines.push(usageLine);

  return lines.join('\n');
}
