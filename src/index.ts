/**
 * ClaudeMeter 入口。
 *
 * Claude Code 每次刷新状态栏都会新起一个本进程，跑完即退，所以这里的原则是：
 *   1. 全程不起子进程、不发网络请求，把单次耗时压在几十毫秒内
 *   2. 任何一步失败都降级而不是抛异常 —— 状态栏可以少显示，但不能刷错误
 */
import { readUsageSnapshot } from './claude-config.js';
import { loadConfig } from './config.js';
import { getBranch } from './git.js';
import { getClaudeJsonPath } from './paths.js';
import { render } from './render/index.js';
import { getContextState, readStdin } from './stdin.js';
import { sanitizeText } from './sanitize.js';
import type { MeterContext, StdinData } from './types.js';

/** 拿不到终端宽度时的兜底列数。 */
const FALLBACK_COLUMNS = 120;
/** 输入框左右各留 2 列，不减掉的话满宽输出会折行。 */
const INPUT_PADDING = 4;

/**
 * 解析当前可用的渲染宽度。
 *
 * Claude Code 会捕获本进程的 stdout，所以 process.stdout.columns 拿不到真实宽度；
 * 官方从 v2.1.153 起改为通过 COLUMNS 环境变量传入，这里只认它。
 *
 * Returns:
 *   可用列数。
 */
function resolveColumns(): number {
  const raw = Number.parseInt(process.env['COLUMNS'] ?? '', 10);
  const columns = Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_COLUMNS;
  return Math.max(20, columns - INPUT_PADDING);
}

/** --demo 用的假数据，用来在没有 stdin 的情况下确认渲染正常。 */
const DEMO_STDIN: StdinData = {
  model: { id: 'claude-opus-5[1m]', display_name: 'Opus 5' },
  workspace: { current_dir: process.cwd() },
  cost: { total_cost_usd: 0.42 },
  context_window: { context_window_size: 1_000_000, used_percentage: 31 },
  rate_limits: {
    five_hour: { used_percentage: 23, resets_at: Math.floor(Date.now() / 1000) + 8040 },
    seven_day: { used_percentage: 41, resets_at: Math.floor(Date.now() / 1000) + 259200 },
  },
};

/**
 * 组装渲染所需的上下文。
 *
 * Args:
 *   stdin: statusline 传入的会话数据，可能为 null。
 *   windows: 已合并好的限额窗口。
 *   showBranch: 是否需要读取 git 分支。
 *   isSubscription: 是否为订阅账户，决定花费要不要标成折算值。
 *
 * Returns:
 *   渲染上下文。
 */
function buildContext(
  stdin: StdinData | null,
  windows: MeterContext['windows'],
  showBranch: boolean,
  isSubscription: boolean,
): MeterContext {
  const context = stdin ? getContextState(stdin) : null;
  const cwd = stdin?.workspace?.current_dir ?? stdin?.cwd ?? null;
  const cost = stdin?.cost?.total_cost_usd;

  return {
    modelName: sanitizeText(stdin?.model?.display_name, 32),
    isExtendedContext: (context?.windowSize ?? 0) >= 1_000_000,
    projectPath: cwd,
    branch: showBranch ? getBranch(cwd) : null,
    costUsd: typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
    costIsEstimate: isSubscription,
    context,
    windows,
    columns: resolveColumns(),
  };
}

/**
 * 主流程。
 *
 * Returns:
 *   无返回值；结果直接写到 stdout。
 */
async function main(): Promise<void> {
  // 提供一个不改配置就能临时关掉状态栏的开关
  if (process.env['CLAUDEMETER_DISABLE']) return;

  const isDemo = process.argv.includes('--demo');
  const config = loadConfig();
  const now = Date.now();

  const stdin = isDemo ? DEMO_STDIN : await readStdin();
  const snapshot = readUsageSnapshot(getClaudeJsonPath(), now);
  // mergeWindows 依赖 config 与 stdin，放在这里而不是 buildContext 里，
  // 是为了让"数据合并"和"展示组装"两件事保持分离，便于分别测试
  const { mergeWindows } = await import('./usage.js');
  const windows = mergeWindows(stdin, snapshot, config, now);

  const ctx = buildContext(stdin, windows, config.showGitBranch, snapshot?.isSubscription ?? false);
  const output = render(ctx, config, now);
  if (output) process.stdout.write(output + '\n');
}

main().catch((error: unknown) => {
  // 状态栏出错时给一行简短提示即可，绝不能把堆栈刷到用户界面上
  if (process.env['CLAUDEMETER_DEBUG']) {
    process.stderr.write('[claudemeter] ' + String(error) + '\n');
  }
  process.exitCode = 0;
});
