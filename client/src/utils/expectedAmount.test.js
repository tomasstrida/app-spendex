import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatExpectedAmount } from './expectedAmount.js';

// cs-CZ používá nedělitelnou mezeru jako oddělovač tisíců i před měnou,
// stejně jako formatCurrency — v očekáváních proto musí být U+00A0.
const NB = '\u00a0';

test('pevná částka (min === max) → jedno číslo, ne rozmezí', () => {
  assert.equal(formatExpectedAmount(6000, 6000, 6000), `6${NB}000${NB}Kč`);
});

test('skutečné rozmezí → obě čísla s oddělovačem tisíců', () => {
  assert.equal(formatExpectedAmount(2500, 3000, 2590), `2${NB}500–3${NB}000${NB}Kč`);
});

test('chybějící rozmezí → padá zpět na plánovanou částku', () => {
  assert.equal(formatExpectedAmount(null, null, 445), `445${NB}Kč`);
  assert.equal(formatExpectedAmount(undefined, 3000, 445), `445${NB}Kč`);
  assert.equal(formatExpectedAmount(2500, null, 445), `445${NB}Kč`);
});

test('desetinná místa se zaokrouhlují stejně jako jinde v UI', () => {
  assert.equal(formatExpectedAmount(2579.9, 2579.9, 2590), `2${NB}580${NB}Kč`);
});

test('nula je platná částka, ne chybějící hodnota', () => {
  assert.equal(formatExpectedAmount(0, 0, 0), `0${NB}Kč`);
});
