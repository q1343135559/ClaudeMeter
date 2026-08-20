/**
 * 进度条渲染。
 */
import type { Config } from '../config.js';

/** 进度条拆成的两段，便于分别上色。 */
export interface BarParts {
  /** 已用部分，用档位颜色。 */
  filled: string;
  /** 未用部分，用暗色，让"还剩多少"一眼可辨。 */
  empty: string;
}

/**
 * 把百分比换算成进度条的两段字符。
 *
 * 用 Math.round 而不是 Math.floor：向下取整会让 1%-9% 全部显示成空条，
 * 用户看不出"已经开始消耗"和"完全没用"的区别。同理，只要百分比大于 0
 * 就至少点亮一格；反过来只要没到 100% 就至少留一格空，避免"看起来已经满了"。
 *
 * Args:
 *   percent: 已用百分比，0-100。
 *   width: 进度条格数；<=0 时两段都是空串。
 *   config: 提供填充与空白字符。
 *
 * Returns:
 *   已用与未用两段字符串。
 */
export function splitBar(percent: number, width: number, config: Config): BarParts {
  if (width <= 0) return { filled: '', empty: '' };
  const clamped = Math.min(100, Math.max(0, percent));
  let filled = Math.round((clamped / 100) * width);
  if (clamped > 0 && filled === 0) filled = 1;
  if (clamped < 100 && filled === width) filled = width - 1;
  return {
    filled: config.barFilled.repeat(filled),
    empty: config.barEmpty.repeat(width - filled),
  };
}

/**
 * 画一条定宽的进度条（不上色的纯文本形式）。
 *
 * Args:
 *   percent: 已用百分比，0-100。
 *   width: 进度条格数。
 *   config: 提供填充与空白字符。
 *
 * Returns:
 *   进度条字符串。
 */
export function renderBar(percent: number, width: number, config: Config): string {
  const { filled, empty } = splitBar(percent, width, config);
  return filled + empty;
}
