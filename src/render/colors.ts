/**
 * ANSI 配色。
 *
 * 尊重 NO_COLOR 约定（https://no-color.org/）：设置了该环境变量就完全不输出转义序列，
 * 这对把状态栏重定向到文件或在不支持颜色的终端里运行的用户是必要的。
 */
import type { ColorName, Config } from '../config.js';
import type { LimitSeverity } from '../types.js';

/** 颜色名到 ANSI SGR 参数的映射。 */
const CODES: Record<ColorName, string> = {
  black: '30', red: '31', green: '32', yellow: '33',
  blue: '34', magenta: '35', cyan: '36', white: '37',
  brightRed: '91', brightGreen: '92', brightYellow: '93',
  brightBlue: '94', brightMagenta: '95',
  dim: '2', none: '',
};

const ESC = String.fromCharCode(0x1b);
const RESET = ESC + '[0m';

/**
 * 判断当前环境是否应该输出颜色。
 *
 * Returns:
 *   允许输出颜色时返回 true。
 */
function colorEnabled(): boolean {
  if (process.env['NO_COLOR'] !== undefined) return false;
  if (process.env['CLAUDEMETER_NO_COLOR'] !== undefined) return false;
  return true;
}

/**
 * 给一段文本上色。
 *
 * Args:
 *   text: 待上色的文本。
 *   color: 颜色名，'none' 或环境禁用颜色时原样返回。
 *
 * Returns:
 *   带 ANSI 序列的字符串。
 */
export function paint(text: string, color: ColorName): string {
  if (color === 'none' || !text || !colorEnabled()) return text;
  const code = CODES[color];
  if (!code) return text;
  return ESC + '[' + code + 'm' + text + RESET;
}

/**
 * 把服务端严重度与本地阈值判定的档位合成一个最终档位。
 *
 * 取"更严重者"而不是让某一方单方面覆盖：
 *   - 服务端知道账户的真实档位，能把某个窗口主动升级成告警（例如 Fable 95% 标 critical），
 *     这种升级必须被尊重；
 *   - 但服务端把一个已经用掉 58% 的窗口标成 normal 时，不应该压掉本地阈值 ——
 *     否则"过半变黄"这条规则在大多数时候都不会生效。
 *
 * Args:
 *   percent: 已用百分比。
 *   severity: 服务端给的严重度，可能为 null。
 *   warningAt: 本地告警阈值。
 *   criticalAt: 本地严重阈值。
 *
 * Returns:
 *   0=充足，1=告警，2=严重。
 */
function resolveLevel(
  percent: number,
  severity: LimitSeverity | null,
  warningAt: number,
  criticalAt: number,
): 0 | 1 | 2 {
  const fromServer = severity === 'critical' ? 2 : severity === 'warning' ? 1 : 0;
  const fromPercent = percent >= criticalAt ? 2 : percent >= warningAt ? 1 : 0;
  return Math.max(fromServer, fromPercent) as 0 | 1 | 2;
}

/**
 * 根据百分比和服务端严重度决定用哪种颜色。
 *
 * Args:
 *   percent: 已用百分比。
 *   severity: 服务端给的严重度，可能为 null。
 *   config: 用户配置（提供颜色表）。
 *   baseColor: 充足档位使用的颜色。
 *   warningAt: 告警阈值，默认取配置里的额度阈值。
 *   criticalAt: 严重阈值，同上。
 *
 * Returns:
 *   应当使用的颜色名。
 */
export function levelColor(
  percent: number,
  severity: LimitSeverity | null,
  config: Config,
  baseColor: ColorName,
  warningAt: number = config.thresholds.warning,
  criticalAt: number = config.thresholds.critical,
): ColorName {
  const level = resolveLevel(percent, severity, warningAt, criticalAt);
  if (level === 2) return config.colors.critical;
  if (level === 1) return config.colors.warning;
  return baseColor;
}
