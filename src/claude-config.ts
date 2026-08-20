/**
 * 读取 ~/.claude.json 中 Claude Code 自己维护的用量缓存。
 *
 * 这是本插件存在的理由：statusline 的 stdin 只有 five_hour / seven_day 两个窗口，
 * 没有任何按模型拆分的额度；而这个文件里的 cachedUsageUtilization.utilization.limits[]
 * 带有 kind === 'weekly_scoped' 的条目（例如 Fable 的周额度），是 /usage 命令的同源数据。
 *
 * 隐私边界（重要）：这个文件同时含有 oauthAccount.emailAddress、accountUuid、machineID
 * 以及全部 projects 历史。本模块只提取下面白名单里的字段，其余一概不读出、不落盘、不渲染。
 */
import { readFileSync, statSync } from 'node:fs';
import { sanitizeText } from './sanitize.js';
import { normalizePercent } from './stdin.js';
import type {
  CachedLimitEntry,
  ClaudeJsonData,
  ClaudeJsonUsageCache,
  LimitSeverity,
  MeterWindow,
} from './types.js';

/**
 * 超过这个体积就不做整文件 JSON.parse。
 * 本机实测 97KB 解析只要 1.8ms，但有些用户的 projects 字段会涨到数 MB，
 * 那时整文件解析会突破状态栏的时间预算，改用定点截取。
 */
const FULL_PARSE_MAX_BYTES = 2 * 1024 * 1024;
/** 文件体积硬上限，再大就直接放弃，不值得为状态栏冒内存风险。 */
const HARD_MAX_BYTES = 64 * 1024 * 1024;
/** 最多接受多少个限额窗口，防御服务端返回异常长的数组。 */
const MAX_WINDOWS = 12;
/** 窗口标签的最大长度。 */
const MAX_LABEL_LENGTH = 16;

/** 从 ~/.claude.json 提炼出的、可安全向下游传递的快照。 */
export interface ClaudeJsonSnapshot {
  /** 这份缓存的抓取时刻（毫秒）。拿不到就是 null，此时无法判断陈旧度。 */
  fetchedAtMs: number | null;
  /** 归一化后的限额窗口。 */
  windows: MeterWindow[];
  /** 订阅套餐标识，仅用于显示，不含任何可识别个人身份的信息。 */
  planTier: string | null;
  /**
   * 是否为 Claude.ai 订阅账户（Pro / Max / Team / Enterprise）。
   * 判据是 oauthAccount.organizationType 以 claude_ 开头（实测值如 claude_max）。
   * 订阅账户不按 token 付费，因此会话花费只是折算值；用 API key 的账户则接近真实扣费。
   */
  isSubscription: boolean;
}

/**
 * 从一段 JSON 文本里定点截取某个键对应的对象字面量。
 *
 * 用于超大 ~/.claude.json：整文件 parse 太慢，但我们只要其中一个几 KB 的子对象。
 * 通过括号配对扫描实现，扫描时正确跳过字符串字面量与转义字符。
 *
 * Args:
 *   text: 完整的 JSON 文本。
 *   key: 要提取的键名（不含引号）。
 *
 * Returns:
 *   该键对应的对象子串；找不到或括号不配对时返回 null。
 */
function extractObjectForKey(text: string, key: string): string | null {
  const keyIndex = text.indexOf('"' + key + '"');
  if (keyIndex < 0) return null;
  const braceStart = text.indexOf('{', keyIndex + key.length + 2);
  if (braceStart < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = braceStart; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(braceStart, i + 1);
    }
  }
  return null;
}

/**
 * 读出 ~/.claude.json 中我们关心的两个字段。
 *
 * 小文件走整体解析；大文件退化为定点截取 cachedUsageUtilization，
 * 此时放弃 oauthAccount（套餐名只是锦上添花，不值得为它多扫一遍）。
 *
 * Args:
 *   path: ~/.claude.json 的绝对路径。
 *
 * Returns:
 *   解析出的对象；文件不存在、过大或 JSON 非法时返回 null。
 */
function readClaudeJson(path: string): ClaudeJsonData | null {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return null;
  }
  if (size === 0 || size > HARD_MAX_BYTES) return null;

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }

  if (size <= FULL_PARSE_MAX_BYTES) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return parsed as ClaudeJsonData;
      return null;
    } catch {
      return null;
    }
  }

  const slice = extractObjectForKey(text, 'cachedUsageUtilization');
  if (!slice) return null;
  try {
    return { cachedUsageUtilization: JSON.parse(slice) as ClaudeJsonUsageCache };
  } catch {
    return null;
  }
}

/**
 * 把服务端给的 severity 字符串收敛到我们认识的三档。
 *
 * Args:
 *   value: limits[].severity 的原始值。
 *
 * Returns:
 *   'normal' | 'warning' | 'critical'；无法识别时返回 null，配色回退到本地阈值。
 */
function parseSeverity(value: unknown): LimitSeverity | null {
  if (value === 'normal' || value === 'warning' || value === 'critical') return value;
  return null;
}

/**
 * 解析 ISO-8601 的重置时刻。
 *
 * 注意：本文件里的 resets_at 是 ISO 字符串，而 statusline stdin 里的是 Unix 秒，
 * 两者格式不同，绝不能共用同一个解析函数。
 *
 * Args:
 *   value: limits[].resets_at 的原始值。
 *
 * Returns:
 *   Date 对象；缺失或非法时返回 null。
 */
function parseResetAt(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

/**
 * 把 limits[] 里的一条记录归一化成渲染层的 MeterWindow。
 *
 * kind 的三种已知取值分别映射为 5 小时窗口、全模型周窗口、按模型周窗口。
 * 未知 kind 也会保留（用 other: 前缀），这样 Anthropic 将来新增窗口类型时无需改代码。
 *
 * Args:
 *   entry: limits[] 中的一项。
 *   index: 该项在数组中的下标，用于在模型名缺失时兜底生成唯一 key。
 *   ageMs: 这份缓存的年龄（毫秒），可能为 null。
 *
 * Returns:
 *   MeterWindow；percent 非法或 kind 缺失时返回 null（丢弃该条）。
 */
function toWindow(entry: CachedLimitEntry, index: number, ageMs: number | null): MeterWindow | null {
  const percent = normalizePercent(entry.percent);
  if (percent === null) return null;

  const kind = typeof entry.kind === 'string' ? entry.kind : '';
  const resetAt = parseResetAt(entry.resets_at);
  const severity = parseSeverity(entry.severity);
  const base = { percent, resetAt, severity, source: 'cache' as const, ageMs };

  if (kind === 'session') return { ...base, key: 'session', label: '5H' };
  if (kind === 'weekly_all') return { ...base, key: 'weekly', label: 'WEEK' };
  if (kind === 'weekly_scoped') {
    // 模型名由服务端下发，会直接进终端，必须消毒并限长
    const name = sanitizeText(entry.scope?.model?.display_name, MAX_LABEL_LENGTH);
    const label = (name ?? 'SCOPED' + index).toUpperCase();
    return { ...base, key: 'scoped:' + label, label };
  }
  if (!kind) return null;
  const label = (sanitizeText(kind, MAX_LABEL_LENGTH) ?? 'OTHER' + index).toUpperCase();
  return { ...base, key: 'other:' + kind, label };
}

/**
 * 读取并归一化 ~/.claude.json 里的用量缓存。
 *
 * 优先使用 utilization.limits[]，它是稳定契约（kind / percent / severity / resets_at / scope）。
 * 顶层那些 seven_day_opus、nimbus_quill、tangelo 之类的键是不稳定的内部代号，
 * 会随 Anthropic 的实验来去，**绝不遍历**；只在 limits[] 缺失时才回退读取
 * 明确已知的 five_hour / seven_day 两个键。
 *
 * Args:
 *   path: ~/.claude.json 的绝对路径。
 *   now: 当前时刻（毫秒），由调用方注入以便测试。
 *
 * Returns:
 *   快照；文件不可读或没有用量字段时返回 null。
 */
export function readUsageSnapshot(path: string, now: number): ClaudeJsonSnapshot | null {
  const data = readClaudeJson(path);
  const cache = data?.cachedUsageUtilization;
  if (!cache) return null;

  const fetchedAtMs =
    typeof cache.fetchedAtMs === 'number' && Number.isFinite(cache.fetchedAtMs)
      ? cache.fetchedAtMs
      : null;
  const ageMs = fetchedAtMs === null ? null : Math.max(0, now - fetchedAtMs);

  const windows: MeterWindow[] = [];
  const limits = cache.utilization?.limits;
  if (Array.isArray(limits)) {
    for (const [index, entry] of limits.entries()) {
      if (windows.length >= MAX_WINDOWS) break;
      if (!entry || typeof entry !== 'object') continue;
      const win = toWindow(entry, index, ageMs);
      if (win && !windows.some((w) => w.key === win.key)) windows.push(win);
    }
  }

  // limits[] 缺失时的兼容回退：只读这两个名字明确的键，不做任何遍历
  if (windows.length === 0) {
    const five = cache.utilization?.five_hour;
    const seven = cache.utilization?.seven_day;
    const fivePercent = normalizePercent(five?.utilization);
    if (fivePercent !== null) {
      windows.push({
        key: 'session', label: '5H', percent: fivePercent,
        resetAt: parseResetAt(five?.resets_at), severity: null, source: 'cache', ageMs,
      });
    }
    const sevenPercent = normalizePercent(seven?.utilization);
    if (sevenPercent !== null) {
      windows.push({
        key: 'weekly', label: 'WEEK', percent: sevenPercent,
        resetAt: parseResetAt(seven?.resets_at), severity: null, source: 'cache', ageMs,
      });
    }
  }

  if (windows.length === 0) return null;

  const orgType = data?.oauthAccount?.organizationType;
  return {
    fetchedAtMs,
    windows,
    planTier: sanitizeText(data?.oauthAccount?.organizationRateLimitTier, 32),
    isSubscription: typeof orgType === 'string' && orgType.startsWith('claude_'),
  };
}
