'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAccountNumberField } = require('./account-number');

test('parseAccountNumberField: kompletní čísla projdou (i s předčíslím a mezerami)', () => {
  assert.deepEqual(parseAccountNumberField('1000451009/3500'), { value: '1000451009/3500' });
  assert.deepEqual(parseAccountNumberField('51-1065424327/8060'), { value: '51-1065424327/8060' });
  assert.deepEqual(parseAccountNumberField(' 2111779001 / 5500 '), { value: '2111779001/5500' });
});

test('parseAccountNumberField: prázdný vstup = null (pole nevyplněno)', () => {
  assert.deepEqual(parseAccountNumberField(''), { value: null });
  assert.deepEqual(parseAccountNumberField('   '), { value: null });
  assert.deepEqual(parseAccountNumberField(null), { value: null });
  assert.deepEqual(parseAccountNumberField(undefined), { value: null });
});

test('parseAccountNumberField: nekompletní číslo (bez kódu banky) → error', () => {
  assert.ok(parseAccountNumberField('1679014999').error);
  assert.ok(parseAccountNumberField('51-1065424327').error);
});

test('parseAccountNumberField: nevalidní formát → error', () => {
  assert.ok(parseAccountNumberField('abc').error);
  assert.ok(parseAccountNumberField('123/12345').error);   // kód banky má 4 číslice
  assert.ok(parseAccountNumberField('1234567-89/0300').error); // předčíslí max 6 číslic
});
