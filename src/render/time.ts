/**
 * 时间格式化。
 *
 * 状态栏空间极其有限，所以一律用最粗的单位表达："还有 2 小时 14 分"写成 2h14m，
 * "还有 3 天"直接写 3d，不再往下细分。
 */

/**
 * 把一段时长格式化成紧凑的倒计时。
 *
 * Args:
 *   ms: 剩余毫秒数。
 *
 * Returns:
 *   形如 "3d" / "2h14m" / "45m" / "30s" 的字符串；输入非正数时返回 null。
 */
export function formatDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return Math.max(1, Math.floor(ms / 1000)) + 's';

  const days = Math.floor(totalMinutes / 1440);
  // 超过一天就只报天数：周窗口剩 3 天时，具体到分钟没有任何决策价值
  if (days >= 1) {
    const hours = Math.floor((totalMinutes % 1440) / 60);
    return hours > 0 && days < 3 ? days + 'd' + hours + 'h' : days + 'd';
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 1) return minutes > 0 ? hours + 'h' + minutes + 'm' : hours + 'h';
  return minutes + 'm';
}

/**
 * 把数据年龄格式化成简短标记，用于提示缓存陈旧。
 *
 * Args:
 *   ms: 数据距今的毫秒数。
 *
 * Returns:
 *   形如 "8m" / "2h" 的字符串；输入非正数时返回 null。
 */
export function formatAge(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return null;
  if (minutes < 60) return minutes + 'm';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h';
  return Math.floor(hours / 24) + 'd';
}
