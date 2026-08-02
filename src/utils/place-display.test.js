'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAccountNameMap, placeDisplayText } = require('./place-display');

const accounts = [
  { account_number: '1679014138/3030', name: 'Hlavní' },
  { account_number: '1679014023/3030', name: 'Společný' },
  { account_number: null, name: 'Bez čísla' },
];

test('vyplněné place má přednost', () => {
  const map = buildAccountNameMap(accounts);
  assert.equal(placeDisplayText({ place: 'ALBERT 1234', counterparty_account: '1679014138/3030' }, map), 'ALBERT 1234');
});

test('interní protiúčet → "číslo · název"', () => {
  const map = buildAccountNameMap(accounts);
  assert.equal(placeDisplayText({ place: null, counterparty_account: '1679014138/3030' }, map), '1679014138/3030 · Hlavní');
});

test('externí protiúčet → holé číslo', () => {
  const map = buildAccountNameMap(accounts);
  assert.equal(placeDisplayText({ place: '', counterparty_account: '201220675/0600' }, map), '201220675/0600');
});

test('bez place i bez protiúčtu → prázdný string', () => {
  const map = buildAccountNameMap(accounts);
  assert.equal(placeDisplayText({ place: null, counterparty_account: null }, map), '');
});

test('účet bez čísla v mapě nefiguruje a nespadne', () => {
  const map = buildAccountNameMap(accounts);
  assert.equal(map.size, 2);
  assert.equal(placeDisplayText({ counterparty_account: '19-1679014138/3030' }, map), '19-1679014138/3030');
});

test('IBAN protiúčtu (nezačíná číslicí) → holý IBAN, žádný pád', () => {
  const map = buildAccountNameMap(accounts);
  assert.equal(
    placeDisplayText({ place: null, counterparty_account: 'CZ6530300000001679014138' }, map),
    'CZ6530300000001679014138'
  );
});
