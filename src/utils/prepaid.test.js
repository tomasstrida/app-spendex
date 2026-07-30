'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { unitAmount, drawAmount, packageSummary, writeOffAmount } = require('./prepaid');

const PKG = { total_amount: 5000, units_total: 10, unit_amount: 500 };

test('unitAmount deli celkovou castku poctem jednotek', () => {
  assert.equal(unitAmount(5000, 10), 500);
  assert.equal(unitAmount(1000, 3), 1000 / 3);
});

test('unitAmount odmita nulovy nebo zaporny pocet jednotek', () => {
  assert.throws(() => unitAmount(5000, 0), /jednotek/i);
  assert.throws(() => unitAmount(5000, -1), /jednotek/i);
});

test('drawAmount nasobi cenu jednotky poctem jednotek', () => {
  assert.equal(drawAmount(500, 1), 500);
  assert.equal(drawAmount(500, 2), 1000);
});

test('packageSummary secte cerpani a spocita zbytek', () => {
  const draws = [
    { date: '2026-03-05', units: 1, amount: 500 },
    { date: '2026-04-11', units: 2, amount: 1000 },
  ];
  const s = packageSummary(PKG, draws);
  assert.equal(s.drawn_units, 3);
  assert.equal(s.drawn_amount, 1500);
  assert.equal(s.remaining_units, 7);
  assert.equal(s.remaining_amount, 3500);
  assert.equal(s.last_draw_date, '2026-04-11');
});

test('packageSummary bez cerpani vraci plny zbytek a last_draw_date null', () => {
  const s = packageSummary(PKG, []);
  assert.equal(s.drawn_units, 0);
  assert.equal(s.drawn_amount, 0);
  assert.equal(s.remaining_units, 10);
  assert.equal(s.remaining_amount, 5000);
  assert.equal(s.last_draw_date, null);
});

test('packageSummary neklesne pod nulu ani pri prekrocení', () => {
  const s = packageSummary(PKG, [{ date: '2026-03-05', units: 12, amount: 6000 }]);
  assert.equal(s.remaining_units, 0);
  assert.equal(s.remaining_amount, 0);
});

test('writeOffAmount vraci presny zbytek castky vcetne zaokrouhlovaciho rozdilu', () => {
  const pkg = { total_amount: 1000, units_total: 3, unit_amount: 1000 / 3 };
  const draws = [
    { date: '2026-03-01', units: 1, amount: 1000 / 3 },
    { date: '2026-03-02', units: 1, amount: 1000 / 3 },
  ];
  assert.ok(Math.abs(writeOffAmount(pkg, draws) - 1000 / 3) < 0.0001);
  assert.equal(writeOffAmount(PKG, [{ date: '2026-03-01', units: 10, amount: 5000 }]), 0);
});
