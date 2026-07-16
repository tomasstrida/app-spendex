'use strict';
const { getPeriodDates, getUserBillingDay } = require('./period');
const { paymentStatus } = require('./recurring');
const { normCounterparty } = require('./income');

/**
 * Manuální fixní položky + sumované odchozí transakce z účtů role='fixed'.
 * Account-řádky, jejichž description odpovídá nějakému ručnímu match_pattern
 * nebo číslu účtu příjemce, se vynechají (jinak by se nájem/energie počítaly dvakrát).
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
  const { start, end } = getPeriodDates(billingDay, period);

  // Posun periodKey "YYYY-MM" o delta měsíců (bez závislosti na frontend addPeriods).
  const shiftPeriod = (p, delta) => {
    const [y, m] = p.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const matchByDesc = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) AS actual, COUNT(*) AS tx_count
    FROM transactions
    WHERE user_id = ? AND amount < 0 AND date >= ? AND date <= ?
      AND description LIKE '%' || ? || '%'
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
      m = matchByDesc.get(userId, windowStart, windowEnd, row.match_pattern);
    }
    return {
      ...row,
      actual: m.actual,
      tx_count: m.tx_count,
      status: paymentStatus(row.amount_min, row.amount_max, m.actual, m.tx_count),
    };
  });

  // Account-řádky (role='fixed') vynech, pokud odpovídají ručnímu matcheru
  // (jinak by se platba počítala dvakrát). Match přes description-pattern
  // (case-insensitive substring) i normalizované číslo účtu příjemce.
  const patterns = active.map(m => m.match_pattern).filter(Boolean).map(p => p.toLowerCase());
  const cpTargets = active.map(m => normCounterparty(m.match_counterparty_account)).filter(Boolean);
  const cpTargetSet = new Set(cpTargets);

  const fixedAccountTx = db.prepare(`
    SELECT t.description, t.amount, t.counterparty_account,
           a.name AS account_name, a.id AS account_id
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.user_id = ?
      AND a.role = 'fixed'
      AND t.amount < 0
      AND t.date >= ? AND t.date <= ?
  `).all(userId, start, end);

  const grouped = new Map();  // key = account_id + '\x00' + description
  for (const t of fixedAccountTx) {
    const desc = t.description || '';
    const patternHit = patterns.some(p => desc.toLowerCase().includes(p));
    const cpHit = t.counterparty_account && cpTargetSet.has(normCounterparty(t.counterparty_account));
    if (patternHit || cpHit) continue;
    const key = t.account_id + '\x00' + desc;
    const g = grouped.get(key) || {
      id: null, name: desc, amount: 0, note: null, sort_order: 0,
      source: 'account', account_name: t.account_name, account_id: t.account_id,
    };
    g.amount += Math.abs(t.amount);
    grouped.set(key, g);
  }
  const fromAccounts = [...grouped.values()].sort(
    (a, b) => (a.account_name || '').localeCompare(b.account_name || '') || b.amount - a.amount
  );

  return [...manualWithStatus, ...fromAccounts];
}

module.exports = { fixedExpensesForPeriod };
