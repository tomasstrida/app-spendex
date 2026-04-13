const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { getPeriodDates, getUserBillingDay } = require('../utils/period');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/budgets?period=2026-04
router.get('/', requireAuth, (req, res) => {
  const billingDay = getUserBillingDay(db, req.user.id);
  const periodKey = req.query.period || require('../utils/period').currentPeriodKey(billingDay);
  const { start, end } = getPeriodDates(billingDay, periodKey);

  const rows = db.prepare(`
    SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
      COALESCE((
        SELECT SUM(ABS(t.amount))
        FROM transactions t
        WHERE t.user_id = b.user_id
          AND t.category_id = b.category_id
          AND t.date >= ? AND t.date <= ?
          AND t.amount < 0
      ), 0) as spent
    FROM budgets b
    JOIN categories c ON b.category_id = c.id
    WHERE b.user_id = ? AND b.month = ?
    ORDER BY c.name ASC
  `).all(start, end, req.user.id, periodKey);

  res.json({ period: periodKey, period_start: start, period_end: end, billing_day: billingDay, budgets: rows });
});

// PUT /api/budgets (upsert)
router.put('/', requireAuth, writeLimiter, (req, res) => {
  const { category_id, period, amount } = req.body;
  if (!category_id || !period || amount == null) return res.status(400).json({ error: 'category_id, period a amount jsou povinné.' });

  const cat = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(category_id, req.user.id);
  if (!cat) return res.status(404).json({ error: 'Kategorie nenalezena.' });

  db.prepare(`
    INSERT INTO budgets (user_id, category_id, month, amount)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, category_id, month) DO UPDATE SET amount = excluded.amount
  `).run(req.user.id, category_id, period, amount);

  const row = db.prepare('SELECT * FROM budgets WHERE user_id = ? AND category_id = ? AND month = ?').get(req.user.id, category_id, period);
  res.json(row);
});

// DELETE /api/budgets/:id
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const budget = db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!budget) return res.status(404).json({ error: 'Rozpočet nenalezen.' });
  db.prepare('DELETE FROM budgets WHERE id = ?').run(budget.id);
  res.json({ ok: true });
});

module.exports = router;
