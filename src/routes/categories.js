const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/categories/fund-status?year=Y  (musí být před /:id)
router.get('/fund-status', requireAuth, (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const cats = db.prepare(
    'SELECT * FROM categories WHERE user_id = ? AND type = 3 ORDER BY name ASC'
  ).all(req.user.id);

  const lastEver = db.prepare(`
    SELECT MAX(date) as last_date
    FROM transactions
    WHERE user_id = ? AND category_id = ? AND amount < 0
  `);
  const yearSpent = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) as total
    FROM transactions
    WHERE user_id = ? AND category_id = ? AND amount < 0
      AND date >= ? AND date <= ?
  `);

  const result = cats.map(cat => {
    const { last_date } = lastEver.get(req.user.id, cat.id);
    const { total } = yearSpent.get(req.user.id, cat.id, `${year}-01-01`, `${year}-12-31`);

    let months_since_last = null;
    if (last_date) {
      const diff = Date.now() - new Date(last_date + 'T00:00:00').getTime();
      months_since_last = Math.floor(diff / (1000 * 60 * 60 * 24 * 30.5));
    }

    const monthly_contribution = cat.typical_price && cat.frequency_months
      ? Math.round(cat.typical_price / cat.frequency_months)
      : null;

    return {
      ...cat,
      last_payment_date: last_date || null,
      months_since_last,
      total_year: total,
      monthly_contribution,
    };
  });

  res.json(result);
});

// GET /api/categories
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY name ASC').all(req.user.id);
  res.json(rows);
});

// POST /api/categories
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { name, color, icon, type, typical_price, frequency_months } = req.body;
  if (!name) return res.status(400).json({ error: 'Název kategorie je povinný.' });

  const result = db.prepare(
    'INSERT INTO categories (user_id, name, color, icon, type, typical_price, frequency_months) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, name, color || '#6366f1', icon || 'tag', type || 1,
    typical_price != null ? parseFloat(typical_price) : null,
    frequency_months != null ? parseInt(frequency_months) : null);

  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid));
});

// PATCH /api/categories/:id
router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!cat) return res.status(404).json({ error: 'Kategorie nenalezena.' });

  const { name, color, icon, type, typical_price, frequency_months } = req.body;
  db.prepare(`
    UPDATE categories
    SET name = ?, color = ?, icon = ?, type = ?, typical_price = ?, frequency_months = ?
    WHERE id = ?
  `).run(
    name ?? cat.name,
    color ?? cat.color,
    icon ?? cat.icon,
    type ?? cat.type ?? 1,
    typical_price !== undefined ? (typical_price != null ? parseFloat(typical_price) : null) : cat.typical_price,
    frequency_months !== undefined ? (frequency_months != null ? parseInt(frequency_months) : null) : cat.frequency_months,
    cat.id
  );
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(cat.id));
});

// DELETE /api/categories/:id
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!cat) return res.status(404).json({ error: 'Kategorie nenalezena.' });
  db.prepare('DELETE FROM categories WHERE id = ?').run(cat.id);
  res.json({ ok: true });
});

module.exports = router;
