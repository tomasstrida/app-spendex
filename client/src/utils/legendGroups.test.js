import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupSeriesForLegend } from './legendGroups.js';

const s = (category_id, name, type, limits = null) => ({ category_id, name, type, limits });

test('sekce podle typu, měsíční první, uvnitř abecedně', () => {
  const groups = groupSeriesForLegend([
    s(1, 'Zábava', 1, [4500]),
    s(2, 'Licence', 2),
    s(3, 'Auto Moto - PHM', 1, [8500]),
    s(4, 'Drahé věci', 3),
    s(5, 'Beauty', 1, [3000]),
  ]);
  assert.deepEqual(groups.map(g => g.key), ['monthly', 'annual', 'fund']);
  assert.deepEqual(groups[0].items.map(i => i.name), ['Auto Moto - PHM', 'Beauty', 'Zábava']);
  assert.deepEqual(groups[1].items.map(i => i.name), ['Licence']);
});

test('kategorie typu 1 BEZ rozpočtu patří do Ostatní, ne mezi měsíční', () => {
  const groups = groupSeriesForLegend([
    s(1, 'Příjmy', 1),
    s(2, 'Jídlo', 1, [20000]),
    s(3, 'Pravidelné platby', 1),
  ]);
  assert.deepEqual(groups.map(g => g.key), ['monthly', 'other']);
  assert.deepEqual(groups[0].items.map(i => i.name), ['Jídlo']);
  assert.deepEqual(groups[1].items.map(i => i.name), ['Pravidelné platby', 'Příjmy']);
});

test('prázdné sekce se nevrací a řazení respektuje českou abecedu', () => {
  const groups = groupSeriesForLegend([
    s(1, 'Železo', 2), s(2, 'Auto', 2), s(3, 'Chleba', 2), s(4, 'Cukr', 2),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].items.map(i => i.name), ['Auto', 'Cukr', 'Chleba', 'Železo']);
});

test('neznámý typ spadne do Ostatní', () => {
  const groups = groupSeriesForLegend([s(1, 'Divné', 9)]);
  assert.deepEqual(groups.map(g => g.key), ['other']);
});

test('prázdný vstup vrátí prázdné pole', () => {
  assert.deepEqual(groupSeriesForLegend([]), []);
  assert.deepEqual(groupSeriesForLegend(null), []);
});
