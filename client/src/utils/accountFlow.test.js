import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountFlow } from './accountFlow.js';

const accountById = new Map([[1, 'Hlavní'], [2, 'Společný']]);
const accountNameMap = new Map([['1679014082', 'Spořicí účet 1']]);
const ctx = { accountById, accountNameMap };

test('odchozí na interní účet → náš → název interního', () => {
  const tx = { amount: -500, account_id: 1, counterparty_account: '1679014082/3030' };
  assert.deepEqual(accountFlow(tx, ctx), { from: 'Hlavní', to: 'Spořicí účet 1' });
});

test('příchozí z externího čísla → číslo → náš', () => {
  const tx = { amount: 21000, account_id: 1, counterparty_account: '19-123456/0800' };
  assert.deepEqual(accountFlow(tx, ctx), { from: '19-123456/0800', to: 'Hlavní' });
});

test('karetní platba (bez protistrany, s place) → náš → obchodník', () => {
  const tx = { amount: -300, account_id: 2, counterparty_account: null, place: 'Alza' };
  assert.deepEqual(accountFlow(tx, ctx), { from: 'Společný', to: 'Alza' });
});

test('account_id null → naše strana je —', () => {
  const tx = { amount: -100, account_id: null, counterparty_account: '123456/0800' };
  assert.deepEqual(accountFlow(tx, ctx), { from: '—', to: '123456/0800' });
});

test('žádná protistrana ani place → —', () => {
  const tx = { amount: -100, account_id: 1, counterparty_account: null, place: null };
  assert.deepEqual(accountFlow(tx, ctx), { from: 'Hlavní', to: '—' });
});

test('příchozí karetní refund (bez protistrany, s place) → obchodník → náš', () => {
  const tx = { amount: 250, account_id: 2, counterparty_account: null, place: 'Alza' };
  assert.deepEqual(accountFlow(tx, ctx), { from: 'Alza', to: 'Společný' });
});
