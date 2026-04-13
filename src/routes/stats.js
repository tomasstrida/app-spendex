const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { getPeriodDates, getUserBillingDay, currentPeriodKey } = require('../utils/period');

// GET /api/stats/overview?period=2026-04
router.get('/overview', requireAuth, (req, res) => {
  const billingDay = getUserBillingDay(db, req.user.id);
  const periodKey = req.query.period || currentPeriodKey(billingDay);
  const { start, end } = getPeriodDates(billingDay, periodKey);

  const total = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) as total_spent
    FROM transactions
    WHERE user_id = ? AND amount < 0 AND date >= ? AND date <= ?
  `).get(req.user.id, start, end);

  const byCategory = db.prepare(`
    SELECT c.id, c.name, c.color, c.icon,
      COALESCE(SUM(ABS(t.amount)), 0) as spent,
      COUNT(t.id) as tx_count
    FROM categories c
    LEFT JOIN transactions t ON t.category_id = c.id
      AND t.user_id = ? AND t.amount < 0
      AND t.date >= ? AND t.date <= ?
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY spent DESC
  `).all(req.user.id, start, end, req.user.id);

  // Posledních 12 období
  const trend = db.prepare(`
    SELECT strftime('%Y-%m', date) as month_key,
      COALESCE(SUM(ABS(amount)), 0) as spent
    FROM transactions
    WHERE user_id = ? AND amount < 0
    GROUP BY strftime('%Y-%m', date)
    ORDER BY month_key DESC
    LIMIT 12
  `).all(req.user.id);

  res.json({
    period: periodKey,
    period_start: start,
    period_end: end,
    billing_day: billingDay,
    total_spent: total.total_spent,
    by_category: byCategory,
    monthly_trend: trend,
  });
});

module.exports = router;
