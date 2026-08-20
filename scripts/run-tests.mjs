/**
 * 跨 Node 版本、跨平台的测试运行器。
 *
 * 不能直接写 `node --test "tests/*.test.js"`：glob 模式要 Node 21+ 才支持，Node 18 会直接报
 * "Could not find"；写成不带引号的 glob 又依赖 shell 展开，在 Windows 的 cmd.exe 下失效。
 * 这里自己列出文件再显式传给 test runner，行为在所有目标环境下一致。
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testsDir = join(root, 'tests');

const files = readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => join(testsDir, name));

if (files.length === 0) {
  console.error('no test files found in ' + testsDir);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: root,
});
process.exit(result.status ?? 1);
