'use strict';

/**
 * Dopočet zůstatků po obdobích od jediné kotvy (posledního reálného snapshotu).
 *
 * Indexy jsou ABSOLUTNÍ `periodIndex`, ne pozice v zobrazeném poli — kotva může
 * ležet mimo zobrazený rozsah a řetězení se k ní musí dopočítat.
 *
 * Směr: dozadu se pohyby NÁSLEDUJÍCÍHO období odečítají, dopředu se pohyby
 * daného období přičítají. Zůstatek je vždy chápaný ke KONCI období.
 *
 * `netAt(absIdx)` dodává volající — spoření počítá pohyby přes dedup noh převodu,
 * fond prostým součtem transakcí na účtu. Aritmetika je pro oba stejná.
 */
function chainBalances({ anchorIndex, anchorBalance, fromIndex, toIndex, netAt }) {
  const balances = new Map([[anchorIndex, anchorBalance]]);
  for (let a = anchorIndex - 1; a >= fromIndex; a--) balances.set(a, balances.get(a + 1) - netAt(a + 1));
  for (let a = anchorIndex + 1; a <= toIndex; a++) balances.set(a, balances.get(a - 1) + netAt(a));
  return balances;
}

module.exports = { chainBalances };
