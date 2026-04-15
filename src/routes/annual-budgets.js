const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/annual-budgets?year=YYYY
router.get('/', requireAuth, (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const rows = db.prepare(`
    SELECT
      ab.id,
      ab.category_id,
      c.name  as category_name,
      c.color as category_color,
      c.type  as category_type,
      ab.amount,
      COALESCE((
        SELECT SUM(ABS(t.amount))
        FROM transactions t
        WHERE t.user_id = ab.user_id
          AND t.category_id = ab.category_id
          AND t.date >= ? AND t.date <= ?
          AND t.amount < 0
      ), 0) as spent
    FROM annual_budgets ab
    JOIN categories c ON c.id = ab.category_id AND c.user_id = ab.user_id
    WHERE ab.user_id = ?
    ORDER BY c.name ASC
  `).all(from, to, req.user.id);

  res.json({ year, budgets: rows });
});

// PUT /api/annual-budgets
// body: { category_id, amount }
router.put('/', requireAuth, writeLimiter, (req, res) => {
  const { category_id, amount } = req.body;
  if (!category_id || amount == null) return res.status(400).json({ error: 'category_id a amount jsou povinné.' });

  const cat = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(category_id, req.user.id);
  if (!cat) return res.status(404).json({ error: 'Kategorie nenalezena.' });

  db.prepare(`
    INSERT INTO annual_budgets (user_id, category_id, amount)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, category_id) DO UPDATE SET amount = excluded.amount
  `).run(req.user.id, category_id, amount);

  const row = db.prepare('SELECT * FROM annual_budgets WHERE user_id = ? AND category_id = ?')
    .get(req.user.id, category_id);
  res.json(row);
});

// DELETE /api/annual-budgets/:id
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const budget = db.prepare('SELECT * FROM annual_budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!budget) return res.status(404).json({ error: 'Roční rozpočet nenalezen.' });
  db.prepare('DELETE FROM annual_budgets WHERE id = ?').run(budget.id);
  res.json({ ok: true });
});

module.exports = router;
