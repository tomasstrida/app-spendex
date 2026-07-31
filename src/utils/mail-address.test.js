'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAddress, parseAddressList } = require('./mail-address');

test('adresa v uhlovych zavorkach s jmenem se vytahne', () => {
  assert.equal(extractAddress('Jméno <a@b.cz>'), 'a@b.cz');
});

test('hola adresa bez zavorek se vezme cela', () => {
  assert.equal(extractAddress('a@b.cz'), 'a@b.cz');
});

test('adresa schovana v display name se NESMI vratit jako adresa (C1 dira)', () => {
  assert.equal(
    extractAddress('"tomas@icloud.com" <utocnik@evil.example>'),
    'utocnik@evil.example',
  );
});

test('velikost pismen je normalizovana na lowercase', () => {
  assert.equal(extractAddress('Jméno <A@B.CZ>'), 'a@b.cz');
});

test('prazdny vstup vraci prazdny retezec', () => {
  assert.equal(extractAddress(''), '');
  assert.equal(extractAddress(null), '');
  assert.equal(extractAddress(undefined), '');
});

test('chybny vstup (cislo, objekt) se prevede na string a nespadne', () => {
  assert.equal(extractAddress(42), '42');
  assert.doesNotThrow(() => extractAddress({}));
});

test('okoli s mezerami se orizne', () => {
  assert.equal(extractAddress('  Jméno   <  a@b.cz  >  '), 'a@b.cz');
});

test('parseAddressList rozdeli seznam oddeleny carkou a normalizuje', () => {
  assert.deepEqual(parseAddressList('a@b.cz, C@D.cz'), ['a@b.cz', 'c@d.cz']);
  assert.deepEqual(parseAddressList('  jedna@x.cz  '), ['jedna@x.cz']);
  assert.deepEqual(parseAddressList('a@b.cz,,  ,c@d.cz'), ['a@b.cz', 'c@d.cz'], 'prazdne polozky vypadnou');
});

test('parseAddressList zvlada prazdny a chybny vstup', () => {
  assert.deepEqual(parseAddressList(''), []);
  assert.deepEqual(parseAddressList(undefined), []);
  assert.deepEqual(parseAddressList(null), []);
  assert.deepEqual(parseAddressList('   '), []);
});

test('parseAddressList prijme i adresy v zavorkach', () => {
  assert.deepEqual(parseAddressList('Jmeno <a@b.cz>, Druhy <c@d.cz>'), ['a@b.cz', 'c@d.cz']);
});
