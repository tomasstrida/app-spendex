const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

// GET /api/stats/overview?month=2025-01
router.get('/overview', requireAuth, (req, res) => {
  const { month } = req.query;
  const currentMonth = month || new Date().toISOString().slice(0, 7);

  const total = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) as total_spent
    FROM transactions
    WHERE user_id = ? AND amount < 0 AND strftime('%Y-%m', date) = ?
  `).get(req.user.id, currentMonth);

  const byCategory = db.prepare(`
    SELECT c.id, c.name, c.color, c.icon,
      COALESCE(SUM(ABS(t.amount)), 0) as spent,
      COUNT(t.id) as tx_count
    FROM categories c
    LEFT JOIN transactions t ON t.category_id = c.id
      AND t.user_id = ? AND t.amount < 0
      AND strftime('%Y-%m', t.date) = ?
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY spent DESC
  `).all(req.user.id, currentMonth, req.user.id);

  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', date) as month,
      COALESCE(SUM(ABS(amount)), 0) as spent
    FROM transactions
    WHERE user_id = ? AND amount < 0
    GROUP BY strftime('%Y-%m', date)
    ORDER BY month DESC
    LIMIT 12
  `).all(req.user.id);

  res.json({ month: currentMonth, total_spent: total.total_spent, by_category: byCategory, monthly_trend: monthly });
});

module.exports = router;
