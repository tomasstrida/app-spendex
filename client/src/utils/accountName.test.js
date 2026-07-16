import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccountNumber, buildAccountNameMap, accountNameFor } from './accountName.js';

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
