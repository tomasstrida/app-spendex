import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetFillColor, BUDGET_GREEN, BUDGET_ORANGE, BUDGET_RED } from './budgetColor.js';

test('bez rozpočtu → zelená (žádné dělení nulou)', () => {
  assert.equal(budgetFillColor({ spent: 500, amount: 0, daysPassed: 10, totalDays: 30 }), BUDGET_GREEN);
});

test('přečerpáno → červená', () => {
  assert.equal(budgetFillColor({ spent: 120, amount: 100, daysPassed: 30, totalDays: 30 }), BUDGET_RED);
});

test('v normě (tempo pod uplynulými dny) → zelená', () => {
  // 40 % budgetu v polovině období
  assert.equal(budgetFillColor({ spent: 40, amount: 100, daysPassed: 15, totalDays: 30 }), BUDGET_GREEN);
});

test('hrozí přečerpání (tempo nad uplynulými dny) → oranžová', () => {
  // 60 % budgetu v polovině období
  assert.equal(budgetFillColor({ spent: 60, amount: 100, daysPassed: 15, totalDays: 30 }), BUDGET_ORANGE);
});

test('přesně na budgetu na konci období → zelená (ne přečerpáno)', () => {
  assert.equal(budgetFillColor({ spent: 100, amount: 100, daysPassed: 30, totalDays: 30 }), BUDGET_GREEN);
});

test('vyčerpaný budget uprostřed období → oranžová (hrozí)', () => {
  assert.equal(budgetFillColor({ spent: 100, amount: 100, daysPassed: 15, totalDays: 30 }), BUDGET_ORANGE);
});

test('začátek období (0 dní) s utrácením → oranžová', () => {
  assert.equal(budgetFillColor({ spent: 10, amount: 100, daysPassed: 0, totalDays: 30 }), BUDGET_ORANGE);
});
