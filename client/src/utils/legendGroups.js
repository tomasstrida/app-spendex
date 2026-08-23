// Rozdělení sérií grafu do sekcí legendy podle typu rozpočtu.
// Názvy sekcí odpovídají typům kategorií v Kategoriích (CategoriesPage).

// Pořadí sekcí = pořadí v tomhle poli, měsíční první. `match` se vyhodnocuje
// shora dolů, první shoda vyhrává (poslední sekce bere zbytek).
//
// POZOR na definici „měsíční": nestačí `type === 1`, protože 1 je výchozí
// hodnota sloupce v DB — má ji i „Příjmy" nebo „Pravidelné platby", což nejsou
// rozpočty. Rozhoduje proto existence měsíčního limitu (`limits` z API).
const SECTIONS = [
  { key: 'monthly', label: 'Měsíční', match: s => s.type === 1 && s.limits },
  { key: 'annual', label: 'Roční / sezónní', match: s => s.type === 2 },
  { key: 'fund', label: 'Drahé věci', match: s => s.type === 3 },
  { key: 'other', label: 'Ostatní', match: () => true },
];

/**
 * @param {Array} series série z /api/stats/budget-history
 * @returns {Array<{key:string,label:string,items:Array}>} neprázdné sekce v pevném pořadí
 */
export function groupSeriesForLegend(series) {
  const buckets = new Map(SECTIONS.map(s => [s.key, []]));
  for (const s of series || []) {
    const section = SECTIONS.find(sec => sec.match(s)) || SECTIONS[SECTIONS.length - 1];
    buckets.get(section.key).push(s);
  }
  return SECTIONS
    .map(sec => ({
      key: sec.key,
      label: sec.label,
      items: buckets.get(sec.key).sort((a, b) => a.name.localeCompare(b.name, 'cs')),
    }))
    .filter(g => g.items.length > 0);
}
