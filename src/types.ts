/**
 * ClaudeMeter 全局类型定义。
 *
 * 这里同时描述了三类数据的形状：
 *   1. Claude Code 通过 stdin 传给 statusline 命令的 JSON（StdinData）
 *   2. ~/.claude.json 里 Claude Code 自己维护的用量缓存（ClaudeJsonUsageCache）
 *   3. 本插件内部统一后的渲染模型（MeterWindow / MeterContext）
 *
 * 前两类是外部契约，字段全部按 optional 声明 —— Claude Code 会随版本增删字段，
 * 任何一个字段缺失都不应该让状态栏崩掉。
 */

// ---------------------------------------------------------------------------
// 1. statusline stdin 契约
//    参考 https://code.claude.com/docs/en/statusline
// ---------------------------------------------------------------------------

/** 上下文窗口中各类 token 的明细，首次 API 调用前与 /compact 之后为 null。 */
export interface ContextCurrentUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** 上下文窗口状态，来自最近一次 API 响应。 */
export interface ContextWindow {
  total_input_tokens?: number;
  total_output_tokens?: number;
  /** 模型的上下文上限，200000 或 1000000。不要硬编码，一律读这个字段。 */
  context_window_size?: number;
  /** Claude Code 预先算好的已用百分比，只统计 input（含 cache 读写），不含 output。 */
  used_percentage?: number | null;
  remaining_percentage?: number | null;
  current_usage?: ContextCurrentUsage | null;
}

/** stdin 里的单个限额窗口。注意 resets_at 是 Unix 秒，不是毫秒也不是 ISO 字符串。 */
export interface StdinRateLimitWindow {
  used_percentage?: number;
  resets_at?: number;
}

/**
 * 订阅限额。仅 Claude.ai 订阅用户（Pro/Max）且本会话已发生过第一次 API 响应后才出现，
 * 且 five_hour / seven_day 可以各自独立缺失 —— 这正是 claude-hud 周用量时有时无的原因之一。
 */
export interface StdinRateLimits {
  five_hour?: StdinRateLimitWindow;
  seven_day?: StdinRateLimitWindow;
}

/** Claude Code 传给 statusline 命令的完整 stdin JSON。 */
export interface StdinData {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  version?: string;
  model?: { id?: string; display_name?: string };
  workspace?: {
    current_dir?: string;
    project_dir?: string;
    added_dirs?: string[];
    git_worktree?: string;
    repo?: { host?: string; owner?: string; name?: string };
  };
  cost?: {
    total_cost_usd?: number;
    total_duration_ms?: number;
    total_api_duration_ms?: number;
    total_lines_added?: number;
    total_lines_removed?: number;
  };
  context_window?: ContextWindow;
  exceeds_200k_tokens?: boolean;
  fast_mode?: boolean;
  effort?: { level?: string };
  thinking?: { enabled?: boolean };
  rate_limits?: StdinRateLimits;
  output_style?: { name?: string };
  session_name?: string;
}

// ---------------------------------------------------------------------------
// 2. ~/.claude.json 里的用量缓存契约
//    这是 /usage 命令的同源数据，也是拿到按模型窗口（如 Fable）的唯一免凭证途径。
// ---------------------------------------------------------------------------

/** Anthropic 对某个限额窗口的严重度判定，直接用于配色，优先于本地阈值。 */
export type LimitSeverity = 'normal' | 'warning' | 'critical';

/**
 * limits[] 里的单条限额记录。
 * kind 目前观察到三种取值：
 *   - session       5 小时滚动窗口
 *   - weekly_all    全模型周窗口
 *   - weekly_scoped 按模型的周窗口，模型名在 scope.model.display_name（例如 "Fable"）
 * resets_at 这里是 ISO-8601 字符串，与 stdin 的 Unix 秒不同，解析时不要混用。
 */
export interface CachedLimitEntry {
  kind?: string;
  group?: string;
  percent?: number;
  severity?: string;
  resets_at?: string | null;
  scope?: { model?: { id?: string | null; display_name?: string | null } | null; surface?: unknown } | null;
  is_active?: boolean;
}

/** 顶层的按窗口聚合值，作为 limits[] 缺失时的兼容回退。 */
export interface CachedUtilizationWindow {
  utilization?: number | null;
  resets_at?: string | null;
}

/** ~/.claude.json 的 cachedUsageUtilization 字段。 */
export interface ClaudeJsonUsageCache {
  /** 这份缓存的抓取时刻（毫秒时间戳），用来计算陈旧度。 */
  fetchedAtMs?: number;
  accountUuid?: string;
  utilization?: {
    five_hour?: CachedUtilizationWindow | null;
    seven_day?: CachedUtilizationWindow | null;
    limits?: CachedLimitEntry[];
    [key: string]: unknown;
  };
}

/** ~/.claude.json 中本插件会读到的字段（其余字段一概不碰）。 */
export interface ClaudeJsonData {
  cachedUsageUtilization?: ClaudeJsonUsageCache;
  oauthAccount?: {
    organizationType?: string;
    organizationRateLimitTier?: string;
  };
}

// ---------------------------------------------------------------------------
// 3. 内部渲染模型
// ---------------------------------------------------------------------------

/** 一个限额窗口在渲染层的统一表示，5H / WEEK / FABLE 都是它。 */
export interface MeterWindow {
  /** 稳定标识：'session' | 'weekly' | 'scoped:<模型名>'，用于排序与配置过滤。 */
  key: string;
  /** 状态栏上显示的短标签，例如 5H / WEEK / FABLE。 */
  label: string;
  /** 已用百分比，0-100。 */
  percent: number;
  /** 窗口重置时刻，拿不到就是 null（此时不显示倒计时）。 */
  resetAt: Date | null;
  /** Anthropic 给出的严重度，没有则为 null，配色回退到本地阈值。 */
  severity: LimitSeverity | null;
  /** 数据来源。stdin 是实时的；cache 可能陈旧，需要标注年龄。 */
  source: 'stdin' | 'cache';
  /** 仅 source === 'cache' 时有值：数据距今多少毫秒。 */
  ageMs: number | null;
}

/** 上下文窗口在渲染层的表示。 */
export interface ContextState {
  percent: number;
  /** 上下文上限，用于第一行判断是否标注 1M。 */
  windowSize: number | null;
}

/** 渲染所需的全部输入，render 层只认这个结构，便于测试。 */
export interface MeterContext {
  modelName: string | null;
  /** 上下文上限 >= 1M 时为 true，第一行会在模型名后加 " 1M"。 */
  isExtendedContext: boolean;
  projectPath: string | null;
  branch: string | null;
  costUsd: number | null;
  /**
   * 花费是否只是折算值而非真实账单。
   * 订阅账户（Pro/Max/Team）下 Claude Code 报出的 cost 是"这些 token 按 API 价目表值多少钱"，
   * 用户并不会为此付费，所以要在数字前加 ≈ 以免被误读成账单。
   */
  costIsEstimate: boolean;
  context: ContextState | null;
  windows: MeterWindow[];
  /** 可用渲染宽度（列），已扣掉输入框 padding。 */
  columns: number;
}
