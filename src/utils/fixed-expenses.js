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

  const matchStmt = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) AS actual, COUNT(*) AS tx_count
    FROM transactions
    WHERE user_id = ? AND amount < 0 AND date >= ? AND date <= ?
      AND description LIKE '%' || ? || '%'
  `);

  const manualWithStatus = manual.map(row => {
    if (!row.match_pattern) return row;
    const m = matchStmt.get(userId, start, end, row.match_pattern);
    return {
      ...row,
      actual: m.actual,
      tx_count: m.tx_count,
      status: paymentStatus(row.amount, m.actual, m.tx_count),
    };
  });

  const patterns = manual.map(m => m.match_pattern).filter(Boolean);
  const excludeSql = patterns.length
    ? ' AND NOT (' + patterns.map(() => "t.description LIKE '%' || ? || '%'").join(' OR ') + ')'
    : '';

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
  `).all(userId, start, end, ...patterns);

  return [...manualWithStatus, ...fromAccounts];
}

module.exports = { fixedExpensesForPeriod };
