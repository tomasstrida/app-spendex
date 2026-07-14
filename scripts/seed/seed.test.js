'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const categories = require('./categories');
const accounts = require('./accounts');
const budgets = require('./budgets');
const fixed = require('./fixed-expenses');
const annual = require('./annual');
const income = require('./income');
const incomeSources = require('./income-sources');

const catNames = new Set(categories.map(c => c.name));

test('24 unikátních kategorií', () => {
  assert.equal(categories.length, 24);
  assert.equal(catNames.size, 24);
});

test('typy kategorií jsou 1, 2, 3 nebo 4', () => {
  for (const c of categories) assert.ok([1, 2, 3, 4].includes(c.type), c.name);
});

test('10 účtů s validní rolí, Hlavní má roli income', () => {
  assert.equal(accounts.length, 10);
  for (const a of accounts) assert.ok(['spending', 'fixed', 'ignored', 'income'].includes(a.role), a.name);
  const hlavni = accounts.find(a => a.name === 'Hlavní');
  assert.equal(hlavni.role, 'income');
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
  assert.equal(fixed.length, 5);
  assert.equal(income.length, 4);
  for (const i of income) assert.match(i.period, /^\d{4}-\d{2}$/);
});

test('fixní výdaje: skupina A, každý má match_pattern a kladnou částku', () => {
  assert.equal(fixed.length, 5);
  const names = fixed.map(f => f.name);
  assert.deepEqual(names, [
    'Nájem Stodůlky', 'Záloha energie PRE', 'Splátka auta RAV4',
    'Telefon T-Mobile', 'Internet Nordic',
  ]);
  for (const f of fixed) {
    assert.ok(f.match_pattern && f.match_pattern.length > 0, f.name);
    assert.ok(f.amount > 0, f.name);
    assert.ok(Number.isInteger(f.sort_order), f.name);
  }
});

test('income-sources: 3 zdroje s patternem a kladným plánem', () => {
  assert.equal(incomeSources.length, 3);
  const persons = incomeSources.map(s => s.person);
  assert.deepEqual(persons, ['Tom', 'Martin', 'Sudo nájem']);
  for (const s of incomeSources) {
    assert.ok(s.match_pattern && s.match_pattern.length > 0, s.person);
    assert.ok(s.planned_amount > 0, s.person);
    assert.ok(Number.isInteger(s.sort_order), s.person);
  }
});
