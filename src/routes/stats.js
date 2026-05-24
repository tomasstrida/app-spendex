const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { getPeriodDates, getUserBillingDay, currentPeriodKey } = require('../utils/period');
const { savingsNet, reserveBalance, savingsAccount, reserveAccount, reservePaidPatterns, mainAccount, variableAccount } = require('../utils/recurring');

// GET /api/stats/overview?period=2026-04
router.get('/overview', requireAuth, (req, res) => {
  const billingDay = getUserBillingDay(db, req.user.id);
  const periodKey = req.query.period || currentPeriodKey(billingDay);
  const { start, end } = getPeriodDates(billingDay, periodKey);

  const SPENDING_FILTER = `
    AND (t.account_id IS NULL OR EXISTS (
      SELECT 1 FROM accounts a WHERE a.id = t.account_id AND a.role = 'spending'
    ))
  `;

  const total = db.prepare(`
    SELECT COALESCE(SUM(-t.amount), 0) as total_spent
    FROM transactions t
    WHERE t.user_id = ? AND t.date >= ? AND t.date <= ?
    ${SPENDING_FILTER}
  `).get(req.user.id, start, end);

  const byCategory = db.prepare(`
    SELECT c.id, c.name, c.color, c.icon, c.type,
      COALESCE(SUM(-t.amount), 0) as spent,
      COUNT(t.id) as tx_count
    FROM categories c
    LEFT JOIN transactions t ON t.category_id = c.id
      AND t.user_id = ?
      AND t.date >= ? AND t.date <= ?
      AND (t.account_id IS NULL OR EXISTS (
        SELECT 1 FROM accounts a WHERE a.id = t.account_id AND a.role = 'spending'
      ))
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY spent DESC
  `).all(req.user.id, start, end, req.user.id);

  // Posledních 12 období
  const trend = db.prepare(`
    SELECT strftime('%Y-%m', t.date) as month_key,
      COALESCE(SUM(-t.amount), 0) as spent
    FROM transactions t
    WHERE t.user_id = ?
    AND (t.account_id IS NULL OR EXISTS (
      SELECT 1 FROM accounts a WHERE a.id = t.account_id AND a.role = 'spending'
    ))
    GROUP BY strftime('%Y-%m', t.date)
    ORDER BY month_key DESC
    LIMIT 12
  `).all(req.user.id);

  const sav = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS deposits,
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS withdrawals
    FROM transactions
    WHERE user_id = ? AND counterparty_account LIKE ? || '%'
      AND date >= ? AND date <= ?
  `).get(req.user.id, savingsAccount, start, end);
  const savings = { deposits: sav.deposits, withdrawals: sav.withdrawals, net: savingsNet(sav) };

  const envCol = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS envelopeDeposits,
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS envelopeReturns
    FROM transactions
    WHERE user_id = ? AND counterparty_account LIKE ? || '%' AND date <= ?
  `).get(req.user.id, reserveAccount, end);
  const paidStmt = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) AS s
    FROM transactions
    WHERE user_id = ? AND amount < 0 AND date <= ? AND description LIKE '%' || ? || '%'
  `);
  const najemSum = paidStmt.get(req.user.id, end, reservePaidPatterns[0]).s;
  const preSum   = paidStmt.get(req.user.id, end, reservePaidPatterns[1]).s;
  const reserve = {
    balance: reserveBalance({
      envelopeDeposits: envCol.envelopeDeposits,
      najemSum, preSum,
      envelopeReturns: envCol.envelopeReturns,
    }),
  };

  // Dotace Nepravidelné: součet odchozích plateb z Hlavního účtu na účet Nepravidelné v období
  const variablePoolDotace = db.prepare(`
    SELECT COALESCE(SUM(ABS(t.amount)), 0) AS amount
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.user_id = ? AND t.amount < 0
      AND t.date >= ? AND t.date <= ?
      AND a.account_number = ?
      AND t.counterparty_account LIKE ? || '%'
  `).get(req.user.id, start, end, mainAccount, variableAccount);

  res.json({
    period: periodKey,
    period_start: start,
    period_end: end,
    billing_day: billingDay,
    total_spent: total.total_spent,
    by_category: byCategory,
    monthly_trend: trend,
    savings,
    reserve,
    variable_pool_funded: variablePoolDotace.amount,
  });
});

module.exports = router;
