'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { daysApart, matchesReceipt, pickMatch } = require('./appleMatch');

const INVOICE = { receipt_date: '2026-06-30', total_amount: 269, card_last4: '4225', is_refund: false };
const REFUND  = { receipt_date: '2026-07-05', total_amount: 99,  card_last4: null,   is_refund: true };

test('daysApart pocita rozdil dnu', () => {
  assert.equal(daysApart('2026-06-30', '2026-06-30'), 0);
  assert.equal(daysApart('2026-06-30', '2026-07-03'), 3);
  assert.equal(daysApart('2026-07-03', '2026-06-30'), 3);
});

test('faktura sedne na odchozi platbu stejne castky a data', () => {
  assert.equal(matchesReceipt({ amount: -269, date: '2026-06-30', card_last4: '4225' }, INVOICE), true);
});

test('faktura NEsedne na prichozi platbu (dobropis nema byt nakup)', () => {
  assert.equal(matchesReceipt({ amount: 269, date: '2026-06-30', card_last4: '4225' }, INVOICE), false);
});

test('dobropis sedne jen na prichozi platbu', () => {
  assert.equal(matchesReceipt({ amount: 99, date: '2026-07-05', card_last4: null }, REFUND), true);
  assert.equal(matchesReceipt({ amount: -99, date: '2026-07-05', card_last4: null }, REFUND), false);
});

test('rozdilna karta kandidata vyradi, chybejici karta se ignoruje', () => {
  assert.equal(matchesReceipt({ amount: -269, date: '2026-06-30', card_last4: '1760' }, INVOICE), false);
  assert.equal(matchesReceipt({ amount: -269, date: '2026-06-30', card_last4: null }, INVOICE), true);
  assert.equal(matchesReceipt({ amount: -269, date: '2026-06-30', card_last4: '1760' }, REFUND), false,
    'refund ma jine znamenko, karta uz nerozhoduje');
});

test('okno +-3 dny vcetne hranice', () => {
  assert.equal(matchesReceipt({ amount: -269, date: '2026-07-03', card_last4: null }, INVOICE), true);
  assert.equal(matchesReceipt({ amount: -269, date: '2026-07-04', card_last4: null }, INVOICE), false);
  assert.equal(matchesReceipt({ amount: -269, date: '2026-06-27', card_last4: null }, INVOICE), true);
});

test('tolerance castky 0,5 Kc', () => {
  assert.equal(matchesReceipt({ amount: -269.4, date: '2026-06-30', card_last4: null }, INVOICE), true);
  assert.equal(matchesReceipt({ amount: -270.2, date: '2026-06-30', card_last4: null }, INVOICE), false);
});

test('pickMatch: jeden kandidat = matched', () => {
  const r = pickMatch([{ id: 7, amount: -269, date: '2026-06-30', card_last4: '4225' }], INVOICE);
  assert.equal(r.status, 'matched');
  assert.equal(r.transaction.id, 7);
});

test('pickMatch: zadny kandidat = pending', () => {
  const r = pickMatch([{ id: 7, amount: -100, date: '2026-06-30', card_last4: null }], INVOICE);
  assert.equal(r.status, 'pending');
  assert.equal(r.transaction, null);
});

test('pickMatch: vic kandidatu = ambiguous', () => {
  const r = pickMatch([
    { id: 7, amount: -269, date: '2026-06-30', card_last4: null },
    { id: 8, amount: -269, date: '2026-07-01', card_last4: null },
  ], INVOICE);
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.transaction, null);
});

test('pickMatch: karta rozhodne mezi dvema jinak stejnymi kandidaty', () => {
  const r = pickMatch([
    { id: 7, amount: -269, date: '2026-06-30', card_last4: '1760' },
    { id: 8, amount: -269, date: '2026-07-01', card_last4: '4225' },
  ], INVOICE);
  assert.equal(r.status, 'matched');
  assert.equal(r.transaction.id, 8);
});

test('faktura bez data nebo bez castky se neparuje', () => {
  assert.equal(pickMatch([{ id: 7, amount: -269, date: '2026-06-30' }],
    { receipt_date: null, total_amount: 269, is_refund: false }).status, 'pending');
  assert.equal(pickMatch([{ id: 7, amount: -269, date: '2026-06-30' }],
    { receipt_date: '2026-06-30', total_amount: null, is_refund: false }).status, 'pending');
});
