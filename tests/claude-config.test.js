/**
 * ~/.claude.json 用量缓存读取的测试。
 *
 * 两个关注点：一是把 limits[] 正确映射成渲染窗口（尤其是 Fable 那条），
 * 二是隐私边界 —— 这个文件里有邮箱、账号 UUID、机器 ID 和全部项目历史，一个都不能带出来。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readUsageSnapshot } from '../build/claude-config.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const NOW = 1787252586361 + 600_000; // 缓存抓取后 10 分钟

test('从 limits[] 解析出三个窗口，含按模型的 Fable', () => {
  const snap = readUsageSnapshot(join(FIXTURES, 'claude-json-full.json'), NOW);
  assert.ok(snap);
  assert.deepEqual(snap.windows.map((w) => w.key), ['session', 'weekly', 'scoped:FABLE']);

  const fable = snap.windows[2];
  assert.equal(fable.label, 'FABLE');
  assert.equal(fable.percent, 94);
  assert.equal(fable.severity, 'critical');
  assert.equal(fable.source, 'cache');
  assert.equal(fable.ageMs, 600_000);
  assert.equal(fable.resetAt.toISOString(), '2026-08-22T05:00:00.337Z');
});

test('顶层那些内部代号键（nimbus_quill / tangelo）绝不能被当成窗口', () => {
  const snap = readUsageSnapshot(join(FIXTURES, 'claude-json-full.json'), NOW);
  const labels = snap.windows.map((w) => w.label);
  assert.ok(!labels.some((l) => /NIMBUS|TANGELO|IGUANA|AMBER/.test(l)));
});

test('limits[] 缺失时回退到 five_hour / seven_day，且仍不遍历代号键', () => {
  const snap = readUsageSnapshot(join(FIXTURES, 'claude-json-no-limits.json'), NOW);
  assert.deepEqual(snap.windows.map((w) => w.key), ['session', 'weekly']);
  assert.deepEqual(snap.windows.map((w) => w.percent), [12, 33]);
});

test('隐私边界：返回结果里不含邮箱、账号 UUID、机器 ID 或项目历史', () => {
  const snap = readUsageSnapshot(join(FIXTURES, 'claude-json-full.json'), NOW);
  const serialized = JSON.stringify(snap);
  assert.ok(!serialized.includes('@'), '不得包含邮箱');
  assert.ok(!serialized.includes('00000000-0000'), '不得包含账号 UUID');
  assert.ok(!serialized.toLowerCase().includes('machine'), '不得包含机器 ID');
  assert.ok(!serialized.includes('lastCost'), '不得包含项目历史');
  // 套餐档位是白名单内的、可显示的非身份信息
  assert.equal(snap.planTier, 'default_claude_max_5x');
});

test('文件不存在时安静返回 null', () => {
  assert.equal(readUsageSnapshot(join(FIXTURES, 'does-not-exist.json'), NOW), null);
});

test('订阅账户被识别出来（organizationType 以 claude_ 开头）', () => {
  const snap = readUsageSnapshot(join(FIXTURES, 'claude-json-full.json'), NOW);
  assert.equal(snap.isSubscription, true);
});

test('没有 oauthAccount 时不当作订阅账户', () => {
  const snap = readUsageSnapshot(join(FIXTURES, 'claude-json-no-limits.json'), NOW);
  assert.equal(snap.isSubscription, false);
});
