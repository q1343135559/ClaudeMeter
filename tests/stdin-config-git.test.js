/**
 * stdin 上下文解析、配置合并、分支读取的测试。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getContextState, normalizePercent } from '../build/stdin.js';
import { mergeConfig, DEFAULT_CONFIG } from '../build/config.js';
import { getBranch } from '../build/git.js';

// ---------------------------------------------------------------- 上下文解析

test('优先采用 Claude Code 预先算好的 used_percentage', () => {
  const state = getContextState({
    context_window: { used_percentage: 31, context_window_size: 1_000_000 },
  });
  assert.deepEqual(state, { percent: 31, windowSize: 1_000_000 });
});

test('used_percentage 为 0 但已有 token 明细时改为自算（会话刚开始的场景）', () => {
  const state = getContextState({
    context_window: {
      used_percentage: 0,
      context_window_size: 200_000,
      current_usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 978,
        cache_read_input_tokens: 19_020,
        output_tokens: 5_000,
      },
    },
  });
  // 官方公式只算 input 三项，不含 output：(2+978+19020)/200000 = 10%
  assert.equal(state.percent, 10);
});

test('/compact 之后 current_usage 为 null 且百分比为 0 时显示 0%', () => {
  const state = getContextState({
    context_window: { used_percentage: 0, context_window_size: 200_000, current_usage: null },
  });
  assert.deepEqual(state, { percent: 0, windowSize: 200_000 });
});

test('完全没有 context_window 时返回 null', () => {
  assert.equal(getContextState({}), null);
});

test('百分比归一化：夹到 0-100 并取整，非数值返回 null', () => {
  assert.equal(normalizePercent(23.5), 24);
  assert.equal(normalizePercent(-5), 0);
  assert.equal(normalizePercent(150), 100);
  assert.equal(normalizePercent('23'), null);
  assert.equal(normalizePercent(Number.NaN), null);
  assert.equal(normalizePercent(undefined), null);
});

// ---------------------------------------------------------------- 配置合并

test('空对象或非法输入回退到全默认', () => {
  assert.deepEqual(mergeConfig({}), DEFAULT_CONFIG);
  assert.deepEqual(mergeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(mergeConfig('nope'), DEFAULT_CONFIG);
  assert.deepEqual(mergeConfig([1, 2]), DEFAULT_CONFIG);
});

test('单个非法字段不影响其它字段（逐字段回退）', () => {
  const config = mergeConfig({ showWeekly: 'yes', pathLevels: 3, barWidth: 999 });
  assert.equal(config.showWeekly, DEFAULT_CONFIG.showWeekly, '非法布尔回退');
  assert.equal(config.pathLevels, 3, '合法值生效');
  assert.equal(config.barWidth, DEFAULT_CONFIG.barWidth, '超界数值回退');
});

test('周用量默认开启且没有任何百分比门槛', () => {
  assert.equal(DEFAULT_CONFIG.showWeekly, true);
  assert.ok(!('sevenDayThreshold' in DEFAULT_CONFIG), '不应存在周用量显示阈值这种配置');
});

test('scopedFilter 统一转成大写以便与窗口标签比对', () => {
  assert.deepEqual(mergeConfig({ scopedFilter: ['fable', ' Opus '] }).scopedFilter,
    ['FABLE', 'OPUS']);
});

test('barWidth 支持 auto 与 0', () => {
  assert.equal(mergeConfig({ barWidth: 'auto' }).barWidth, 'auto');
  assert.equal(mergeConfig({ barWidth: 0 }).barWidth, 0);
  assert.equal(mergeConfig({ barWidth: 6 }).barWidth, 6);
});

// ---------------------------------------------------------------- 分支读取

test('分支读取覆盖普通仓库、detached HEAD、worktree 三种形态', () => {
  const root = mkdtempSync(join(tmpdir(), 'claudemeter-git-'));
  try {
    // 1. 普通仓库
    const plain = join(root, 'plain');
    mkdirSync(join(plain, '.git'), { recursive: true });
    writeFileSync(join(plain, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');
    assert.equal(getBranch(plain), 'feature/x');

    // 子目录里也应能向上找到仓库
    const nested = join(plain, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    assert.equal(getBranch(nested), 'feature/x');

    // 2. detached HEAD：显示短 sha
    const detached = join(root, 'detached');
    mkdirSync(join(detached, '.git'), { recursive: true });
    writeFileSync(join(detached, '.git', 'HEAD'), '1234567890abcdef1234567890abcdef12345678\n');
    assert.equal(getBranch(detached), '1234567');

    // 3. worktree：.git 是文件，内容指向真正的 git 目录
    const realGit = join(root, 'realgit');
    mkdirSync(realGit, { recursive: true });
    writeFileSync(join(realGit, 'HEAD'), 'ref: refs/heads/wt-branch\n');
    const worktree = join(root, 'worktree');
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, '.git'), 'gitdir: ' + realGit + '\n');
    assert.equal(getBranch(worktree), 'wt-branch');

    // 4. 不在仓库里
    const bare = mkdtempSync(join(tmpdir(), 'claudemeter-nogit-'));
    assert.equal(getBranch(bare), null);
    rmSync(bare, { recursive: true, force: true });

    assert.equal(getBranch(null), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
