'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentStatus, savingsNet, reserveBalance, MATCH_TOLERANCE_PCT } = require('./recurring');

test('paymentStatus: žádná shoda → missing', () => {
  assert.equal(paymentStatus(38126, 0, 0), 'missing');
});

test('paymentStatus: přesná shoda → ok', () => {
  assert.equal(paymentStatus(38126, 38126, 1), 'ok');
});

test('paymentStatus: do 5 % → ok (hranice přesně 5 %)', () => {
  assert.equal(paymentStatus(1000, 1050, 1), 'ok');   // 5.0 %
});

test('paymentStatus: těsně nad 5 % → mismatch', () => {
  assert.equal(paymentStatus(1000, 1051, 1), 'mismatch'); // 5.1 %
});

test('paymentStatus: očekávaná ≤ 0 → null (žádný stav)', () => {
  assert.equal(paymentStatus(0, 100, 1), null);
});

test('savingsNet: vklady − výběry', () => {
  assert.equal(savingsNet({ deposits: 30000, withdrawals: 5800 }), 24200);
});

test('reserveBalance: vklady − nájem − PRE − vratky', () => {
  assert.equal(
    reserveBalance({ envelopeDeposits: 135000, najemSum: 114378, preSum: 10500, envelopeReturns: 37254 }),
    -27132
  );
});

test('MATCH_TOLERANCE_PCT je 5', () => {
  assert.equal(MATCH_TOLERANCE_PCT, 5);
});
