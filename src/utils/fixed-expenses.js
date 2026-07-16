'use strict';
const { getPeriodDates, getUserBillingDay } = require('./period');
const { paymentStatus } = require('./recurring');
const { normCounterparty } = require('./income');

/**
 * Vrací JEN ručně definované fixní platby (žádné auto-řádky z účtů role='fixed' —
 * catch-all agregace odstraněna 2026-07-17 na přání uživatele: ve Schůzce se mají
 * ukazovat výhradně platby zadefinované v seznamu).
 *
 * Číslo účtu příjemce se páruje přes `normCounterparty` (číslice před `/`), exact
 * shodou — stejně jako income_sources, ne jako raw prefix (aby delší číslo se
 * stejným začátkem nedávalo falešnou shodu a aby kód banky za `/` nevadil).
 */
function fixedExpensesForPeriod(db, userId, period) {
  const manual = db.prepare(
    "SELECT *, 'manual' as source FROM fixed_expenses WHERE user_id = ? ORDER BY sort_order ASC, id ASC"
  ).all(userId);

  if (!period) return manual;

  // Okno platnosti: řádek platí v období, když period ∈ [valid_from, valid_to]
  // (NULL = bez omezení; stringové porovnání periodKey je lexikograficky korektní).
  const active = manual.filter(r =>
    (!r.valid_from || r.valid_from <= period) && (!r.valid_to || r.valid_to >= period)
  );

  const billingDay = getUserBillingDay(db, userId);
  const { end } = getPeriodDates(billingDay, period);

  // Posun periodKey "YYYY-MM" o delta měsíců (bez závislosti na frontend addPeriods).
  const shiftPeriod = (p, delta) => {
    const [y, m] = p.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  // Pattern se hledá v description + note + place — stejně jako L3 textová
  // kategorizace (apply-rules). Např. splátka půjčky má description jen
  // „Air Bank" a rozlišení nese poznámka; karetní platby mají obchodníka v place.
  const matchByDesc = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) AS actual, COUNT(*) AS tx_count
    FROM transactions
    WHERE user_id = ? AND amount < 0 AND date >= ? AND date <= ?
      AND (description LIKE '%' || :pattern || '%'
        OR note LIKE '%' || :pattern || '%'
        OR place LIKE '%' || :pattern || '%')
  `);
  // Číslo účtu se normalizuje v JS (SQLite neumí „číslice před /" čistě), proto
  // načteme odchozí transakce s protiúčtem v okně a porovnáme přes normCounterparty.
  const outgoingWithCp = db.prepare(`
    SELECT amount, counterparty_account
    FROM transactions
    WHERE user_id = ? AND amount < 0 AND date >= ? AND date <= ?
      AND counterparty_account IS NOT NULL
  `);

  const windowEnd = end;  // konec aktuálního období
  const manualWithStatus = active.map(row => {
    const hasMatcher = row.match_counterparty_account || row.match_pattern;
    if (!hasMatcher) return row;  // po validaci nenastane; bezpečný fallback
    const freq = row.frequency_months > 0 ? row.frequency_months : 1;
    const windowStart = getPeriodDates(billingDay, shiftPeriod(period, -(freq - 1))).start;
    // Číslo účtu příjemce má přednost před textovým patternem.
    let m;
    if (row.match_counterparty_account) {
      const target = normCounterparty(row.match_counterparty_account);
      let actual = 0, tx_count = 0;
      for (const t of outgoingWithCp.all(userId, windowStart, windowEnd)) {
        if (target && normCounterparty(t.counterparty_account) === target) {
          actual += Math.abs(t.amount);
          tx_count += 1;
        }
      }
      m = { actual, tx_count };
    } else {
      m = matchByDesc.get(userId, windowStart, windowEnd, { pattern: row.match_pattern });
    }
    return {
      ...row,
      actual: m.actual,
      tx_count: m.tx_count,
      status: paymentStatus(row.amount_min, row.amount_max, m.actual, m.tx_count),
    };
  });

  return manualWithStatus;
}

module.exports = { fixedExpensesForPeriod };
