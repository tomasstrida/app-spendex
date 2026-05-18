'use strict';
const { getPeriodDates } = require('./period');
const { incomeStatus } = require('./recurring');

/**
 * Vrátí příjmové zdroje uživatele se skutečnou částkou za období.
 * Skutečnost = SUM(amount) z transakcí kde amount>0, účet má roli 'income',
 * datum spadá do období a description LIKE %match_pattern%.
 */
function incomeSourcesForPeriod(db, userId, period, billingDay) {
  const sources = db.prepare(
    'SELECT * FROM income_sources WHERE user_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(userId);

  const { start, end } = getPeriodDates(billingDay, period);
  const matchStmt = db.prepare(`
    SELECT COALESCE(SUM(t.amount), 0) AS actual, COUNT(*) AS tx_count
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.user_id = ? AND a.role = 'income' AND t.amount > 0
      AND t.date >= ? AND t.date <= ?
      AND t.description LIKE '%' || ? || '%'
  `);

  return sources.map(s => {
    if (!s.match_pattern) {
      return { ...s, actual: 0, tx_count: 0, status: null };
    }
    const m = matchStmt.get(userId, start, end, s.match_pattern);
    return {
      ...s,
      actual: m.actual,
      tx_count: m.tx_count,
      status: incomeStatus(s.planned_amount, m.actual, m.tx_count),
    };
  });
}

module.exports = { incomeSourcesForPeriod };
