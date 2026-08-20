/**
 * 终端显示宽度计算与截断。
 *
 * 需要它是因为状态栏必须在一行内放下：一旦超出终端宽度就会折行，
 * 而折行的状态栏会把 Claude Code 的输入区顶掉，观感很差。
 * 计算时必须区分"字符数"和"终端列数"——中日韩文字、全角标点、emoji 都占两列。
 */

/** ANSI 转义序列，测量宽度前必须先剥掉，否则会把不可见的转义码算成可见宽度。 */
const ANSI_PATTERN = new RegExp(String.fromCharCode(0x1b) + '\\[[0-9;]*m', 'g');

/**
 * 判断一个码点在终端里是否占两列。
 *
 * 覆盖 Unicode 里 East Asian Wide / Fullwidth 的主要区段：CJK 统一表意文字、
 * 假名、谚文、CJK 标点、全角 ASCII，以及绝大多数彩色 emoji。
 * East Asian Ambiguous（例如进度条用的 ▓ ░）按 1 列处理，这是现代终端的默认行为。
 *
 * Args:
 *   cp: Unicode 码点。
 *
 * Returns:
 *   占两列时返回 true。
 */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // 谚文字母
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK 部首、假名标点
    (cp >= 0x3041 && cp <= 0x33ff) || // 平假名、片假名、CJK 兼容
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 扩展 A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 统一表意文字
    (cp >= 0xa000 && cp <= 0xa4cf) || // 彝文
    (cp >= 0xac00 && cp <= 0xd7a3) || // 谚文音节
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容表意文字
    (cp >= 0xfe10 && cp <= 0xfe19) || // 竖排标点
    (cp >= 0xfe30 && cp <= 0xfe6f) || // CJK 兼容形式
    (cp >= 0xff00 && cp <= 0xff60) || // 全角 ASCII
    (cp >= 0xffe0 && cp <= 0xffe6) || // 全角符号
    (cp >= 0x1f300 && cp <= 0x1f64f) || // 杂项符号与表情
    (cp >= 0x1f900 && cp <= 0x1f9ff) || // 补充符号与表情
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK 扩展 B 及以后
  );
}

/**
 * 剥掉字符串里的 ANSI 配色序列。
 *
 * Args:
 *   text: 可能带配色的字符串。
 *
 * Returns:
 *   只剩可见字符的字符串。
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/**
 * 计算字符串在终端里占用的列数。
 *
 * Args:
 *   text: 待测量的字符串，可以含 ANSI 配色。
 *
 * Returns:
 *   占用的终端列数。
 */
export function stringWidth(text: string): number {
  let width = 0;
  for (const ch of stripAnsi(text)) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    // 组合用记号（如声调符号）附着在前一个字符上，不额外占列
    if (cp >= 0x0300 && cp <= 0x036f) continue;
    if (cp === 0xfe0f || cp === 0xfe0e) continue; // 变体选择符
    width += isWide(cp) ? 2 : 1;
  }
  return width;
}

/**
 * 按终端列数截断字符串，超出时以省略号收尾。
 *
 * 逐码点累加宽度，保证不会把一个双列字符劈成一半。
 *
 * Args:
 *   text: 待截断的纯文本（不应含 ANSI，调用方负责在截断后再上色）。
 *   maxWidth: 允许的最大列数。
 *
 * Returns:
 *   截断后的字符串；原串本就不超宽时原样返回。
 */
export function truncate(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (stringWidth(text) <= maxWidth) return text;
  const ellipsis = '…';
  const budget = maxWidth - 1; // 给省略号留一列
  let width = 0;
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const chWidth = cp !== undefined && isWide(cp) ? 2 : 1;
    if (width + chWidth > budget) break;
    out += ch;
    width += chWidth;
  }
  return out + ellipsis;
}
