'use strict';
const { getPeriodDates, getUserBillingDay } = require('./period');
const { paymentStatus } = require('./recurring');

/**
 * Manuální fixní položky + sumované odchozí transakce z účtů role='fixed'.
 * Account-řádky, jejichž description odpovídá nějakému ručnímu match_pattern,
 * se vynechají (jinak by se nájem/energie počítaly dvakrát).
 */
function fixedExpensesForPeriod(db, userId, period) {
  const manual = db.prepare(
    "SELECT *, 'manual' as source FROM fixed_expenses WHERE user_id = ? ORDER BY sort_order ASC, id ASC"
  ).all(userId);

  if (!period) return manual;

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
  const matchByAccount = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) AS actual, COUNT(*) AS tx_count
    FROM transactions
    WHERE user_id = ? AND amount < 0 AND date >= ? AND date <= ?
      AND counterparty_account LIKE ? || '%'
  `);

  const windowEnd = end;  // konec aktuálního období
  const manualWithStatus = manual.map(row => {
    const hasMatcher = row.match_counterparty_account || row.match_pattern;
    if (!hasMatcher) return row;  // po validaci nenastane; bezpečný fallback
    const freq = row.frequency_months > 0 ? row.frequency_months : 1;
    const windowStart = getPeriodDates(billingDay, shiftPeriod(period, -(freq - 1))).start;
    // Číslo účtu příjemce má přednost před textovým patternem.
    const m = row.match_counterparty_account
      ? matchByAccount.get(userId, windowStart, windowEnd, row.match_counterparty_account)
      : matchByDesc.get(userId, windowStart, windowEnd, row.match_pattern);
    return {
      ...row,
      actual: m.actual,
      tx_count: m.tx_count,
      status: paymentStatus(row.amount_min, row.amount_max, m.actual, m.tx_count),
    };
  });

  // Account-řádky (role='fixed') vynech, pokud odpovídají ručnímu matcheru
  // (jinak by se platba počítala dvakrát). Match přes description-pattern i číslo účtu.
  const patterns = manual.map(m => m.match_pattern).filter(Boolean);
  const cpAccounts = manual.map(m => m.match_counterparty_account).filter(Boolean);
  const excludeParts = [
    ...patterns.map(() => "t.description LIKE '%' || ? || '%'"),
    ...cpAccounts.map(() => "t.counterparty_account LIKE ? || '%'"),
  ];
  const excludeSql = excludeParts.length ? ' AND NOT (' + excludeParts.join(' OR ') + ')' : '';

  const fromAccounts = db.prepare(`
    SELECT
      NULL as id,
      t.description as name,
      SUM(ABS(t.amount)) as amount,
      NULL as note,
      0 as sort_order,
      'account' as source,
      a.name as account_name,
      a.id as account_id
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.user_id = ?
      AND a.role = 'fixed'
      AND t.amount < 0
      AND t.date >= ? AND t.date <= ?${excludeSql}
    GROUP BY t.description, a.id
    ORDER BY a.name ASC, SUM(ABS(t.amount)) DESC
  `).all(userId, start, end, ...patterns, ...cpAccounts);

  return [...manualWithStatus, ...fromAccounts];
}

module.exports = { fixedExpensesForPeriod };
