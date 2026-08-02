import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccountNumber, buildAccountNameMap, accountNameFor, placeDisplay } from './accountName.js';

test('normalizace zachová kompletní číslo, ořeže jen mezery', () => {
  assert.equal(normalizeAccountNumber(' 1679014082/3030 '), '1679014082/3030');
  assert.equal(normalizeAccountNumber('19-1679014082/3030'), '19-1679014082/3030');
});

test('normalizace holého čísla beze změny', () => {
  assert.equal(normalizeAccountNumber('1679014082'), '1679014082');
});

test('normalizace prázdné/null → prázdný string', () => {
  assert.equal(normalizeAccountNumber(null), '');
  assert.equal(normalizeAccountNumber(''), '');
});

const accounts = [
  { account_number: '1679014082/3030', name: 'Spořicí účet 1' },
  { account_number: '1679014023/3030', name: 'Společný' },
  { account_number: null, name: 'Bez čísla' },
];

test('match interního účtu vrátí název (exact kompletní číslo)', () => {
  const map = buildAccountNameMap(accounts);
  assert.equal(accountNameFor('1679014082/3030', map), 'Spořicí účet 1');
  // jiné předčíslí = jiný účet → žádný match
  assert.equal(accountNameFor('19-1679014082/3030', map), null);
});

test('externí protistrana vrátí null', () => {
  const map = buildAccountNameMap(accounts);
  assert.equal(accountNameFor('123456/0800', map), null);
});

test('prázdný vstup vrátí null', () => {
  const map = buildAccountNameMap(accounts);
  assert.equal(accountNameFor('', map), null);
  assert.equal(accountNameFor(null, map), null);
});

const txAccounts = [
  { account_number: '1679014138/3030', name: 'Hlavní' },
  { account_number: '1679014023/3030', name: 'Společný' },
];

test('placeDisplay: vyplněné place má přednost a není odvozené', () => {
  const map = buildAccountNameMap(txAccounts);
  const r = placeDisplay({ place: 'ALBERT 1234', counterparty_account: '1679014138/3030' }, map);
  assert.deepEqual(r, { text: 'ALBERT 1234', derived: false });
});

test('placeDisplay: interní protiúčet → "číslo · název", označeno jako odvozené', () => {
  const map = buildAccountNameMap(txAccounts);
  const r = placeDisplay({ place: null, counterparty_account: '1679014138/3030' }, map);
  assert.deepEqual(r, { text: '1679014138/3030 · Hlavní', derived: true });
});

test('placeDisplay: externí protiúčet → holé číslo (QR platba ve stánku)', () => {
  const map = buildAccountNameMap(txAccounts);
  const r = placeDisplay({ place: '', counterparty_account: '201220675/0600' }, map);
  assert.deepEqual(r, { text: '201220675/0600', derived: true });
});

test('placeDisplay: bez place i bez protiúčtu → null', () => {
  const map = buildAccountNameMap(txAccounts);
  assert.equal(placeDisplay({ place: null, counterparty_account: null }, map), null);
  assert.equal(placeDisplay({ place: '', counterparty_account: '' }, map), null);
});

test('placeDisplay: mezery v čísle účtu nevadí, výstup je normalizované číslo', () => {
  const map = buildAccountNameMap(txAccounts);
  const r = placeDisplay({ place: null, counterparty_account: ' 1679014023/3030 ' }, map);
  assert.deepEqual(r, { text: '1679014023/3030 · Společný', derived: true });
});

test('placeDisplay: chybějící tx nebo mapa nespadne', () => {
  assert.equal(placeDisplay(null, new Map()), null);
  assert.deepEqual(placeDisplay({ place: 'X' }, null), { text: 'X', derived: false });
});

test('placeDisplay: IBAN protiúčtu (nezačíná číslicí) → holý IBAN, žádný pád', () => {
  const map = buildAccountNameMap(txAccounts);
  const r = placeDisplay({ place: null, counterparty_account: 'CZ6530300000001679014138' }, map);
  assert.deepEqual(r, { text: 'CZ6530300000001679014138', derived: true });
});

test('placeDisplay: place jen z mezer propadne na protiúčet', () => {
  const map = buildAccountNameMap(txAccounts);
  const r = placeDisplay({ place: '   ', counterparty_account: '201220675/0600' }, map);
  assert.deepEqual(r, { text: '201220675/0600', derived: true });
});

test('placeDisplay: prázdné place + nameMap null + protiúčet → holé číslo', () => {
  const r = placeDisplay({ place: '', counterparty_account: '201220675/0600' }, null);
  assert.deepEqual(r, { text: '201220675/0600', derived: true });
});
