'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentStatus, savingsNet, reserveBalance } = require('./recurring');

test('paymentStatus: žádná transakce → missing', () => {
  assert.equal(paymentStatus(36000, 40000, 0, 0), 'missing');
});

test('paymentStatus: uvnitř rozmezí → ok', () => {
  assert.equal(paymentStatus(36000, 40000, 38000, 1), 'ok');
});

test('paymentStatus: přesně na dolní hranici → ok', () => {
  assert.equal(paymentStatus(36000, 40000, 36000, 1), 'ok');
});

test('paymentStatus: přesně na horní hranici → ok', () => {
  assert.equal(paymentStatus(36000, 40000, 40000, 1), 'ok');
});

test('paymentStatus: pod rozmezím → mismatch', () => {
  assert.equal(paymentStatus(36000, 40000, 35999, 1), 'mismatch');
});

test('paymentStatus: nad rozmezím → mismatch', () => {
  assert.equal(paymentStatus(36000, 40000, 40001, 1), 'mismatch');
});

test('paymentStatus: rozmezí nedefinováno → null', () => {
  assert.equal(paymentStatus(null, null, 100, 1), null);
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


const { incomeStatus } = require('./recurring');

test('incomeStatus: žádná transakce → missing', () => {
  assert.equal(incomeStatus(140000, 0, 0), 'missing');
});

test('incomeStatus: přesně plán → ok', () => {
  assert.equal(incomeStatus(140000, 140000, 1), 'ok');
});

test('incomeStatus: víc než plán → ok (přebytek je v pohodě)', () => {
  assert.equal(incomeStatus(140000, 190000, 1), 'ok');
});

test('incomeStatus: pod plán, ale přišlo → ok (bez tolerance)', () => {
  assert.equal(incomeStatus(140000, 133400, 1), 'ok');
});

test('incomeStatus: výrazně pod plán, ale přišlo → ok (žádný mismatch)', () => {
  assert.equal(incomeStatus(140000, 50000, 1), 'ok');
});

test('incomeStatus: plán ≤ 0 → null', () => {
  assert.equal(incomeStatus(0, 100, 1), null);
});
