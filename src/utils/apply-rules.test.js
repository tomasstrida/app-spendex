'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const applyRules = require('./apply-rules');
const rules = require('../../scripts/seed/rules');

const acc = (n) => ({ account_number: n, name: 'x', role: 'spending' });

test('L0 interní převod (protistrana = vlastní účet) → Převody, přebíjí vše', () => {
  const tx = { counterparty_account: '1679014138/3030', ab_category: 'Příchozí úhrada', description: 'ROHLIK', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules).category, 'Převody');
});

test('L0 normalizace: mezery se ořežou, porovnává se kompletní číslo vč. kódu banky', () => {
  const tx = { counterparty_account: ' 1679014074 / 3030 ', ab_category: 'Doprava', description: '', note: '' };
  assert.equal(applyRules(tx, acc('1679014023/3030'), rules).category, 'Převody');
});

test('L0: stejné číslo s JINÝM kódem banky NENÍ vlastní účet (kompletní identita)', () => {
  const tx = { counterparty_account: '1679014074/2010', ab_category: 'Doprava', description: '', note: '' };
  assert.notEqual(applyRules(tx, acc('1679014023/3030'), rules).category, 'Převody');
});

test('L3 text-override přebíjí účet i AB kategorii', () => {
  const tx = { counterparty_account: 'CZ9920100000002400000000', ab_category: 'Zábava', description: 'MAX FITNESS Praha', note: '' };
  assert.equal(applyRules(tx, acc('1679014111'), rules).category, 'Sport');
});

test('L3 PrEP override z note', () => {
  const tx = { counterparty_account: '', ab_category: 'Drahe-veci', description: 'Klinika', note: 'PrEP davka' };
  assert.equal(applyRules(tx, acc('1679014023'), rules).category, 'Y - Léky, PrEP, Optika');
});

test('L1 účetní pravidlo (Licence účet) když není L0/L3', () => {
  const tx = { counterparty_account: 'EXTERNAL999', ab_category: 'Nezařazeno', description: 'Apple', note: '' };
  assert.equal(applyRules(tx, acc('1679014111/3030'), rules).category, 'Licence');
});

test('L2 AB kategorie když není L0/L3/L1', () => {
  const tx = { counterparty_account: 'EXTERNAL999', ab_category: 'Restaurace', description: 'Pizza', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules).category, 'Restaurace a kávičky');
});

test('L2 Příchozí úhrada (externí) → Příjmy', () => {
  const tx = { counterparty_account: 'EXTERNAL999', ab_category: 'Příchozí úhrada', description: 'STRIPE', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules).category, 'Příjmy');
});

test('L2 Pojištění → Y - Pojistky', () => {
  const tx = { counterparty_account: 'EXT', ab_category: 'Pojištění', description: 'Allianz', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules).category, 'Y - Pojistky');
});

test('fallback → Ostatní pro neznámou AB kategorii', () => {
  const tx = { counterparty_account: 'EXT', ab_category: 'NeznamaXY', description: 'cosi', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules).category, 'Ostatní');
});

test('prázdná protistrana neaktivuje L0', () => {
  const tx = { counterparty_account: '', ab_category: 'Sport', description: '', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules).category, 'Sport');
});

test('L3 Toyota Financial → Pravidelné platby', () => {
  const tx = { counterparty_account: 'EXTERNAL999', ab_category: 'Splátky', description: 'Toyota Financial Services Czech s.r.o.', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules).category, 'Pravidelné platby');
});

test('L3 OPENAI → Licence', () => {
  const tx = { counterparty_account: 'EXTERNAL999', ab_category: 'Nezařazeno', description: 'OPENAI *CHATGPT SUBSCR', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules).category, 'Licence');
});

test('amount_max_abs: SHELL −90 Kč (pod 200) → Restaurace a kávičky', () => {
  const tx = { counterparty_account: 'EXT', ab_category: 'Doprava', description: 'SHELL 8100', note: '', amount: -90 };
  assert.equal(applyRules(tx, acc('1679014023'), rules).category, 'Restaurace a kávičky');
});

test('amount_max_abs: SHELL −1500 Kč (nad 200) → AB mapping Doprava → Auto Moto - PHM', () => {
  const tx = { counterparty_account: 'EXT', ab_category: 'Doprava', description: 'SHELL 8100', note: '', amount: -1500 };
  assert.equal(applyRules(tx, acc('1679014023'), rules).category, 'Auto Moto - PHM');
});

test('amount_max_abs: hraniční MOL −200 Kč přesně → spadne pod prah (≤)', () => {
  const tx = { counterparty_account: 'EXT', ab_category: 'Doprava', description: 'MOL 658', note: '', amount: -200 };
  assert.equal(applyRules(tx, acc('1679014023'), rules).category, 'Restaurace a kávičky');
});

test('L3 textové pravidlo matchne podle place i při prázdném description', () => {
  const rules = {
    ownAccountNumbers: [], internalTransferCategory: 'Převody',
    textOverrides: [{ pattern: 'HAMR', category: 'Restaurace' }],
    accountRules: {}, abCategoryMap: {}, fallbackCategory: 'Ostatní',
  };
  const tx = { description: '', note: '', place: 'HAMR - BRANIK,RESTAURA, PRAHA 4', amount: -482, counterparty_account: null };
  assert.equal(applyRules(tx, null, rules).category, 'Restaurace');
});

test('L3 textové pravidlo se subcategory_id → vrátí subkategorii', () => {
  const r = { ...rules, textOverrides: [{ pattern: 'OPENAI', category: 'Licence', subcategory_id: 42 }] };
  const out = applyRules({ description: 'OPENAI', amount: -500 }, acc('9999'), r);
  assert.equal(out.category, 'Licence');
  assert.equal(out.subcategory_id, 42);
});

test('pravidlo bez subcategory → subcategory_id null', () => {
  const out = applyRules({ description: 'NĚCO', amount: -100 }, acc('9999'), rules);
  assert.equal(out.subcategory_id, null);
});
