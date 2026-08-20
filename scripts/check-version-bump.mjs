/**
 * 校验：凡是改动了会分发给用户的内容，就必须同时提升插件版本号。
 *
 * 这是本仓库最容易犯、且完全没有反馈的错误。Claude Code 用
 * plugin/.claude-plugin/plugin.json 的 version 作为更新判定的缓存键：
 * 版本号没变，无论推了多少 commit，已安装的用户都收不到更新，
 * /plugin update 还会回报 "already at the latest version"。
 * 构建是绿的、推送是成功的、没有任何报错 —— 所以只能靠 CI 机械拦截。
 *
 * 判定范围是整个 plugin/ 目录：commands/ 与 bin/ 同样会分发给用户，
 * 改了它们而不升版本，用户一样收不到。
 *
 * 用法：node scripts/check-version-bump.mjs <baseRef> <headRef>
 * 提交信息里含 [skip version check] 时跳过（例如只改了 CI 配置的合并提交）。
 */
import { execFileSync } from 'node:child_process';

/** 需要版本号保护的路径前缀 —— 即安装时会被复制走的那部分。 */
const SHIPPED_PATH = 'plugin/';
/** 版本号的唯一权威来源。 */
const MANIFEST = 'plugin/.claude-plugin/plugin.json';

/**
 * 执行一条 git 命令并返回 stdout。
 *
 * Args:
 *   args: git 的参数列表。
 *
 * Returns:
 *   命令输出（已去除首尾空白）；命令失败时返回 null。
 */
function git(args) {
  try {
    // stdio 里屏蔽 stderr：文件在某个 ref 下不存在是正常分支，不该把 git 的报错刷出来
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * 读取某个 ref 下清单文件里的版本号。
 *
 * Args:
 *   ref: git ref。
 *
 * Returns:
 *   版本号字符串；文件不存在或无法解析时返回 null。
 */
function versionAt(ref) {
  const raw = git(['show', `${ref}:${MANIFEST}`]);
  if (!raw) return null;
  try {
    return JSON.parse(raw).version ?? null;
  } catch {
    return null;
  }
}

const [base, head = 'HEAD'] = process.argv.slice(2);
if (!base) {
  console.error('usage: node scripts/check-version-bump.mjs <baseRef> [headRef]');
  process.exit(2);
}

// 新分支或首次推送时 base 是全零，没有可比较的基线，直接放行
if (/^0{40}$/.test(base) || git(['rev-parse', '--verify', `${base}^{commit}`]) === null) {
  console.log('no comparable base ref; skipping version-bump check');
  process.exit(0);
}

const changed = git(['diff', '--name-only', `${base}..${head}`]) ?? '';
const shippedChanges = changed.split('\n').filter((f) => f.startsWith(SHIPPED_PATH));

if (shippedChanges.length === 0) {
  console.log('no changes under ' + SHIPPED_PATH + '; version bump not required');
  process.exit(0);
}

const messages = git(['log', '--format=%B', `${base}..${head}`]) ?? '';
if (messages.includes('[skip version check]')) {
  console.log('[skip version check] present in a commit message; skipping');
  process.exit(0);
}

const before = versionAt(base);
const after = versionAt(head);

if (before !== null && after !== null && before === after) {
  console.error('');
  console.error(`These files ship to users but the version stayed at ${after}:`);
  for (const file of shippedChanges) console.error('  ' + file);
  console.error('');
  console.error('Claude Code keys updates off the version in ' + MANIFEST + '.');
  console.error('Leaving it unchanged means installed users never receive this change,');
  console.error('and /plugin update reports "already at the latest version".');
  console.error('');
  console.error('Fix:  npm run bump -- <new version> && npm run build');
  console.error('Skip: put [skip version check] in a commit message.');
  process.exit(1);
}

console.log(`version ${before ?? '(none)'} -> ${after ?? '(none)'}; ok`);
