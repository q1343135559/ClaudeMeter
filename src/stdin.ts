/**
 * statusline stdin 的读取与解析。
 *
 * Claude Code 把会话状态以单个 JSON 的形式写进本进程的 stdin。这里要处理三件事：
 *   1. stdin 可能永远不来数据（例如用户手工执行本脚本），必须有超时，不能挂死
 *   2. JSON 可能分多个 chunk 到达，要等到能成功解析为止
 *   3. 任何解析失败都返回 null 而不是抛异常 —— 状态栏宁可少显示也不能刷屏报错
 */
import type { StdinData, ContextState } from './types.js';

/** 等待第一个字节的超时。超过说明根本没人喂数据，直接放弃。 */
const FIRST_BYTE_TIMEOUT_MS = 250;
/** 收到数据后的空闲超时。用于判断"这一批数据发完了"。 */
const IDLE_TIMEOUT_MS = 50;
/** stdin 读取上限，防御异常大的输入把内存吃光。 */
const MAX_INPUT_BYTES = 256 * 1024;

/**
 * 从 stdin 读取并解析 Claude Code 的会话 JSON。
 *
 * Returns:
 *   解析成功返回 StdinData；超时、无数据或 JSON 非法一律返回 null。
 */
export function readStdin(): Promise<StdinData | null> {
  return new Promise((resolve) => {
    let buffer = '';
    let settled = false;
    let firstByteTimer: NodeJS.Timeout | null = null;
    let idleTimer: NodeJS.Timeout | null = null;

    /** 收尾：清定时器、断开 stdin、尝试解析已收到的内容。 */
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (firstByteTimer) clearTimeout(firstByteTimer);
      if (idleTimer) clearTimeout(idleTimer);
      process.stdin.pause();
      process.stdin.removeAllListeners();
      const text = buffer.trim();
      if (!text) return resolve(null);
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return resolve(parsed as StdinData);
        }
        return resolve(null);
      } catch {
        return resolve(null);
      }
    };

    firstByteTimer = setTimeout(finish, FIRST_BYTE_TIMEOUT_MS);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      if (firstByteTimer) {
        clearTimeout(firstByteTimer);
        firstByteTimer = null;
      }
      buffer += chunk;
      if (buffer.length > MAX_INPUT_BYTES) return finish();
      // 数据可能分片到达，能解析成功就立刻收工，否则再等一小会儿
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, IDLE_TIMEOUT_MS);
    });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    process.stdin.resume();
  });
}

/**
 * 把 0-100 之外的脏数据夹到合法区间，并四舍五入成整数。
 *
 * Args:
 *   value: 任意来源的百分比，可能是 null / NaN / 超界值。
 *
 * Returns:
 *   0-100 的整数；输入不是有限数值时返回 null。
 */
export function normalizePercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * 从 stdin 数据解析出上下文窗口占用。
 *
 * 优先用 Claude Code 预先算好的 used_percentage。这里把 0 视作"尚未填充"而非"真的 0%"：
 * 新会话在第一次 API 响应之前该字段就是 0，但 current_usage 可能已经有真实数值，
 * 此时按 token 自算更准。自算公式必须与官方一致 —— 只算 input，不含 output。
 *
 * Args:
 *   stdin: Claude Code 传入的会话数据。
 *
 * Returns:
 *   ContextState；上下文信息完全拿不到时返回 null。
 */
export function getContextState(stdin: StdinData): ContextState | null {
  const cw = stdin.context_window;
  if (!cw) return null;

  const windowSize =
    typeof cw.context_window_size === 'number' && cw.context_window_size > 0
      ? cw.context_window_size
      : null;

  const native = normalizePercent(cw.used_percentage);
  if (native !== null && native > 0) {
    return { percent: native, windowSize };
  }

  const usage = cw.current_usage;
  if (usage && windowSize) {
    const inputTokens =
      (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0);
    if (inputTokens > 0) {
      const computed = normalizePercent((inputTokens / windowSize) * 100);
      if (computed !== null) return { percent: computed, windowSize };
    }
  }

  // used_percentage 明确为 0 且没有 token 明细，说明会话刚开始，显示 0% 是对的
  if (native === 0) return { percent: 0, windowSize };
  return null;
}
