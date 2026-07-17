// Skutečný součet fixních plateb: jen definované položky, a jen když proběhly
// (tx_count > 0), skutečnou částkou. Auto account-řádky už API nevrací.
export function fixedActualTotal(fixedExpenses) {
  return (fixedExpenses || []).reduce(
    (s, f) => s + (f.tx_count > 0 ? (f.actual || 0) : 0), 0
  );
}

// „Na spořicí" = přebytek za období = příjmy minus všechny výdaje (fixní, dotace na
// nepravidelné, měsíční, drahé věci). Kolik by mělo jít na spoření. Skutečné pohyby
// na spořicím účtu se NEpočítají — Schůzka je plánovací, pohyby jsou v Transakcích.
export function surplusToSavings({ totalIncome, totalFixed, variablePoolFunded, totalType1, totalType3 }) {
  return totalIncome - totalFixed - variablePoolFunded - totalType1 - totalType3;
}

// Jediná pravda pro plánovaný přebytek Schůzky. Skládá mezisoučty z API odpovědí
// (income, fixed-expenses, budgets typ 1, stats.by_category typ 3, variable_pool_funded)
// a vrátí je i s výsledným přebytkem. Používá Schůzka (ReportPage) i stránka
// Spořicí účet (SavingsPage) — aby „plán" na obou seděl na stejné číslo.
// Vstup `budgetsType1` musí být budgets už přefiltrované na typ 1 (jako v ReportPage).
export function computeMeetingSurplus({
  incomeSources = [],
  fixedExpenses = [],
  budgetsType1 = [],
  byCategory = [],
  variablePoolFunded = 0,
} = {}) {
  // Striktní whitelist: do bilance vstupují jen ručně aliasované zdroje (id != null).
  const totalIncome = incomeSources
    .filter(s => s.id != null)
    .reduce((s, i) => s + (i.actual || 0), 0);
  const totalFixed = fixedActualTotal(fixedExpenses);
  const totalType1 = budgetsType1.reduce((s, b) => s + (b.spent || 0), 0);
  const totalType3 = byCategory
    .filter(c => c.type === 3 && c.spent > 0)
    .reduce((s, c) => s + c.spent, 0);
  const surplus = surplusToSavings({ totalIncome, totalFixed, variablePoolFunded, totalType1, totalType3 });
  return { totalIncome, totalFixed, totalType1, totalType3, variablePoolFunded, surplus };
}
