/**
 * 版本号提升脚本。
 *
 * 版本号分散在三个文件里，其中 plugin/.claude-plugin/plugin.json 的 version 是决定性的：
 * Claude Code 只有在这个字段变化时才会把新版本推给已安装的用户。
 * 改了代码却忘了改它，用户那边就永远停在旧版本，而且不会有任何报错 ——
 * 所以这三个文件必须一起改，用脚本而不是靠记性。
 *
 * 用法：npm run bump -- 0.2.1
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** 三个需要同步版本号的文件，以及各自的写入方式。 */
const TARGETS = [
  { path: 'package.json', set: (j, v) => { j.version = v; } },
  { path: 'plugin/.claude-plugin/plugin.json', set: (j, v) => { j.version = v; } },
  { path: '.claude-plugin/marketplace.json', set: (j, v) => { j.metadata.version = v; } },
];

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: npm run bump -- <major.minor.patch>');
  console.error('   eg: npm run bump -- 0.2.1');
  process.exit(1);
}

for (const target of TARGETS) {
  const full = join(root, target.path);
  const json = JSON.parse(readFileSync(full, 'utf8'));
  target.set(json, version);
  writeFileSync(full, JSON.stringify(json, null, 2) + '\n');
  console.log(`${target.path} -> ${version}`);
}

console.log('\nnext: npm run build && npm test, then commit and push.');
console.log('users receive the update after: claude plugin marketplace update claudemeter');
