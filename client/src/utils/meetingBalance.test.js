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

test('surplusToSavings: přebytek = příjmy − 3 výdaje (bez pohybů na spořicím)', () => {
  const surplus = surplusToSavings({
    totalIncome: 182000, totalFixed: 44653,
    totalType1: 34210, totalType3: 5400,
  });
  assert.equal(surplus, 182000 - 44653 - 34210 - 5400);
});

test('surplusToSavings: záporný přebytek (výdaje přesáhly příjmy)', () => {
  const surplus = surplusToSavings({
    totalIncome: 50000, totalFixed: 44653,
    totalType1: 34210, totalType3: 5400,
  });
  assert.ok(surplus < 0);
});

// Dotace na Nepravidelné byla samostatnou položkou bilance počítanou z hardcoded
// čísla účtu. Teď se do bilance dostane jen jako definovaná fixní platba, takže
// se stejný přesun nepočítá dvakrát a bilance nemá skryté vstupy.
test('surplusToSavings: variablePoolFunded se ignoruje (dotace patří do fixních plateb)', () => {
  const base = { totalIncome: 100000, totalFixed: 20000, totalType1: 10000, totalType3: 0 };
  assert.equal(surplusToSavings({ ...base, variablePoolFunded: 17800 }), 70000);
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
  });
  assert.equal(r.totalIncome, 182000);
  assert.equal(r.totalFixed, 44653);
  assert.equal(r.totalType1, 34210);
  assert.equal(r.totalType3, 5400);
  assert.equal(r.surplus, 182000 - 44653 - 34210 - 5400);
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

test('surplusToSavings: odečte dobití fondu i roční výdaje mimo fond', () => {
  const surplus = surplusToSavings({
    totalIncome: 203700, totalFixed: 102990,
    fundTopup: 10500, annualOffFund: 2653,
    totalType1: 55893, totalType3: 3600,
  });
  assert.equal(surplus, 203700 - 102990 - 10500 - 2653 - 55893 - 3600);
  assert.equal(surplus, 28064);
});

test('surplusToSavings: chybějící fundTopup/annualOffFund = 0 (zpětná kompatibilita)', () => {
  const surplus = surplusToSavings({
    totalIncome: 100000, totalFixed: 20000, totalType1: 10000, totalType3: 0,
  });
  assert.equal(surplus, 70000);
});

test('computeMeetingSurplus: nové vstupy projdou do výsledku i do přebytku', () => {
  const r = computeMeetingSurplus({
    incomeSources: [{ id: 1, actual: 100000 }],
    fixedExpenses: [{ source: 'manual', amount: 20000, actual: 20000, tx_count: 1 }],
    budgetsType1: [{ spent: 10000, amount: 12000 }],
    byCategory: [{ type: 3, spent: 1000 }],
    fundTopup: 5000,
    annualOffFund: 2000,
  });
  assert.equal(r.fundTopup, 5000);
  assert.equal(r.annualOffFund, 2000);
  assert.equal(r.surplus, 100000 - 20000 - 5000 - 2000 - 10000 - 1000);
});

test('surplusToSavings odecte nakup predplacenych balicku', () => {
  const base = { totalIncome: 100000, totalFixed: 40000, fundTopup: 0, annualOffFund: 0, totalType1: 20000, totalType3: 0 };
  assert.equal(surplusToSavings(base), 40000);
  assert.equal(surplusToSavings({ ...base, prepaidPurchase: 5000 }), 35000);
});

test('computeMeetingSurplus vraci prepaidPurchase a zapocita ho do prebytku', () => {
  const r = computeMeetingSurplus({
    incomeSources: [{ id: 1, actual: 50000 }],
    fixedExpenses: [],
    budgetsType1: [{ spent: 10000, budget_spent: 12000, amount: 15000 }],
    byCategory: [],
    prepaidPurchase: 3000,
  });
  assert.equal(r.prepaidPurchase, 3000);
  assert.equal(r.totalType1, 10000, 'bilance jede z transakcniho spent, ne z budget_spent');
  assert.equal(r.surplus, 37000);
});
