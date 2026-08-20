/**
 * 终端输出消毒。
 *
 * 状态栏里会出现三类不可信文本：模型显示名（服务端下发）、git 分支名、项目路径。
 * 它们会被原样写进终端，因此必须先剥掉 ANSI 转义序列与控制字符，
 * 否则一个构造过的名字就能改写终端状态、伪造输出甚至隐藏内容。
 *
 * 实现上刻意不在源码里内联真实的控制字符：正则用 String.fromCharCode 拼装，
 * 控制字符用码点区间判断。这样源文件本身保持纯 ASCII，便于审计与 diff。
 */

/** ESC，所有 ANSI 转义序列的起始字符。 */
const ESC = String.fromCharCode(0x1b);
/** BEL，OSC 序列的一种终结符。 */
const BEL = String.fromCharCode(0x07);

/**
 * 匹配完整的 ANSI 转义序列：
 *   - CSI：ESC [ 参数 中间字符 终结字符（SGR 配色就是这一类）
 *   - OSC：ESC ] ... BEL 或 ESC ] ... ESC \（超链接、改标题都走这里）
 *   - 双字符 Fe 序列：ESC 后跟单个 @-_ 区间字符
 */
const ANSI_PATTERN = new RegExp(
  [
    `${ESC}\\[[0-9;?]*[ -\\/]*[@-~]`,
    `${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`,
    `${ESC}[@-Z\\\\-_]`,
  ].join('|'),
  'g',
);

/**
 * 判断一个码点是否属于必须剔除的不可见/危险字符。
 *
 * 覆盖：C0 控制字符、DEL 与 C1 控制字符、零宽字符、行/段分隔符、
 * 双向文本控制字符（可用来把文本反向渲染以伪造内容）、以及 BOM。
 *
 * Args:
 *   cp: Unicode 码点。
 *
 * Returns:
 *   需要剔除时返回 true。
 */
function isUnsafeCodePoint(cp: number): boolean {
  if (cp < 0x20) return true;
  if (cp >= 0x7f && cp <= 0x9f) return true;
  if (cp >= 0x200b && cp <= 0x200f) return true;
  if (cp === 0x2028 || cp === 0x2029) return true;
  if (cp >= 0x202a && cp <= 0x202e) return true;
  if (cp >= 0x2066 && cp <= 0x2069) return true;
  if (cp === 0xfeff) return true;
  return false;
}

/**
 * 把任意外部字符串清洗成可以安全打印到终端的形式。
 *
 * 先整段剥掉 ANSI 序列（只删 ESC 会留下 "[0m" 这种可见残渣），再逐码点滤掉控制字符。
 *
 * Args:
 *   value: 待清洗的值，任意类型。
 *   maxLength: 允许的最大字符数，超出则截断（默认 64）。
 *
 * Returns:
 *   清洗后的字符串；输入不是字符串、或清洗后为空时返回 null。
 */
export function sanitizeText(value: unknown, maxLength = 64): string | null {
  if (typeof value !== 'string') return null;
  let out = '';
  for (const ch of value.replace(ANSI_PATTERN, '')) {
    const cp = ch.codePointAt(0);
    if (cp === undefined || isUnsafeCodePoint(cp)) continue;
    out += ch;
    if (out.length >= maxLength) break;
  }
  const trimmed = out.trim();
  return trimmed ? trimmed : null;
}
