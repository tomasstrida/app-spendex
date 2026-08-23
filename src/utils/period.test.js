'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { periodKeyForDate, getPeriodDates, shiftPeriodKey, defaultHistoryRange } = require('./period');

test('billingDay=1 → periodKey je prostě YYYY-MM data', () => {
  assert.equal(periodKeyForDate(1, '2026-06-15'), '2026-06');
  assert.equal(periodKeyForDate(1, '2026-06-01'), '2026-06');
  assert.equal(periodKeyForDate(1, '2026-12-31'), '2026-12');
});

test('billingDay=15 → den před billingDay patří do předchozího měsíce', () => {
  assert.equal(periodKeyForDate(15, '2026-06-15'), '2026-06');
  assert.equal(periodKeyForDate(15, '2026-06-20'), '2026-06');
  assert.equal(periodKeyForDate(15, '2026-06-14'), '2026-05');
});

test('billingDay>1 přelom roku: leden před billingDay → prosinec loni', () => {
  assert.equal(periodKeyForDate(10, '2026-01-05'), '2025-12');
  assert.equal(periodKeyForDate(10, '2026-01-10'), '2026-01');
});

test('vrácený periodKey je konzistentní s getPeriodDates (datum padne do okna)', () => {
  const key = periodKeyForDate(15, '2026-06-14');
  const { start, end } = getPeriodDates(15, key);
  assert.ok('2026-06-14' >= start && '2026-06-14' <= end, `${start}..${end}`);
});

test('shiftPeriodKey: přes hranici roku oběma směry', () => {
  assert.equal(shiftPeriodKey('2026-01', -1), '2025-12');
  assert.equal(shiftPeriodKey('2025-12', 1), '2026-01');
  assert.equal(shiftPeriodKey('2026-08', -11), '2025-09');
  assert.equal(shiftPeriodKey('2026-03', 0), '2026-03');
});

test('defaultHistoryRange: končí posledním KOMPLETNÍM obdobím, ne běžícím', () => {
  assert.deepEqual(defaultHistoryRange('2026-08', 6), { from: '2026-01', to: '2026-07' });
  assert.deepEqual(defaultHistoryRange('2026-12', 6), { from: '2026-01', to: '2026-11' });
});

test('defaultHistoryRange: pod 6 období → posledních 6 kompletních', () => {
  assert.deepEqual(defaultHistoryRange('2026-06', 6), { from: '2025-12', to: '2026-05' });
  assert.deepEqual(defaultHistoryRange('2026-03', 6), { from: '2025-09', to: '2026-02' });
  assert.deepEqual(defaultHistoryRange('2026-01', 6), { from: '2025-07', to: '2025-12' });
});

test('defaultHistoryRange: běžící období není nikdy v rozsahu', () => {
  for (let m = 1; m <= 12; m++) {
    const current = `2026-${String(m).padStart(2, '0')}`;
    const { from, to } = defaultHistoryRange(current, 6);
    assert.equal(to, shiftPeriodKey(current, -1), `${current}: to musí být předchozí období`);
    assert.ok(from <= to, `${current}: from nesmí přeskočit to`);
  }
});
