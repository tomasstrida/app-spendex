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
  //
  // Interní převody (kategorie type=4) textová větev standardně vynechává: platba
  // identifikovaná POUZE textem je skutečný výdaj, kdežto přesun mezi vlastními
  // účty se identifikuje číslem účtu. Bez toho sbíral řádek „T-Mobile" i převod
  // s poznámkou „Dotace na T-mobile".
  // Výjimka `include_transfers = 1`: řádek sám JE převodem (účelová dotace). Na
  // jeden vlastní účet chodí víc dotací s různým účelem, takže je rozliší jen
  // text v poznámce — číslo účtu by je sečetlo dohromady.
  // Kategorie se `system_role='fund_topup'` (Nestandardní dobití ročního budgetu)
  // je vyloučená VŽDY, i u řádků s include_transfers=1 — ta transakce je vlastním
  // řádkem bilance, takže by se přes dotaci počítala podruhé.
  const matchByDesc = db.prepare(`
    SELECT t.id, t.amount
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = ? AND t.amount < 0 AND t.date >= ? AND t.date <= ?
      AND (t.description LIKE '%' || :pattern || '%'
        OR t.note LIKE '%' || :pattern || '%'
        OR t.place LIKE '%' || :pattern || '%')
      AND COALESCE(c.system_role, '') != 'fund_topup'
      AND (:includeTransfers = 1 OR COALESCE(c.type, 0) != 4)
  `);
  // Číslo účtu se normalizuje v JS (SQLite neumí „číslice před /" čistě), proto
  // načteme odchozí transakce s protiúčtem v okně a porovnáme přes normCounterparty.
  const outgoingWithCp = db.prepare(`
    SELECT t.id, t.amount, t.counterparty_account
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = ? AND t.amount < 0 AND t.date >= ? AND t.date <= ?
      AND t.counterparty_account IS NOT NULL
      AND COALESCE(c.system_role, '') != 'fund_topup'
  `);

  const windowEnd = end;  // konec aktuálního období
  const manualWithStatus = active.map(row => {
    const hasMatcher = row.match_counterparty_account || row.match_pattern;
    if (!hasMatcher) return row;  // po validaci nenastane; bezpečný fallback
    const freq = row.frequency_months > 0 ? row.frequency_months : 1;
    const windowStart = getPeriodDates(billingDay, shiftPeriod(period, -(freq - 1))).start;
    // Obě větve se SČÍTAJÍ (dřív číslo účtu pattern přebíjelo). Důvod: cíl platby
    // nebývá konzistentní — tentýž měsíční výdaj přijde jednou jako převod
    // s protiúčtem, jindy jako platba kartou, která protiúčet vůbec nemá.
    // Dedup přes tx.id, ať se transakce sedící na obojí nepočítá dvakrát.
    const hits = new Map();
    if (row.match_counterparty_account) {
      const target = normCounterparty(row.match_counterparty_account);
      for (const t of outgoingWithCp.all(userId, windowStart, windowEnd)) {
        if (target && normCounterparty(t.counterparty_account) === target) hits.set(t.id, t.amount);
      }
    }
    if (row.match_pattern) {
      const params = { pattern: row.match_pattern, includeTransfers: row.include_transfers ? 1 : 0 };
      for (const t of matchByDesc.all(userId, windowStart, windowEnd, params)) {
        hits.set(t.id, t.amount);
      }
    }
    const actual = [...hits.values()].reduce((sum, a) => sum + Math.abs(a), 0);
    const tx_count = hits.size;
    return {
      ...row,
      actual,
      tx_count,
      // ID napárovaných transakcí — příslušnost k této platbě počítá JS (dvě
      // větve matcheru + dedup), filtrem se vyjádřit nedá. Schůzka je posílá do
      // prokliku jako `tx_ids`, aby seznam ukázal přesně to, z čeho je součet.
      tx_ids: [...hits.keys()],
      status: paymentStatus(row.amount_min, row.amount_max, actual, tx_count),
    };
  });

  return manualWithStatus;
}

module.exports = { fixedExpensesForPeriod };
