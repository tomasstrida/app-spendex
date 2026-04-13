const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/budgets?month=2025-01
router.get('/', requireAuth, (req, res) => {
  const { month } = req.query;
  const currentMonth = month || new Date().toISOString().slice(0, 7);

  const rows = db.prepare(`
    SELECT b.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
      COALESCE((
        SELECT SUM(ABS(t.amount))
        FROM transactions t
        WHERE t.user_id = b.user_id
          AND t.category_id = b.category_id
          AND strftime('%Y-%m', t.date) = b.month
          AND t.amount < 0
      ), 0) as spent
    FROM budgets b
    JOIN categories c ON b.category_id = c.id
    WHERE b.user_id = ? AND b.month = ?
    ORDER BY c.name ASC
  `).all(req.user.id, currentMonth);

  res.json(rows);
});

// PUT /api/budgets (upsert)
router.put('/', requireAuth, writeLimiter, (req, res) => {
  const { category_id, month, amount } = req.body;
  if (!category_id || !month || amount == null) return res.status(400).json({ error: 'category_id, month a amount jsou povinné.' });

  const cat = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(category_id, req.user.id);
  if (!cat) return res.status(404).json({ error: 'Kategorie nenalezena.' });

  db.prepare(`
    INSERT INTO budgets (user_id, category_id, month, amount)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, category_id, month) DO UPDATE SET amount = excluded.amount
  `).run(req.user.id, category_id, month, amount);

  const row = db.prepare('SELECT * FROM budgets WHERE user_id = ? AND category_id = ? AND month = ?').get(req.user.id, category_id, month);
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
