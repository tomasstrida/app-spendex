import test from 'node:test';
import assert from 'node:assert/strict';
import { unmatchedIncome, unmatchedLabel } from './unmatchedIncome.js';

test('sečte auto-only řádky (id == null) s nenulovou částkou', () => {
  const r = unmatchedIncome([
    { id: 5, person: 'Martin', actual: 20000, tx_ids: [1, 2] },
    { id: null, person: '1812270019/3030', actual: 100, match_counterparty_account: '1812270019/3030', tx_ids: [3] },
    { id: null, person: '9999999999/0800', actual: 4100, match_counterparty_account: '9999999999/0800', tx_ids: [4, 5] },
  ]);
  assert.equal(r.count, 2);
  assert.equal(r.total, 4200);
  assert.deepEqual(r.tx_ids, [3, 4, 5]);
});

test('aliasované zdroje se do varování nepočítají', () => {
  const r = unmatchedIncome([
    { id: 5, person: 'Martin', actual: 20000, tx_ids: [1] },
    { id: 8, person: 'Tom', actual: 140000, tx_ids: [2] },
  ]);
  assert.equal(r.count, 0);
  assert.equal(r.total, 0);
  assert.deepEqual(r.tx_ids, []);
});

test('auto-only s nulovou částkou varování nespustí', () => {
  const r = unmatchedIncome([
    { id: null, person: 'X', actual: 0, match_counterparty_account: '123456789/0800', tx_ids: [] },
  ]);
  assert.equal(r.count, 0);
  assert.equal(r.total, 0);
});

test('prázdný nebo chybějící vstup', () => {
  assert.deepEqual(unmatchedIncome([]), { count: 0, total: 0, tx_ids: [] });
  assert.deepEqual(unmatchedIncome(undefined), { count: 0, total: 0, tx_ids: [] });
});

test('tolerantní k chybějícím tx_ids', () => {
  const r = unmatchedIncome([
    { id: null, person: 'X', actual: 250, match_counterparty_account: '123456789/0800' },
  ]);
  assert.equal(r.count, 1);
  assert.equal(r.total, 250);
  assert.deepEqual(r.tx_ids, []);
});

test('karetní vratky (bez protiúčtu) se do varování nepočítají', () => {
  const r = unmatchedIncome([
    { id: null, person: 'DEKUJEME, ROHLIK.CZ', actual: 95.29, match_counterparty_account: null, tx_ids: [1] },
    { id: null, person: '156580590/0300', actual: 1800, match_counterparty_account: '156580590/0300', tx_ids: [2] },
  ]);
  assert.equal(r.count, 1);
  assert.equal(r.total, 1800);
  assert.deepEqual(r.tx_ids, [2]);
});

test('unmatchedLabel: české skloňování 1 / 2–4 / 5+', () => {
  assert.equal(unmatchedLabel(1), '1 nezařazená příchozí platba');
  assert.equal(unmatchedLabel(2), '2 nezařazené příchozí platby');
  assert.equal(unmatchedLabel(4), '4 nezařazené příchozí platby');
  assert.equal(unmatchedLabel(5), '5 nezařazených příchozích plateb');
  assert.equal(unmatchedLabel(11), '11 nezařazených příchozích plateb');
});
