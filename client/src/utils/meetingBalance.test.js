import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixedActualTotal, surplusToSavings, computeMeetingSurplus } from './meetingBalance.js';

test('fixedActualTotal: manuální proběhlá se počítá skutečnou částkou', () => {
  const rows = [{ source: 'manual', amount: 13255, actual: 13100, tx_count: 1 }];
  assert.equal(fixedActualTotal(rows), 13100);
});

test('fixedActualTotal: manuální neproběhlá (tx_count 0) se nezapočítá', () => {
  const rows = [{ source: 'manual', amount: 5000, actual: 0, tx_count: 0 }];
  assert.equal(fixedActualTotal(rows), 0);
});

test('fixedActualTotal: mix proběhlých a neproběhlých', () => {
  const rows = [
    { source: 'manual', amount: 38126, actual: 38126, tx_count: 1 },
    { source: 'manual', amount: 5000, actual: 0, tx_count: 0 },
    { source: 'manual', amount: 3500, actual: 3450, tx_count: 1 },
  ];
  assert.equal(fixedActualTotal(rows), 41576);
});

test('surplusToSavings: přebytek = příjmy − 4 výdaje (bez pohybů na spořicím)', () => {
  const surplus = surplusToSavings({
    totalIncome: 182000, totalFixed: 44653, variablePoolFunded: 5000,
    totalType1: 34210, totalType3: 5400,
  });
  assert.equal(surplus, 182000 - 44653 - 5000 - 34210 - 5400);
});

test('surplusToSavings: záporný přebytek (výdaje přesáhly příjmy)', () => {
  const surplus = surplusToSavings({
    totalIncome: 50000, totalFixed: 44653, variablePoolFunded: 5000,
    totalType1: 34210, totalType3: 5400,
  });
  assert.ok(surplus < 0);
});

test('computeMeetingSurplus: složí mezisoučty a přebytek stejně jako Schůzka', () => {
  const r = computeMeetingSurplus({
    incomeSources: [
      { id: 1, actual: 140000 },
      { id: 2, actual: 42000 },
    ],
    fixedExpenses: [
      { source: 'manual', amount: 44653, actual: 44653, tx_count: 1 },
    ],
    budgetsType1: [
      { spent: 20000, amount: 25000 },
      { spent: 14210, amount: 15000 },
    ],
    byCategory: [
      { type: 1, spent: 34210 },       // typ 1 se sem nesmí připočíst
      { type: 3, spent: 5400 },
      { type: 4, spent: 999 },         // účetní ignorováno
    ],
    variablePoolFunded: 5000,
  });
  assert.equal(r.totalIncome, 182000);
  assert.equal(r.totalFixed, 44653);
  assert.equal(r.totalType1, 34210);
  assert.equal(r.totalType3, 5400);
  assert.equal(r.variablePoolFunded, 5000);
  assert.equal(r.surplus, 182000 - 44653 - 5000 - 34210 - 5400);
});

test('computeMeetingSurplus: do příjmů jdou jen aliasované zdroje (id != null)', () => {
  const r = computeMeetingSurplus({
    incomeSources: [
      { id: 1, actual: 100000 },
      { id: null, actual: 50000 },     // auto-only, nezapočítat
      { actual: 7000 },                // bez id, nezapočítat
    ],
    fixedExpenses: [],
    budgetsType1: [],
    byCategory: [],
    variablePoolFunded: 0,
  });
  assert.equal(r.totalIncome, 100000);
  assert.equal(r.surplus, 100000);
});

test('computeMeetingSurplus: typ 3 se počítá jen když spent > 0', () => {
  const r = computeMeetingSurplus({
    incomeSources: [],
    fixedExpenses: [],
    budgetsType1: [],
    byCategory: [
      { type: 3, spent: 0 },
      { type: 3, spent: 3200 },
    ],
    variablePoolFunded: 0,
  });
  assert.equal(r.totalType3, 3200);
});

test('computeMeetingSurplus: prázdné vstupy → nuly', () => {
  const r = computeMeetingSurplus({});
  assert.equal(r.totalIncome, 0);
  assert.equal(r.totalFixed, 0);
  assert.equal(r.totalType1, 0);
  assert.equal(r.totalType3, 0);
  assert.equal(r.surplus, 0);
});
