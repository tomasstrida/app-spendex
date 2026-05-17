'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const applyRules = require('./apply-rules');
const rules = require('../seed/rules');

const acc = (n) => ({ account_number: n, name: 'x', role: 'spending' });

test('L0 interní převod (protistrana = vlastní účet) → Převody, přebíjí vše', () => {
  const tx = { counterparty_account: '1679014138/3030', ab_category: 'Příchozí úhrada', description: 'ROHLIK', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Převody');
});

test('L0 normalizace: leading zeros a mezery v čísle protistrany', () => {
  const tx = { counterparty_account: ' 0001679014074 / 2010 ', ab_category: 'Doprava', description: '', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Převody');
});

test('L3 text-override přebíjí účet i AB kategorii', () => {
  const tx = { counterparty_account: 'CZ9920100000002400000000', ab_category: 'Zábava', description: 'MAX FITNESS Praha', note: '' };
  assert.equal(applyRules(tx, acc('1679014111'), rules), 'Sport');
});

test('L3 PrEP override z note', () => {
  const tx = { counterparty_account: '', ab_category: 'Drahe-veci', description: 'Klinika', note: 'PrEP davka' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Y - Léky, PrEP, Optika');
});

test('L1 účetní pravidlo (Licence účet) když není L0/L3', () => {
  const tx = { counterparty_account: 'EXTERNAL999', ab_category: 'Nezařazeno', description: 'Apple', note: '' };
  assert.equal(applyRules(tx, acc('1679014111'), rules), 'Licence');
});

test('L2 AB kategorie když není L0/L3/L1', () => {
  const tx = { counterparty_account: 'EXTERNAL999', ab_category: 'Restaurace', description: 'Pizza', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Restaurace a kávičky');
});

test('L2 Příchozí úhrada (externí) → Příjmy', () => {
  const tx = { counterparty_account: 'EXTERNAL999', ab_category: 'Příchozí úhrada', description: 'STRIPE', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Příjmy');
});

test('L2 Pojištění → Y - Pojistky', () => {
  const tx = { counterparty_account: 'EXT', ab_category: 'Pojištění', description: 'Allianz', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Y - Pojistky');
});

test('fallback → Ostatní pro neznámou AB kategorii', () => {
  const tx = { counterparty_account: 'EXT', ab_category: 'NeznamaXY', description: 'cosi', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Ostatní');
});

test('prázdná protistrana neaktivuje L0', () => {
  const tx = { counterparty_account: '', ab_category: 'Sport', description: '', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Sport');
});

test('L3 Toyota Financial → Pravidelné platby', () => {
  const tx = { counterparty_account: 'EXTERNAL999', ab_category: 'Splátky', description: 'Toyota Financial Services Czech s.r.o.', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Pravidelné platby');
});

test('L3 OPENAI → Licence', () => {
  const tx = { counterparty_account: 'EXTERNAL999', ab_category: 'Nezařazeno', description: 'OPENAI *CHATGPT SUBSCR', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Licence');
});
