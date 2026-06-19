import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepPeriod } from './stepPeriod.js';

test('posun o měsíc zpět', () => {
  assert.equal(stepPeriod('2026-06', -1, '2026-06'), '2026-05');
});

test('posun o měsíc vpřed', () => {
  assert.equal(stepPeriod('2026-04', 1, '2026-06'), '2026-05');
});

test('přechod přes rok zpět', () => {
  assert.equal(stepPeriod('2026-01', -1, '2026-06'), '2025-12');
});

test('vpřed nepřekročí aktuální měsíc (clamp)', () => {
  assert.equal(stepPeriod('2026-06', 1, '2026-06'), '2026-06');
});

test('vpřed bez maxPeriod není omezený', () => {
  assert.equal(stepPeriod('2026-06', 1, null), '2026-07');
});

test('zpět clamp neplatí', () => {
  assert.equal(stepPeriod('2026-06', -1, '2026-06'), '2026-05');
});

test('prázdné období → beze změny', () => {
  assert.equal(stepPeriod(null, -1, '2026-06'), null);
});
