/**
 * 版本号提升校验脚本的测试。
 *
 * 这条校验拦的是本仓库唯一一个"完全没有反馈"的错误：改了会分发的内容却没升版本号，
 * 结果构建全绿、推送成功，而用户永远收不到更新。所以它自己必须被测到。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'scripts', 'check-version-bump.mjs');

/** 在临时目录里建一个最小仓库，含一个版本为 0.1.0 的插件清单。 */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'claudemeter-ver-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('config', 'commit.gpgsign', 'false');

  mkdirSync(join(dir, 'plugin', '.claude-plugin'), { recursive: true });
  mkdirSync(join(dir, 'plugin', 'dist'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeManifest(dir, '0.1.0');
  writeFileSync(join(dir, 'plugin', 'dist', 'index.js'), 'v1\n');
  writeFileSync(join(dir, 'src', 'index.ts'), 'v1\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  return { dir, git };
}

/** 写入插件清单。 */
function writeManifest(dir, version) {
  writeFileSync(
    join(dir, 'plugin', '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'claudemeter', version }, null, 2) + '\n',
  );
}

/** 在给定仓库里跑一次校验脚本。 */
function check(dir) {
  return spawnSync(process.execPath, [SCRIPT, 'HEAD~1', 'HEAD'], {
    cwd: dir, encoding: 'utf8',
  });
}

test('改了 plugin/ 但没升版本 -> 失败，并说明后果', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'plugin', 'dist', 'index.js'), 'v2\n');
    git('commit', '-aqm', 'change shipped code without bumping');
    const r = check(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /version stayed at 0\.1\.0/);
    assert.match(r.stderr, /plugin\/dist\/index\.js/);
    assert.match(r.stderr, /npm run bump/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('改了 plugin/ 且升了版本 -> 通过', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'plugin', 'dist', 'index.js'), 'v2\n');
    writeManifest(dir, '0.2.0');
    git('commit', '-aqm', 'bump');
    const r = check(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /0\.1\.0 -> 0\.2\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('只改了不分发的文件（src/ 等）-> 不要求升版本', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'src', 'index.ts'), 'v2\n');
    git('commit', '-aqm', 'refactor only');
    const r = check(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /version bump not required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('commands/ 与 bin/ 同样受保护（它们也会分发给用户）', () => {
  for (const rel of [['plugin', 'commands', 'setup.md'], ['plugin', 'bin', 'launcher.mjs']]) {
    const { dir, git } = makeRepo();
    try {
      mkdirSync(join(dir, ...rel.slice(0, -1)), { recursive: true });
      writeFileSync(join(dir, ...rel), 'changed\n');
      git('add', '-A');
      git('commit', '-qm', 'touch ' + rel.join('/'));
      assert.equal(check(dir).status, 1, rel.join('/') + ' 应当要求升版本');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('[skip version check] 可以显式放行', () => {
  const { dir, git } = makeRepo();
  try {
    writeFileSync(join(dir, 'plugin', 'dist', 'index.js'), 'v2\n');
    git('commit', '-aqm', 'rebuild only [skip version check]');
    const r = check(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /skipping/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
