'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildExternalId } = require('./externalId');

test('buildExternalId: ref + account number → ref-account', () => {
  assert.equal(buildExternalId('156476455902', '1679014138'), '156476455902-1679014138');
});

test('buildExternalId: prázdný/NULL ref → null', () => {
  assert.equal(buildExternalId(null, '1679014138'), null);
  assert.equal(buildExternalId('', '1679014138'), null);
  assert.equal(buildExternalId(undefined, '1679014138'), null);
});

test('buildExternalId: chybějící account number → ref beze suffixu', () => {
  // když účet nemá číslo, ponech aspoň ref (lepší než ztratit identitu)
  assert.equal(buildExternalId('156476455902', null), '156476455902');
  assert.equal(buildExternalId('156476455902', ''), '156476455902');
});
