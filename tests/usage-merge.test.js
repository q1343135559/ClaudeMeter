/**
 * 额度合并逻辑的测试。
 *
 * 这里的每一条用例都对应一个真实存在过的失败模式：
 * claude-hud 的周用量阈值、缓存跨过重置点、stdin 与缓存的字段错配等。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeWindows } from '../build/usage.js';
import { DEFAULT_CONFIG } from '../build/config.js';

const NOW = Date.UTC(2026, 7, 20, 19, 0, 0);
const HOUR = 3_600_000;

/** 构造一份带指定窗口的缓存快照。 */
function snapshot(windows, ageMs = 60_000) {
  return {
    fetchedAtMs: NOW - ageMs,
    planTier: 'default_claude_max_5x',
    windows: windows.map((w) => ({ severity: null, source: 'cache', ageMs, ...w })),
  };
}

test('周用量在任何百分比下都渲染（claude-hud 默认 80% 阈值的回归用例）', () => {
  const windows = mergeWindows(
    { rate_limits: { seven_day: { used_percentage: 41.2, resets_at: (NOW + 3 * 24 * HOUR) / 1000 } } },
    null, DEFAULT_CONFIG, NOW,
  );
  const weekly = windows.find((w) => w.key === 'weekly');
  assert.ok(weekly, '周窗口必须存在');
  assert.equal(weekly.percent, 41);
});

test('周用量为 0% 时同样渲染', () => {
  const windows = mergeWindows(
    { rate_limits: { seven_day: { used_percentage: 0, resets_at: (NOW + HOUR) / 1000 } } },
    null, DEFAULT_CONFIG, NOW,
  );
  assert.equal(windows.find((w) => w.key === 'weekly')?.percent, 0);
});

test('并集语义：只存在于缓存里的按模型窗口照样渲染', () => {
  const windows = mergeWindows(
    { rate_limits: { five_hour: { used_percentage: 10, resets_at: (NOW + HOUR) / 1000 } } },
    snapshot([{ key: 'scoped:FABLE', label: 'FABLE', percent: 94, resetAt: new Date(NOW + 2 * HOUR), severity: 'critical' }]),
    DEFAULT_CONFIG, NOW,
  );
  const fable = windows.find((w) => w.key === 'scoped:FABLE');
  assert.ok(fable, 'Fable 窗口必须存在 —— 这正是本插件相对 claude-hud 的核心差异');
  assert.equal(fable.percent, 94);
  assert.equal(fable.severity, 'critical');
});

test('stdin 覆盖缓存时 percent 与 resetAt 成对替换，不会串源', () => {
  const stdinReset = NOW + 4 * HOUR;
  const cacheReset = NOW + 2 * HOUR;
  const windows = mergeWindows(
    { rate_limits: { five_hour: { used_percentage: 77, resets_at: stdinReset / 1000 } } },
    snapshot([{ key: 'session', label: '5H', percent: 4, resetAt: new Date(cacheReset) }]),
    DEFAULT_CONFIG, NOW,
  );
  const session = windows.find((w) => w.key === 'session');
  assert.equal(session.percent, 77, '百分比应来自 stdin');
  assert.equal(session.resetAt.getTime(), stdinReset, '重置时刻必须跟着百分比一起来自 stdin');
  assert.equal(session.source, 'stdin');
  assert.equal(session.ageMs, null);
});

test('缓存里已经跨过重置点的窗口必须丢弃，而不是显示一个过期百分比', () => {
  const windows = mergeWindows(
    null,
    snapshot([{ key: 'session', label: '5H', percent: 88, resetAt: new Date(NOW - 60_000) }]),
    DEFAULT_CONFIG, NOW,
  );
  assert.equal(windows.find((w) => w.key === 'session'), undefined);
});

test('缓存年龄超过 staleMaxMs 时丢弃', () => {
  const config = { ...DEFAULT_CONFIG, staleMaxMs: HOUR };
  const windows = mergeWindows(
    null,
    snapshot([{ key: 'weekly', label: 'WEEK', percent: 50, resetAt: new Date(NOW + 24 * HOUR) }], 2 * HOUR),
    config, NOW,
  );
  assert.equal(windows.length, 0);
});

test('stdin 完全没有 rate_limits 时（会话首次响应前）仍能从缓存渲染全部窗口', () => {
  const windows = mergeWindows(
    { model: { display_name: 'Opus 5' } },
    snapshot([
      { key: 'session', label: '5H', percent: 4, resetAt: new Date(NOW + HOUR) },
      { key: 'weekly', label: 'WEEK', percent: 57, resetAt: new Date(NOW + 24 * HOUR) },
      { key: 'scoped:FABLE', label: 'FABLE', percent: 95, resetAt: new Date(NOW + 24 * HOUR) },
    ]),
    DEFAULT_CONFIG, NOW,
  );
  assert.deepEqual(windows.map((w) => w.key), ['session', 'weekly', 'scoped:FABLE']);
});

test('scopedFilter 只保留列出的模型', () => {
  const config = { ...DEFAULT_CONFIG, scopedFilter: ['FABLE'] };
  const windows = mergeWindows(null, snapshot([
    { key: 'scoped:FABLE', label: 'FABLE', percent: 95, resetAt: new Date(NOW + HOUR) },
    { key: 'scoped:OPUS', label: 'OPUS', percent: 20, resetAt: new Date(NOW + HOUR) },
  ]), config, NOW);
  assert.deepEqual(windows.map((w) => w.label), ['FABLE']);
});

test('未知 kind 的窗口默认隐藏，开启开关后显示', () => {
  const snap = snapshot([{ key: 'other:mystery', label: 'MYSTERY', percent: 30, resetAt: null }]);
  assert.equal(mergeWindows(null, snap, DEFAULT_CONFIG, NOW).length, 0);
  const shown = mergeWindows(null, snap, { ...DEFAULT_CONFIG, showUnknownWindows: true }, NOW);
  assert.equal(shown.length, 1);
});

test('输出顺序固定为 5H → WEEK → 按模型', () => {
  const windows = mergeWindows(null, snapshot([
    { key: 'scoped:FABLE', label: 'FABLE', percent: 95, resetAt: new Date(NOW + HOUR) },
    { key: 'weekly', label: 'WEEK', percent: 57, resetAt: new Date(NOW + HOUR) },
    { key: 'session', label: '5H', percent: 4, resetAt: new Date(NOW + HOUR) },
  ]), DEFAULT_CONFIG, NOW);
  assert.deepEqual(windows.map((w) => w.key), ['session', 'weekly', 'scoped:FABLE']);
});

test('默认兜底阈值为 24 小时，且不与"重置时刻已过"那条规则重复', () => {
  assert.equal(DEFAULT_CONFIG.staleMaxMs, 86_400_000);
});

test('缓存已旧但重置时刻仍在未来的长窗口必须保留，只标年龄（回归用例）', () => {
  // 真实场景：离开一晚回来，本地缓存是活动驱动刷新的，已经十几个小时没动，
  // 但 Fable 的周窗口还有 22 小时才重置。此时读数偏旧，却不是错的 ——
  // 抹掉整段比带着 ·14h 显示出来更糟。
  const ageMs = 14 * HOUR;
  const windows = mergeWindows(null, snapshot([
    { key: 'scoped:FABLE', label: 'FABLE', percent: 95, resetAt: new Date(NOW + 22 * HOUR),
      severity: 'critical' },
  ], ageMs), DEFAULT_CONFIG, NOW);

  const fable = windows.find((w) => w.key === 'scoped:FABLE');
  assert.ok(fable, '重置时刻还在未来的窗口不该因为读数旧就被丢掉');
  assert.equal(fable.percent, 95);
  assert.equal(fable.ageMs, ageMs, '年龄要保留下来供渲染层标注');
});

test('5 小时窗口不需要靠年龄兜底：超时的缓存必然已跨过重置点', () => {
  // 缓存 6 小时前抓的，5 小时窗口的 resets_at 自然已经过去，
  // 由"重置时刻已过"那条精确规则拦掉，与 staleMaxMs 无关
  const windows = mergeWindows(null, snapshot([
    { key: 'session', label: '5H', percent: 88, resetAt: new Date(NOW - HOUR) },
  ], 6 * HOUR), DEFAULT_CONFIG, NOW);
  assert.equal(windows.length, 0);
});

test('跨过重置点的按模型窗口转为 ? 占位而不是消失（周重置后 FABLE 无声消失的回归用例）', () => {
  // 真实场景：Claude Code 的用量缓存只在 /usage 等入口被动刷新。周重置点（如周六 13:00）
  // 过后缓存迟迟不更新时，Fable 的旧读数（96%）已作废，但窗口本身依然存在 ——
  // 它没有 stdin 兜底，直接丢弃会让 FABLE 从状态栏无声消失，可能一连几天。
  const ageMs = 21 * HOUR;
  const windows = mergeWindows(null, snapshot([
    { key: 'scoped:FABLE', label: 'FABLE', percent: 96, resetAt: new Date(NOW - 3 * HOUR),
      severity: 'critical' },
  ], ageMs), DEFAULT_CONFIG, NOW);

  const fable = windows.find((w) => w.key === 'scoped:FABLE');
  assert.ok(fable, '窗口必须保留为占位，不能消失');
  assert.equal(fable.percent, null, '旧百分比是可证伪的错误，必须清空');
  assert.equal(fable.severity, null, '旧 severity 同样作废，不能把 ? 染成红色');
  assert.equal(fable.resetAt, null, '下一次重置时刻未知，不臆造');
  assert.equal(fable.ageMs, ageMs, '年龄保留，供渲染层标注数据有多旧');
});

test('跨过重置点的按模型窗口超过 staleMaxMs 后仍然彻底丢弃', () => {
  const windows = mergeWindows(null, snapshot([
    { key: 'scoped:FABLE', label: 'FABLE', percent: 96, resetAt: new Date(NOW - 3 * HOUR) },
  ], 25 * HOUR), DEFAULT_CONFIG, NOW);
  assert.equal(windows.length, 0, '兜底阈值之外连占位也不显示');
});

test('跨过重置点的 5H / WEEK 窗口依旧丢弃，不做占位（它们有 stdin 实时兜底）', () => {
  const windows = mergeWindows(null, snapshot([
    { key: 'weekly', label: 'WEEK', percent: 63, resetAt: new Date(NOW - HOUR) },
  ]), DEFAULT_CONFIG, NOW);
  assert.equal(windows.length, 0);
});

test('旧到超过 24 小时才真正丢弃', () => {
  const stillShown = mergeWindows(null, snapshot([
    { key: 'weekly', label: 'WEEK', percent: 60, resetAt: new Date(NOW + 3 * 24 * HOUR) },
  ], 23 * HOUR), DEFAULT_CONFIG, NOW);
  assert.equal(stillShown.length, 1, '23 小时仍在阈值内');

  const dropped = mergeWindows(null, snapshot([
    { key: 'weekly', label: 'WEEK', percent: 60, resetAt: new Date(NOW + 3 * 24 * HOUR) },
  ], 25 * HOUR), DEFAULT_CONFIG, NOW);
  assert.equal(dropped.length, 0, '25 小时超出阈值');
});
