import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceScale, seriesColor, FALLBACK_COLORS } from './chartScale.js';

test('niceScale: kulaté kroky a horní tick nad maximem', () => {
  const s = niceScale(0, 8300);
  assert.equal(s.min, 0);
  assert.ok(s.max >= 8300, 'horní hranice musí pokrýt maximum');
  assert.deepEqual(s.ticks, [0, 2000, 4000, 6000, 8000, 10000]);
});

test('niceScale: nula je vždy na ose', () => {
  const s = niceScale(1200, 4800);
  assert.equal(s.min, 0);
  assert.ok(s.ticks.includes(0));
});

test('niceScale: záporná hodnota (vratka) rozšíří osu pod nulu', () => {
  const s = niceScale(-1500, 4000);
  assert.ok(s.min <= -1500);
  assert.ok(s.ticks.includes(0), 'nulová linka musí zůstat tickem');
});

test('niceScale: samé nuly nespadnou na dělení nulou', () => {
  const s = niceScale(0, 0);
  assert.ok(s.max > s.min);
  assert.ok(s.ticks.length >= 2);
});

test('seriesColor: barva kategorie má přednost', () => {
  assert.equal(seriesColor({ category_id: 3, color: '#ff0000' }), '#ff0000');
});

test('seriesColor: bez barvy padá na stabilní fallback podle id, ne podle pořadí', () => {
  const a = seriesColor({ category_id: 7, color: null });
  const b = seriesColor({ category_id: 7, color: '' });
  assert.equal(a, b);
  assert.ok(FALLBACK_COLORS.includes(a));
});

test('assignColors: duplicitní barvy kategorií se rozliší, přiřazení nezávisí na pořadí v poli', async () => {
  const { assignColors } = await import('./chartScale.js');
  const a = assignColors([
    { category_id: 2, color: '#6366f1' },
    { category_id: 9, color: '#6366f1' },
    { category_id: 5, color: '#00ff00' },
  ]);
  assert.equal(a.get(2), '#6366f1', 'první podle category_id si barvu nechá');
  assert.notEqual(a.get(9), '#6366f1', 'druhá stejná barva se nahradí');
  assert.equal(a.get(5), '#00ff00');

  // stejná data v jiném pořadí → stejné přiřazení (barva patří entitě, ne pořadí)
  const b = assignColors([
    { category_id: 5, color: '#00ff00' },
    { category_id: 9, color: '#6366f1' },
    { category_id: 2, color: '#6366f1' },
  ]);
  assert.equal(b.get(9), a.get(9));
  assert.equal(b.get(2), a.get(2));
});

test('signPrefix: záporná částka dostane minus, kladná a nula ne', async () => {
  const { signPrefix } = await import('./chartScale.js');
  assert.equal(signPrefix(-1), '−');
  assert.equal(signPrefix(0), '');
  assert.equal(signPrefix(10), '');
});

test('periodAverage: dělí počtem VŠECH období včetně nulových', async () => {
  const { periodAverage } = await import('./chartScale.js');
  assert.equal(periodAverage([0, 0, 25195, 8895]), 8522.5);
  assert.equal(periodAverage([]), 0);
});

test('summarizeLimit: konstantní limit, měnící se limit, žádný limit', async () => {
  const { summarizeLimit } = await import('./chartScale.js');
  assert.deepEqual(summarizeLimit([8000, 8000, 8000]), { min: 8000, max: 8000, varies: false });
  assert.deepEqual(summarizeLimit([8000, 12000, 8000]), { min: 8000, max: 12000, varies: true });
  assert.equal(summarizeLimit([null, null]), null);
  assert.equal(summarizeLimit(null), null);
});

test('summarizeLimit: období bez limitu se do rozpětí nepočítá', async () => {
  const { summarizeLimit } = await import('./chartScale.js');
  assert.deepEqual(summarizeLimit([null, 3000]), { min: 3000, max: 3000, varies: false });
});
