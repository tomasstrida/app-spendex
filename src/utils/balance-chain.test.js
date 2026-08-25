'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chainBalances } = require('./balance-chain');

test('chainBalances: dopočítá dopředu od kotvy', () => {
  // kotva na indexu 10 = 1000; období 11 přineslo +200, období 12 −50
  const net = { 11: 200, 12: -50 };
  const m = chainBalances({ anchorIndex: 10, anchorBalance: 1000, fromIndex: 10, toIndex: 12, netAt: i => net[i] || 0 });
  assert.equal(m.get(10), 1000);
  assert.equal(m.get(11), 1200);
  assert.equal(m.get(12), 1150);
});

test('chainBalances: dopočítá dozadu od kotvy (odečítá pohyby následujícího období)', () => {
  // zůstatek na konci období 9 = zůstatek na konci 10 minus to, co přibylo v 10
  const net = { 10: 300 };
  const m = chainBalances({ anchorIndex: 10, anchorBalance: 1000, fromIndex: 9, toIndex: 10, netAt: i => net[i] || 0 });
  assert.equal(m.get(10), 1000);
  assert.equal(m.get(9), 700);
});

test('chainBalances: kotva LEŽÍCÍ MIMO zobrazený rozsah funguje', () => {
  // kotva je novější než konec rozsahu → dopočet jde jen dozadu
  const net = { 9: 100, 10: 200 };
  const m = chainBalances({ anchorIndex: 10, anchorBalance: 1000, fromIndex: 8, toIndex: 9, netAt: i => net[i] || 0 });
  assert.equal(m.get(9), 800, '1000 − 200');
  assert.equal(m.get(8), 700, '800 − 100');
});

test('chainBalances: rozsah o jednom období vrátí jen kotvu', () => {
  const m = chainBalances({ anchorIndex: 5, anchorBalance: 42, fromIndex: 5, toIndex: 5, netAt: () => 999 });
  assert.equal(m.size, 1);
  assert.equal(m.get(5), 42);
});

test('chainBalances: netAt se volá jen pro období, která dopočet potřebuje', () => {
  const seen = [];
  chainBalances({ anchorIndex: 3, anchorBalance: 0, fromIndex: 2, toIndex: 4, netAt: i => { seen.push(i); return 0; } });
  assert.deepEqual(seen.sort((a, b) => a - b), [3, 4], 'kotvící období se dozadu odečítá, pro sebe se nepočítá');
});
