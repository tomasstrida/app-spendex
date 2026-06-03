'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldSchedule } = require('./scheduler');

test('shouldSchedule: false když chybí povinné R2 ENV', () => {
  assert.equal(shouldSchedule({}), false);
  assert.equal(shouldSchedule({ R2_ACCOUNT_ID: 'a' }), false);
});

test('shouldSchedule: true když jsou všechny povinné R2 ENV', () => {
  assert.equal(shouldSchedule({
    R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd',
  }), true);
});
