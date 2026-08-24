// Graf Vývoje výdajů počítá „utraceno" jako SUM(-amount), takže příjmová
// kategorie (kladné částky) vychází v záporných číslech a čára jde pod nulu.
// Když jsou ve výběru JEN takové série, otočíme znaménko a čte se to jako
// příjem, ne jako záporný výdaj.
//
// Kritérium je datové, ne podle názvu kategorie: přejmenování „Příjmů" by
// jméno rozbilo a druhá příjmová kategorie by se musela dopisovat ručně.
// Smíšený výběr se nikdy neotáčí — stačí jedna výdajová série a graf zůstává
// v původní orientaci, aby šly kategorie porovnávat mezi sebou.

export function shouldFlipSign(series) {
  if (!series || series.length === 0) return false;
  const values = series.flatMap(s => s.values || []);
  return values.every(v => v <= 0) && values.some(v => v < 0);
}

// Odvozená kopie pro zobrazení. Otáčí `values` I server-počítaný `total`
// (z něj se skládá „Celkem za období"). Limity zůstávají — v `budgets` jsou
// uložené kladně, takže na otočeném grafu sedí bez úprav.
// `v === 0 ? 0 : -v` brání vzniku -0, které by se vypsalo jako „−0 Kč".
const neg = (v) => (v === 0 ? 0 : -v);

export function flipSeriesSign(series) {
  return (series || []).map(s => ({
    ...s,
    values: (s.values || []).map(neg),
    ...(typeof s.total === 'number' ? { total: neg(s.total) } : {}),
  }));
}
