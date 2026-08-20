/**
 * ClaudeMeter 状态栏启动器。
 *
 * settings.json 里的 statusLine 命令指向这个文件的固定路径，由它在运行时找到
 * 当前已安装的最新版本插件并加载。这样插件升级后无需重跑 setup。
 *
 * 为什么不像其它插件那样把版本探测写成一长串 bash：
 *   - bash 版本在 Windows / Git Bash 上有嵌套引号的坑，配置里存的是 JSON 字符串，
 *     经过一轮转义后很容易静默语法错误，表现为状态栏直接消失、且没有任何报错
 *   - grep 的 \t 在 BSD/GNU grep 里不展开成制表符，会匹配字面量 t，同样静默失败
 *   - 用 JS 做同一件事只多几毫秒，却在三个平台上行为一致
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 版本目录名必须形如 1.2.3 或 1.2.3.4。 */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(\.\d+)?$/;

/**
 * 比较两个点分版本号。
 *
 * Args:
 *   a: 版本号字符串。
 *   b: 版本号字符串。
 *
 * Returns:
 *   a 大于 b 时返回正数，小于返回负数，相等返回 0。
 */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 在插件缓存目录里找出版本号最高的 ClaudeMeter 安装。
 *
 * 目录结构是 {配置目录}/plugins/cache/{marketplace}/claudemeter/{version}/dist/index.js，
 * 其中 marketplace 名字由用户添加时决定，所以这一层要遍历而不能写死。
 *
 * Returns:
 *   dist/index.js 的绝对路径；没有找到任何安装时返回 null。
 */
function findLatestEntry() {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  const cacheRoot = join(configDir, 'plugins', 'cache');

  let best = null;
  let bestVersion = null;
  let marketplaces;
  try {
    marketplaces = readdirSync(cacheRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const marketplace of marketplaces) {
    if (!marketplace.isDirectory()) continue;
    const pluginDir = join(cacheRoot, marketplace.name, 'claudemeter');
    let versions;
    try {
      versions = readdirSync(pluginDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const version of versions) {
      if (!version.isDirectory() || !VERSION_PATTERN.test(version.name)) continue;
      const entry = join(pluginDir, version.name, 'dist', 'index.js');
      if (!existsSync(entry)) continue;
      if (bestVersion === null || compareVersions(version.name, bestVersion) > 0) {
        bestVersion = version.name;
        best = entry;
      }
    }
  }
  return best;
}

// CLAUDEMETER_DIST 用于本地开发：直接指向仓库里的 dist/index.js，免去反复安装
const entry = process.env.CLAUDEMETER_DIST?.trim() || findLatestEntry();
if (entry && existsSync(entry)) {
  await import(pathToFileURL(entry).href);
}
// 找不到安装时静默退出：状态栏消失总好过在用户界面上刷一条错误
