/**
 * 端到端测试：真的起一个 dist/index.js 进程，用管道喂 stdin，检查输出。
 *
 * 这一层覆盖的是单元测试碰不到的东西：打包产物是否自洽、CLAUDE_CONFIG_DIR 是否被尊重、
 * 各种退化输入下会不会崩、以及单次渲染的耗时预算。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENTRY = join(ROOT, 'dist', 'index.js');
const FIXTURES = join(ROOT, 'tests', 'fixtures');

/**
 * 起一个隔离的配置目录，把用量缓存 fixture 放进去。
 *
 * getClaudeJsonPath() 的规则是"配置目录同级的 .json 文件"，所以配置目录叫 X/.claude 时，
 * 缓存文件就是 X/.claude.json。
 */
function makeConfigDir({ usageFixture = 'claude-json-full.json', meterConfig = null } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'claudemeter-it-'));
  const configDir = join(base, '.claude');
  mkdirSync(join(configDir, 'claudemeter'), { recursive: true });
  if (usageFixture) {
    const raw = JSON.parse(readFileSync(join(FIXTURES, usageFixture), 'utf8'));
    // 把抓取时刻改成"刚刚"，否则 fixture 里的固定时间戳会被当成陈旧数据
    raw.cachedUsageUtilization.fetchedAtMs = Date.now() - 30_000;
    const limits = raw.cachedUsageUtilization.utilization.limits ?? [];
    for (const l of limits) {
      if (l.resets_at) l.resets_at = new Date(Date.now() + 86_400_000).toISOString();
    }
    writeFileSync(configDir + '.json', JSON.stringify(raw));
  }
  if (meterConfig) {
    writeFileSync(join(configDir, 'claudemeter', 'config.json'),
      typeof meterConfig === 'string' ? meterConfig : JSON.stringify(meterConfig));
  }
  return { base, configDir };
}

/** 用给定 stdin 与环境跑一次状态栏，返回去色后的输出。 */
function run(stdin, { configDir, columns = 124, env = {} } = {}) {
  const result = spawnSync(process.execPath, [ENTRY], {
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    encoding: 'utf8',
    env: {
      ...process.env,
      COLUMNS: String(columns),
      NO_COLOR: '1',
      ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}),
      ...env,
    },
  });
  return { ...result, lines: result.stdout.trim().split('\n').filter(Boolean) };
}

const BASE_STDIN = {
  model: { id: 'claude-opus-5[1m]', display_name: 'Opus 5' },
  workspace: { current_dir: '/tmp' },
  cost: { total_cost_usd: 0.42 },
  context_window: { context_window_size: 1_000_000, used_percentage: 31 },
};

test('完整输入下渲染两行，且四段都在', () => {
  const { base, configDir } = makeConfigDir();
  try {
    const { status, lines } = run({
      ...BASE_STDIN,
      rate_limits: {
        five_hour: { used_percentage: 23.5, resets_at: Math.floor(Date.now() / 1000) + 8040 },
        seven_day: { used_percentage: 41.2, resets_at: Math.floor(Date.now() / 1000) + 259200 },
      },
    }, { configDir });
    assert.equal(status, 0);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /Opus 5 1M/);
    assert.match(lines[1], /CTX .*31%/);
    assert.match(lines[1], /5H .*24%/);
    assert.match(lines[1], /WEEK .*41%/, '周用量必须显示，不设任何百分比门槛');
    assert.match(lines[1], /FABLE .*94%/, 'Fable 必须显示 —— 这是本插件的立项理由');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('stdin 没有 rate_limits 时（会话首次响应前）仍从本地缓存渲染出全部窗口', () => {
  const { base, configDir } = makeConfigDir();
  try {
    const { lines } = run(BASE_STDIN, { configDir });
    assert.match(lines[1], /5H/);
    assert.match(lines[1], /WEEK/);
    assert.match(lines[1], /FABLE .*94%/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('各种退化输入都不崩，且退出码为 0', () => {
  const { base, configDir } = makeConfigDir({ usageFixture: null });
  try {
    for (const input of ['{}', 'not json at all', '', '[]', '{"context_window":null}']) {
      const { status, stderr } = run(input, { configDir });
      assert.equal(status, 0, '输入 ' + JSON.stringify(input) + ' 不应导致非零退出');
      assert.equal(stderr, '', '不应向 stderr 输出任何东西');
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('配置文件语法错误时回退默认值而不是崩溃', () => {
  const { base, configDir } = makeConfigDir({ meterConfig: '{ this is not json' });
  try {
    const { status, lines } = run(BASE_STDIN, { configDir });
    assert.equal(status, 0);
    assert.match(lines[1], /FABLE/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('配置能关掉指定的段', () => {
  const { base, configDir } = makeConfigDir({
    meterConfig: { showScoped: false, showLine1: false },
  });
  try {
    const { lines } = run(BASE_STDIN, { configDir });
    assert.equal(lines.length, 1, '关掉第一行后只剩用量行');
    assert.ok(!lines[0].includes('FABLE'));
    assert.match(lines[0], /WEEK/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('CLAUDEMETER_DISABLE 让插件完全静默', () => {
  const { base, configDir } = makeConfigDir();
  try {
    const { status, stdout } = run(BASE_STDIN, { configDir, env: { CLAUDEMETER_DISABLE: '1' } });
    assert.equal(status, 0);
    assert.equal(stdout, '');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('任何宽度下都不超出终端列数', () => {
  const { base, configDir } = makeConfigDir();
  try {
    for (const columns of [200, 120, 100, 80, 60, 45, 30]) {
      const { lines } = run(BASE_STDIN, { configDir, columns });
      for (const line of lines) {
        assert.ok(line.length <= columns,
          'COLUMNS=' + columns + ' 时输出了 ' + line.length + ' 列：' + line);
      }
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('单次渲染耗时在状态栏预算内', () => {
  const { base, configDir } = makeConfigDir();
  try {
    const started = Date.now();
    const runs = 5;
    for (let i = 0; i < runs; i++) run(BASE_STDIN, { configDir });
    const perRun = (Date.now() - started) / runs;
    assert.ok(perRun < 250, '单次渲染 ' + perRun.toFixed(0) + 'ms，超出预算');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('打包产物自洽：不依赖 node_modules', () => {
  const bundle = readFileSync(ENTRY, 'utf8');
  assert.ok(!bundle.includes('node_modules'), '产物不应引用 node_modules');
  const externalImports = [...bundle.matchAll(/from\s+"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((s) => !s.startsWith('node:'));
  assert.deepEqual(externalImports, [], '除 node: 内置模块外不应有任何外部依赖');
});

test('订阅账户的花费带 ≈ 前缀，避免被误读成账单', () => {
  const { base, configDir } = makeConfigDir();
  try {
    const { lines } = run({ ...BASE_STDIN, cost: { total_cost_usd: 25.53 } }, { configDir });
    assert.match(lines[0], /≈\$25\.53/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('非订阅账户（无 oauthAccount）的花费不加前缀', () => {
  const { base, configDir } = makeConfigDir({ usageFixture: 'claude-json-no-limits.json' });
  try {
    const { lines } = run({ ...BASE_STDIN, cost: { total_cost_usd: 25.53 } }, { configDir });
    assert.match(lines[0], /\$25\.53/);
    assert.ok(!lines[0].includes('≈'));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
