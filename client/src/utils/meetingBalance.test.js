import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixedActualTotal, surplusToSavings } from './meetingBalance.js';

test('fixedActualTotal: manuální proběhlá se počítá skutečnou částkou', () => {
  const rows = [{ source: 'manual', amount: 13255, actual: 13100, tx_count: 1 }];
  assert.equal(fixedActualTotal(rows), 13100);
});

test('fixedActualTotal: manuální neproběhlá (tx_count 0) se nezapočítá', () => {
  const rows = [{ source: 'manual', amount: 5000, actual: 0, tx_count: 0 }];
  assert.equal(fixedActualTotal(rows), 0);
});

test('fixedActualTotal: account-řádek se počítá svým amount', () => {
  const rows = [{ source: 'account', amount: 1234 }];
  assert.equal(fixedActualTotal(rows), 1234);
});

test('fixedActualTotal: mix', () => {
  const rows = [
    { source: 'manual', amount: 38126, actual: 38126, tx_count: 1 },
    { source: 'manual', amount: 5000, actual: 0, tx_count: 0 },
    { source: 'account', amount: 200 },
  ];
  assert.equal(fixedActualTotal(rows), 38326);
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
