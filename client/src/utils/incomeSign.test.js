import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldFlipSign, flipSeriesSign } from './incomeSign.js';

test('samé záporné hodnoty (příjmová kategorie) → otočit', () => {
  assert.equal(shouldFlipSign([{ values: [-100, -200, -50] }]), true);
});

test('smíšený výběr (příjmy + výdaje) → neotáčet', () => {
  assert.equal(shouldFlipSign([{ values: [-100, -200] }, { values: [300, 400] }]), false);
});

test('jedna série se zápornými i kladnými hodnotami → neotáčet', () => {
  assert.equal(shouldFlipSign([{ values: [-100, 300] }]), false);
});

test('samé nuly → neotáčet (není co obracet)', () => {
  assert.equal(shouldFlipSign([{ values: [0, 0, 0] }]), false);
});

test('záporné hodnoty s nulami → otočit (období bez pohybu nevadí)', () => {
  assert.equal(shouldFlipSign([{ values: [0, -500, 0] }]), true);
});

test('prázdný výběr → neotáčet', () => {
  assert.equal(shouldFlipSign([]), false);
});

test('flipSeriesSign otočí hodnoty a nechá limity i ostatní pole', () => {
  const input = [{ category_id: 9, name: 'Příjmy', values: [-100, -200], total: -300, limits: null }];
  const out = flipSeriesSign(input);
  assert.deepEqual(out[0].values, [100, 200]);
  assert.equal(out[0].name, 'Příjmy');
  assert.equal(out[0].category_id, 9);
  assert.equal(out[0].limits, null);
});

// `total` je server-počítaný součet — kdyby se neotočil, „Celkem za období"
// zůstane záporné, i když graf i průměr ukazují kladná čísla.
test('flipSeriesSign otočí i server-počítaný total', () => {
  const out = flipSeriesSign([{ values: [-100, -200], total: -300 }]);
  assert.equal(out[0].total, 300);
});

test('flipSeriesSign zvládne sérii bez totalu', () => {
  const out = flipSeriesSign([{ values: [-100] }]);
  assert.equal(out[0].total, undefined);
});

test('flipSeriesSign nechá limity beze změny (v rozpočtech jsou kladné)', () => {
  const out = flipSeriesSign([{ values: [-100], limits: [5000] }]);
  assert.deepEqual(out[0].limits, [5000]);
});

test('flipSeriesSign nevytvoří zápornou nulu', () => {
  const out = flipSeriesSign([{ values: [0, -100] }]);
  assert.ok(Object.is(out[0].values[0], 0), 'nula musí zůstat kladná nula');
});
