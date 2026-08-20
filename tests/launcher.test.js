/**
 * 启动器的版本发现测试。
 *
 * 启动器是 settings.json 里唯一被硬编码的路径，它一旦找不到插件，状态栏就整个消失
 * 且没有任何报错——所以版本挑选逻辑必须测到。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LAUNCHER = join(ROOT, 'plugin', 'bin', 'launcher.mjs');

/** 在临时配置目录里伪造若干个已安装版本，每个版本打印自己的版本号。 */
function fakeInstalls(configDir, marketplace, versions) {
  for (const version of versions) {
    const dist = join(configDir, 'plugins', 'cache', marketplace, 'claudemeter', version, 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'index.js'), 'process.stdout.write(' + JSON.stringify(version) + ');\n');
  }
}

/** 跑一次启动器，返回 stdout。 */
function runLauncher(configDir, env = {}) {
  return spawnSync(process.execPath, [LAUNCHER], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, ...env },
  });
}

test('挑选版本号最高的安装，而不是字典序最大的', () => {
  const base = mkdtempSync(join(tmpdir(), 'claudemeter-launcher-'));
  try {
    // 字典序下 "0.9.0" > "0.10.0"，必须按数值比较才能选对
    fakeInstalls(base, 'claudemeter', ['0.1.0', '0.9.0', '0.10.0']);
    assert.equal(runLauncher(base).stdout, '0.10.0');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('跨 marketplace 目录也能找到（marketplace 名字由用户添加时决定）', () => {
  const base = mkdtempSync(join(tmpdir(), 'claudemeter-launcher-'));
  try {
    fakeInstalls(base, 'some-other-marketplace', ['1.2.3']);
    assert.equal(runLauncher(base).stdout, '1.2.3');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('忽略不是版本号的目录名', () => {
  const base = mkdtempSync(join(tmpdir(), 'claudemeter-launcher-'));
  try {
    fakeInstalls(base, 'claudemeter', ['1.0.0', 'nightly', 'tmp']);
    assert.equal(runLauncher(base).stdout, '1.0.0');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('没有任何安装时静默退出，不报错、不输出', () => {
  const base = mkdtempSync(join(tmpdir(), 'claudemeter-launcher-'));
  try {
    const result = runLauncher(base);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('CLAUDEMETER_DIST 覆盖版本发现，供本地开发使用', () => {
  const base = mkdtempSync(join(tmpdir(), 'claudemeter-launcher-'));
  try {
    fakeInstalls(base, 'claudemeter', ['1.0.0']);
    const devEntry = join(base, 'dev-dist.js');
    writeFileSync(devEntry, 'process.stdout.write("dev");\n');
    assert.equal(runLauncher(base, { CLAUDEMETER_DIST: devEntry }).stdout, 'dev');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
