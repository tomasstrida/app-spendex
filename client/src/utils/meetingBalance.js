// Skutečný součet fixních plateb: account-řádky nesou skutečnou sumu z transakcí,
// manuální položky se počítají jen když proběhly (tx_count > 0), skutečnou částkou.
export function fixedActualTotal(fixedExpenses) {
  return (fixedExpenses || []).reduce((s, f) => {
    if (f.source === 'account') return s + (f.amount || 0);
    return s + (f.tx_count > 0 ? (f.actual || 0) : 0);
  }, 0);
}

// Aritmetická měsíční bilance: kolik zbylo na běžném po všech pohybech.
// Interní převody (dotace na Nepravidelné, spoření) jsou vědomě mínus řádky.
export function leftoverOnMain({ totalIncome, totalFixed, variablePoolFunded, totalType1, totalType3, savingsNet }) {
  return totalIncome - totalFixed - variablePoolFunded - totalType1 - totalType3 - savingsNet;
}
