/**
 * 项目路径的显示形式。
 */
import { homedir } from 'node:os';
import { sanitizeText } from '../sanitize.js';

/**
 * 把绝对路径压缩成适合状态栏显示的短路径。
 *
 * 家目录替换成 ~，然后只保留末尾若干级目录。保留两级（默认）通常刚好能区分
 * "哪个项目"与"项目里的哪个子目录"，而完整路径在状态栏里几乎必然被截断。
 *
 * 注意 ~ 本身不算一级：~/Project/App 在 levels=2 时应当原样显示，
 * 而不是变成 …/Project/App —— 后者既没省下宽度，又丢掉了"就在家目录下"这个信息，
 * 还会让 ~/Project/App 和 ~/Desktop/Project/App 显示成同一个字符串。
 *
 * Args:
 *   raw: 绝对路径，通常来自 stdin 的 workspace.current_dir。
 *   levels: 保留的末级目录数量。
 *
 * Returns:
 *   显示用路径；输入为空时返回 null。
 */
export function formatPath(raw: string | null | undefined, levels: number): string | null {
  const cleaned = sanitizeText(raw, 512);
  if (!cleaned) return null;

  const home = homedir();
  const underHome = Boolean(home) && (cleaned === home || cleaned.startsWith(home + '/'));
  const normalized = underHome ? '~' + cleaned.slice(home.length) : cleaned;

  // 去掉 ~ 前缀后再数层级，保证 ~ 不占用 levels 配额
  const body = underHome ? normalized.slice(1) : normalized;
  const parts = body.split('/').filter((p) => p.length > 0);
  if (parts.length === 0) return underHome ? '~' : '/';
  if (parts.length <= levels) return normalized;

  return '…/' + parts.slice(-levels).join('/');
}
