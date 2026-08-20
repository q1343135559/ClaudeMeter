/**
 * ClaudeMeter 配置的默认值、校验与加载。
 *
 * 设计原则：配置文件损坏绝不能让状态栏消失。因此每个字段都单独校验、单独回退，
 * 一个非法的键不会导致整份配置被丢弃；文件本身无法解析时则整体回退到默认值。
 */
import { readFileSync } from 'node:fs';
import { getConfigPath } from './paths.js';

/** 进度条的颜色档位，由百分比或服务端 severity 决定。 */
export type ColorName =
  | 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white'
  | 'brightRed' | 'brightGreen' | 'brightYellow' | 'brightBlue' | 'brightMagenta'
  | 'dim' | 'none';

/** ClaudeMeter 的完整配置。 */
export interface Config {
  /** 是否渲染第一行（模型 / 路径 / 分支 / 花费）。关掉就只剩用量条。 */
  showLine1: boolean;
  /** 是否显示上下文占用条。 */
  showContext: boolean;
  /** 是否显示 5 小时窗口。 */
  showFiveHour: boolean;
  /** 是否显示周窗口。默认 true 且没有任何百分比门槛 —— 这正是本插件相对 claude-hud 的关键差异。 */
  showWeekly: boolean;
  /** 是否显示按模型的周窗口（Fable 等）。 */
  showScoped: boolean;
  /** 只显示这些模型的按模型窗口（大小写不敏感）。留空表示全部显示。 */
  scopedFilter: string[];
  /** 是否显示未知类型的限额窗口（Anthropic 将来新增的 kind）。 */
  showUnknownWindows: boolean;
  /** 是否显示本会话花费。 */
  showCost: boolean;
  /** 是否显示 git 分支。 */
  showGitBranch: boolean;
  /** 项目路径保留的末级目录数量，1 表示只显示目录名。 */
  pathLevels: number;
  /** 进度条格数；'auto' 表示按终端宽度自适应。 */
  barWidth: number | 'auto';
  /** 进度条已用部分的字符。 */
  barFilled: string;
  /** 进度条剩余部分的字符。 */
  barEmpty: string;
  /** 各段的短标签。 */
  labels: { context: string; fiveHour: string; weekly: string };
  /**
   * 本地配色阈值（百分比）。
   * 与服务端下发的 severity 取"更严重者"：服务端可以把某个窗口升级成告警，
   * 但它标成 normal 并不会把本地阈值压下去 —— 否则用掉一半额度时还是一片绿。
   */
  thresholds: {
    warning: number;
    critical: number;
    contextWarning: number;
    contextCritical: number;
  };
  /**
   * 超过这个年龄的缓存数据开始标注陈旧（毫秒）。
   * 默认 20 分钟是实测出来的：Claude Code 刷新 ~/.claude.json 的间隔常态在 10-20 分钟，
   * 阈值定得比这更短会导致标记长期常亮，反而失去提示意义。设为 0 可让年龄始终可见。
   */
  staleWarnMs: number;
  /** 超过这个年龄的缓存数据直接不再显示（毫秒）。 */
  staleMaxMs: number;
  /** 是否在陈旧数据后面追加年龄标记。 */
  showStaleAge: boolean;
  /** 是否显示窗口重置倒计时。 */
  showResetCountdown: boolean;
  /** 各元素的颜色。 */
  colors: {
    /** 上下文条在"充足"档位的颜色。 */
    context: ColorName;
    /** 额度条在"充足"档位的颜色。 */
    usage: ColorName;
    /** 超过 warning 阈值时的颜色。 */
    warning: ColorName;
    /** 超过 critical 阈值时的颜色。 */
    critical: ColorName;
    /** 进度条中尚未用掉的那部分的颜色。 */
    barEmpty: ColorName;
    model: ColorName;
    project: ColorName;
    git: ColorName;
    label: ColorName;
    cost: ColorName;
  };
  /** 手动限定最大渲染宽度；null 表示用终端宽度。 */
  maxWidth: number | null;
}

/** 全部默认值。任何字段缺失或非法时都回退到这里对应的值。 */
export const DEFAULT_CONFIG: Config = {
  showLine1: true,
  showContext: true,
  showFiveHour: true,
  showWeekly: true,
  showScoped: true,
  scopedFilter: [],
  showUnknownWindows: false,
  showCost: true,
  showGitBranch: true,
  pathLevels: 2,
  barWidth: 'auto',
  barFilled: '▓',
  barEmpty: '░',
  labels: { context: 'CTX', fiveHour: '5H', weekly: 'WEEK' },
  // 充足=绿、过半=黄、只剩两成=淡红
  thresholds: { warning: 50, critical: 80, contextWarning: 50, contextCritical: 80 },
  staleWarnMs: 1_200_000,
  staleMaxMs: 21_600_000,
  showStaleAge: true,
  showResetCountdown: true,
  colors: {
    context: 'green',
    usage: 'green',
    warning: 'yellow',
    // 用淡红（bright red）而不是 red：后者在深色终端上偏暗发褐，
    // 在一堆彩色进度条里反而不够醒目
    critical: 'brightRed',
    barEmpty: 'dim',
    model: 'cyan',
    project: 'yellow',
    git: 'magenta',
    label: 'dim',
    cost: 'green',
  },
  maxWidth: null,
};

/** 允许出现在配置里的颜色名，用于校验。 */
const VALID_COLORS = new Set<string>([
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta',
  'dim', 'none',
]);

/**
 * 取一个布尔字段，非布尔时回退。
 *
 * Args:
 *   value: 原始值。
 *   fallback: 回退值。
 *
 * Returns:
 *   校验后的布尔值。
 */
function pickBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * 取一个在指定区间内的整数字段。
 *
 * Args:
 *   value: 原始值。
 *   fallback: 回退值。
 *   min: 允许的最小值。
 *   max: 允许的最大值。
 *
 * Returns:
 *   校验后的整数。
 */
function pickInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

/**
 * 取一个非空字符串字段。
 *
 * Args:
 *   value: 原始值。
 *   fallback: 回退值。
 *   maxLength: 允许的最大长度。
 *
 * Returns:
 *   校验后的字符串。
 */
function pickString(value: unknown, fallback: string, maxLength = 32): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return fallback;
  return trimmed;
}

/**
 * 取一个合法的颜色名。
 *
 * Args:
 *   value: 原始值。
 *   fallback: 回退值。
 *
 * Returns:
 *   校验后的颜色名。
 */
function pickColor(value: unknown, fallback: ColorName): ColorName {
  return typeof value === 'string' && VALID_COLORS.has(value) ? (value as ColorName) : fallback;
}

/**
 * 把用户配置对象逐字段合并到默认值上。
 *
 * 导出以便测试可以直接喂对象，不必落盘。
 *
 * Args:
 *   raw: 从 JSON 解析出的任意对象（可能是任何形状）。
 *
 * Returns:
 *   合法且完整的 Config。
 */
export function mergeConfig(raw: unknown): Config {
  const d = DEFAULT_CONFIG;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const r = raw as Record<string, unknown>;
  const labels = (r['labels'] ?? {}) as Record<string, unknown>;
  const thresholds = (r['thresholds'] ?? {}) as Record<string, unknown>;
  const colors = (r['colors'] ?? {}) as Record<string, unknown>;

  // barWidth 允许 'auto' 或 0-20 的整数，0 表示彻底关掉进度条。
  // 超界时回退到默认值本身（也就是 'auto'），而不是某个硬编码的格数 ——
  // 否则一个写错的配置会静默把用户从自适应模式踢到固定宽度。
  let barWidth: number | 'auto' = d.barWidth;
  if (r['barWidth'] === 'auto') {
    barWidth = 'auto';
  } else if (typeof r['barWidth'] === 'number' && Number.isFinite(r['barWidth'])) {
    const rounded = Math.round(r['barWidth']);
    barWidth = rounded >= 0 && rounded <= 20 ? rounded : d.barWidth;
  }

  // scopedFilter 里的模型名统一转成大写，与 MeterWindow.label 的形式对齐
  const scopedFilter = Array.isArray(r['scopedFilter'])
    ? r['scopedFilter']
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .slice(0, 12)
        .map((v) => v.trim().toUpperCase())
    : d.scopedFilter;

  return {
    showLine1: pickBool(r['showLine1'], d.showLine1),
    showContext: pickBool(r['showContext'], d.showContext),
    showFiveHour: pickBool(r['showFiveHour'], d.showFiveHour),
    showWeekly: pickBool(r['showWeekly'], d.showWeekly),
    showScoped: pickBool(r['showScoped'], d.showScoped),
    scopedFilter,
    showUnknownWindows: pickBool(r['showUnknownWindows'], d.showUnknownWindows),
    showCost: pickBool(r['showCost'], d.showCost),
    showGitBranch: pickBool(r['showGitBranch'], d.showGitBranch),
    pathLevels: pickInt(r['pathLevels'], d.pathLevels, 1, 6),
    barWidth,
    barFilled: pickString(r['barFilled'], d.barFilled, 2),
    barEmpty: pickString(r['barEmpty'], d.barEmpty, 2),
    labels: {
      context: pickString(labels['context'], d.labels.context, 8),
      fiveHour: pickString(labels['fiveHour'], d.labels.fiveHour, 8),
      weekly: pickString(labels['weekly'], d.labels.weekly, 8),
    },
    thresholds: {
      warning: pickInt(thresholds['warning'], d.thresholds.warning, 0, 100),
      critical: pickInt(thresholds['critical'], d.thresholds.critical, 0, 100),
      contextWarning: pickInt(thresholds['contextWarning'], d.thresholds.contextWarning, 0, 100),
      contextCritical: pickInt(thresholds['contextCritical'], d.thresholds.contextCritical, 0, 100),
    },
    staleWarnMs: pickInt(r['staleWarnMs'], d.staleWarnMs, 0, 86_400_000),
    staleMaxMs: pickInt(r['staleMaxMs'], d.staleMaxMs, 0, 604_800_000),
    showStaleAge: pickBool(r['showStaleAge'], d.showStaleAge),
    showResetCountdown: pickBool(r['showResetCountdown'], d.showResetCountdown),
    colors: {
      context: pickColor(colors['context'], d.colors.context),
      usage: pickColor(colors['usage'], d.colors.usage),
      warning: pickColor(colors['warning'], d.colors.warning),
      critical: pickColor(colors['critical'], d.colors.critical),
      barEmpty: pickColor(colors['barEmpty'], d.colors.barEmpty),
      model: pickColor(colors['model'], d.colors.model),
      project: pickColor(colors['project'], d.colors.project),
      git: pickColor(colors['git'], d.colors.git),
      label: pickColor(colors['label'], d.colors.label),
      cost: pickColor(colors['cost'], d.colors.cost),
    },
    maxWidth: typeof r['maxWidth'] === 'number' ? pickInt(r['maxWidth'], 120, 20, 500) : d.maxWidth,
  };
}

/**
 * 从磁盘加载配置。
 *
 * Args:
 *   path: 配置文件路径，默认取 {CLAUDE_CONFIG_DIR}/claudemeter/config.json。
 *
 * Returns:
 *   完整的 Config；文件不存在或非法时返回全默认值，不抛异常。
 */
export function loadConfig(path: string = getConfigPath()): Config {
  try {
    return mergeConfig(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return DEFAULT_CONFIG;
  }
}
