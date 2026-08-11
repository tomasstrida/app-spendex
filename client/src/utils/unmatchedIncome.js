// Příchozí platby, které backend rozpoznal jako příjem, ale nepatří k žádnému
// definovanému zdroji (`id == null`, tzv. auto-only). Schůzka je do bilance
// vědomě nepouští — striktní whitelist — jenže bez upozornění mizí beze stopy
// a chybějící příjem není na stránce nijak poznat.
//
// Vrací souhrn pro varovný řádek: kolik jich je, za kolik a které transakce
// (pro proklik přes `tx_ids`, aby seznam odpovídal součtu).
//
// Počítají se jen platby s protiúčtem, tedy převody od někoho. Příchozí částky
// bez protiúčtu jsou karetní vratky a připsané úroky — refund se v kategorii
// vyruší proti původnímu výdaji, takže jako „chybějící příjem" hlásit nemá co
// a varování by v nich utonulo.

export function unmatchedIncome(sources) {
  const rows = (sources || []).filter(s =>
    s.id == null && (s.actual || 0) !== 0 && s.match_counterparty_account);
  return {
    count: rows.length,
    total: rows.reduce((sum, s) => sum + (s.actual || 0), 0),
    tx_ids: rows.flatMap(s => s.tx_ids || []),
  };
}

// Popisek varování — čeština skloňuje podle počtu (1 / 2–4 / 5+).
export function unmatchedLabel(count) {
  if (count === 1) return '1 nezařazená příchozí platba';
  if (count >= 2 && count <= 4) return `${count} nezařazené příchozí platby`;
  return `${count} nezařazených příchozích plateb`;
}
