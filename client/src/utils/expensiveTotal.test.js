import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumExpensiveTotal } from './expensiveTotal.js';

test('sečte výdaje jako kladné utraceno', () => {
  assert.equal(sumExpensiveTotal([{ amount: -1200 }, { amount: -800 }]), 2000);
});

test('refund (kladný amount) se odečte', () => {
  assert.equal(sumExpensiveTotal([{ amount: -1200 }, { amount: 500 }]), 700);
});

test('prázdné pole → 0', () => {
  assert.equal(sumExpensiveTotal([]), 0);
});
