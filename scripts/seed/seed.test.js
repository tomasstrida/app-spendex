'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const categories = require('./categories');
const accounts = require('./accounts');
const budgets = require('./budgets');
const fixed = require('./fixed-expenses');
const annual = require('./annual');
const income = require('./income');

const catNames = new Set(categories.map(c => c.name));

test('24 unikátních kategorií', () => {
  assert.equal(categories.length, 24);
  assert.equal(catNames.size, 24);
});

test('typy kategorií jsou 1, 2 nebo 3', () => {
  for (const c of categories) assert.ok([1, 2, 3].includes(c.type), c.name);
});

test('10 účtů s validní rolí', () => {
  assert.equal(accounts.length, 10);
  for (const a of accounts) assert.ok(['spending', 'fixed', 'ignored'].includes(a.role), a.name);
});

test('budgety odkazují existující kategorie', () => {
  assert.equal(budgets.length, 13);
  for (const b of budgets) assert.ok(catNames.has(b.category), b.category);
});

test('annual a budget_items odkazují existující kategorie', () => {
  for (const a of annual.annualBudgets) assert.ok(catNames.has(a.category), a.category);
  for (const i of annual.budgetItems) {
    assert.ok(catNames.has(i.category), i.category);
    assert.ok(i.window_start >= 1 && i.window_end <= 12 && i.window_start <= i.window_end, i.name);
  }
});

test('fixed_expenses a income mají správný tvar', () => {
  assert.equal(fixed.length, 8);
  assert.equal(income.length, 4);
  for (const i of income) assert.match(i.period, /^\d{4}-\d{2}$/);
});
