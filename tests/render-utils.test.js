/**
 * 消毒、宽度、时间格式化这些纯函数的测试。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeText } from '../build/sanitize.js';
import { stringWidth, truncate, stripAnsi } from '../build/render/width.js';
import { formatDuration, formatAge } from '../build/render/time.js';
import { renderBar } from '../build/render/bar.js';
import { formatPath } from '../build/render/path.js';
import { DEFAULT_CONFIG } from '../build/config.js';

const ESC = String.fromCharCode(0x1b);
const NUL = String.fromCharCode(0x00);
const RLO = String.fromCharCode(0x202e); // 双向覆盖，可用来反向渲染伪造文本
const ZWSP = String.fromCharCode(0x200b);

test('消毒：剥掉完整的 ANSI 序列而不是只删 ESC', () => {
  // 只删 ESC 会留下 "[31m" 这种可见残渣
  assert.equal(sanitizeText(ESC + '[31mFable' + ESC + '[0m'), 'Fable');
});

test('消毒：剔除控制字符、零宽字符与双向控制字符', () => {
  assert.equal(sanitizeText('Fa' + NUL + 'ble' + RLO), 'Fable');
  assert.equal(sanitizeText('a' + ZWSP + 'bc'), 'abc');
  assert.equal(sanitizeText('a\rb\nc'), 'abc');
});

test('消毒：非字符串或清洗后为空时返回 null', () => {
  assert.equal(sanitizeText(null), null);
  assert.equal(sanitizeText(123), null);
  assert.equal(sanitizeText('   '), null);
  assert.equal(sanitizeText(ESC + '[0m'), null);
});

test('消毒：按长度截断', () => {
  assert.equal(sanitizeText('abcdefghij', 4), 'abcd');
});

test('宽度：中文占两列，ASCII 占一列', () => {
  assert.equal(stringWidth('abc'), 3);
  assert.equal(stringWidth('用量'), 4);
  assert.equal(stringWidth('CTX 用量'), 8);
});

test('宽度：进度条字符按一列计（现代终端的默认行为）', () => {
  assert.equal(stringWidth('▓▓░░'), 4);
});

test('宽度：测量前先剥掉 ANSI，不把转义码算进可见宽度', () => {
  const painted = ESC + '[32m' + 'abc' + ESC + '[0m';
  assert.equal(stripAnsi(painted), 'abc');
  assert.equal(stringWidth(painted), 3);
});

test('截断：不会把双列字符劈成一半', () => {
  assert.equal(truncate('用量统计', 5), '用量…');
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 10), 'abc');
});

test('倒计时格式化', () => {
  assert.equal(formatDuration(3 * 24 * 3600_000), '3d');
  assert.equal(formatDuration(2 * 24 * 3600_000 + 5 * 3600_000), '2d5h');
  assert.equal(formatDuration(2 * 3600_000 + 14 * 60_000), '2h14m');
  assert.equal(formatDuration(45 * 60_000), '45m');
  assert.equal(formatDuration(30_000), '30s');
  assert.equal(formatDuration(-1), null);
});

test('数据年龄格式化', () => {
  assert.equal(formatAge(8 * 60_000), '8m');
  assert.equal(formatAge(2 * 3600_000), '2h');
  assert.equal(formatAge(30_000), null, '不足一分钟不值得标注');
});

test('进度条：非零百分比至少点亮一格，未满不会画满', () => {
  assert.equal(renderBar(0, 10, DEFAULT_CONFIG), '░░░░░░░░░░');
  assert.equal(renderBar(1, 10, DEFAULT_CONFIG), '▓░░░░░░░░░');
  assert.equal(renderBar(99, 10, DEFAULT_CONFIG), '▓▓▓▓▓▓▓▓▓░');
  assert.equal(renderBar(100, 10, DEFAULT_CONFIG), '▓▓▓▓▓▓▓▓▓▓');
  assert.equal(renderBar(50, 0, DEFAULT_CONFIG), '');
});

test('路径：家目录压成 ~，只保留末级', () => {
  const home = process.env.HOME;
  assert.equal(formatPath(home + '/Project/App', 2), '~/Project/App');
  assert.equal(formatPath(home + '/Desktop/Project/App', 2), '…/Project/App');
  assert.equal(formatPath('/etc/nginx/conf.d', 1), '…/conf.d');
  assert.equal(formatPath(null, 2), null);
});
