/**
 * 配色档位的测试。
 *
 * 规则：充足=绿、过半(>=50%)=黄、只剩两成(>=80%)=淡红；
 * 服务端 severity 只能把档位往上升级，不能把本地阈值压下去。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { levelColor, paint } from '../build/render/colors.js';
import { splitBar } from '../build/render/bar.js';
import { DEFAULT_CONFIG as D } from '../build/config.js';

/** 用充足档位的绿色作为基准色跑一次判定。 */
const level = (percent, severity = null) => levelColor(percent, severity, D, D.colors.usage);

test('三档阈值：<50 绿、[50,80) 黄、>=80 淡红', () => {
  assert.equal(level(0), 'green');
  assert.equal(level(49), 'green');
  assert.equal(level(50), 'yellow');
  assert.equal(level(79), 'yellow');
  assert.equal(level(80), 'brightRed');
  assert.equal(level(100), 'brightRed');
});

test('服务端 severity 可以把档位往上升级', () => {
  assert.equal(level(5, 'warning'), 'yellow', '5% 但服务端告警 → 黄');
  assert.equal(level(5, 'critical'), 'brightRed', '5% 但服务端严重 → 淡红');
});

test('服务端标 normal 不会把本地阈值压回绿色', () => {
  // 这是真实场景：周用量 58%，服务端 severity 是 normal，
  // 若让服务端单方面覆盖，"过半变黄"这条规则大多数时候都不会生效
  assert.equal(level(58, 'normal'), 'yellow');
  assert.equal(level(95, 'normal'), 'brightRed');
});

test('上下文条可以用独立阈值', () => {
  const custom = levelColor(60, null, D, D.colors.context, 70, 85);
  assert.equal(custom, 'green', '60% 未达传入的 70 阈值');
  assert.equal(levelColor(70, null, D, D.colors.context, 70, 85), 'yellow');
});

test('进度条拆成已用与未用两段，便于分别上色', () => {
  assert.deepEqual(splitBar(30, 10, D), { filled: '▓▓▓', empty: '░░░░░░░' });
  assert.deepEqual(splitBar(0, 10, D), { filled: '', empty: '░░░░░░░░░░' });
  assert.deepEqual(splitBar(100, 10, D), { filled: '▓▓▓▓▓▓▓▓▓▓', empty: '' });
  assert.deepEqual(splitBar(1, 10, D), { filled: '▓', empty: '░░░░░░░░░' },
    '非零百分比至少点亮一格');
  assert.deepEqual(splitBar(99.6, 10, D), { filled: '▓▓▓▓▓▓▓▓▓', empty: '░' },
    '未满 100% 至少留一格空');
  assert.deepEqual(splitBar(50, 0, D), { filled: '', empty: '' });
});

test('淡红用的是 bright red(91) 而不是暗红(31)', () => {
  const ESC = String.fromCharCode(0x1b);
  assert.equal(paint('x', 'brightRed'), ESC + '[91m' + 'x' + ESC + '[0m');
  assert.equal(D.colors.critical, 'brightRed');
});

test('NO_COLOR 时不输出任何转义序列', () => {
  const saved = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    assert.equal(paint('x', 'brightRed'), 'x');
  } finally {
    if (saved === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = saved;
  }
});

test('默认阈值就是 50/80，未用部分为暗色', () => {
  assert.equal(D.thresholds.warning, 50);
  assert.equal(D.thresholds.critical, 80);
  assert.equal(D.thresholds.contextWarning, 50);
  assert.equal(D.thresholds.contextCritical, 80);
  assert.equal(D.colors.barEmpty, 'dim');
});
