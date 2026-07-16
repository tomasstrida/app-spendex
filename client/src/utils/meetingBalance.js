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
