const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/budget-items?category_id=X&year=Y
// Vrátí podpoložky s utracenými částkami v jejich časovém okně.
router.get('/', requireAuth, (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const params = req.query.category_id
    ? [req.user.id, parseInt(req.query.category_id)]
    : [req.user.id];
  const whereExtra = req.query.category_id ? ' AND bi.category_id = ?' : '';

  const items = db.prepare(`
    SELECT bi.*, c.name as category_name, c.color as category_color
    FROM budget_items bi
    JOIN categories c ON c.id = bi.category_id AND c.user_id = bi.user_id
    WHERE bi.user_id = ?${whereExtra}
    ORDER BY bi.category_id, bi.window_start
  `).all(...params);

  const getSpent = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) as spent
    FROM transactions
    WHERE user_id = ? AND category_id = ? AND amount < 0
      AND date >= ? AND date <= ?
  `);

  const result = items.map(item => {
    // cross-year okno (např. říjen–leden): to patří do příštího roku
    const toYear = item.window_start > item.window_end ? year + 1 : year;
    const from = `${year}-${String(item.window_start).padStart(2, '0')}-01`;
    const lastDay = new Date(toYear, item.window_end, 0).getDate();
    const to = `${toYear}-${String(item.window_end).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const { spent } = getSpent.get(req.user.id, item.category_id, from, to);
    return { ...item, spent, window_from: from, window_to: to };
  });

  res.json({ year, items: result });
});

// POST /api/budget-items
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { category_id, name, amount, window_start, window_end } = req.body;
  if (!category_id || !name || amount == null || window_start == null || window_end == null) {
    return res.status(400).json({ error: 'Všechna pole jsou povinná.' });
  }
  const ws = parseInt(window_start);
  const we = parseInt(window_end);
  if (ws < 1 || ws > 12 || we < 1 || we > 12) {
    return res.status(400).json({ error: 'Měsíce musí být v rozsahu 1–12.' });
  }
  const cat = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(category_id, req.user.id);
  if (!cat) return res.status(404).json({ error: 'Kategorie nenalezena.' });

  const result = db.prepare(
    'INSERT INTO budget_items (user_id, category_id, name, amount, window_start, window_end) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, parseInt(category_id), name.trim(), parseFloat(amount), ws, we);

  res.status(201).json(db.prepare('SELECT * FROM budget_items WHERE id = ?').get(result.lastInsertRowid));
});

// PATCH /api/budget-items/:id
router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const item = db.prepare('SELECT * FROM budget_items WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Podpoložka nenalezena.' });

  const { name, amount, window_start, window_end } = req.body;
  db.prepare('UPDATE budget_items SET name = ?, amount = ?, window_start = ?, window_end = ? WHERE id = ?').run(
    name ?? item.name,
    amount != null ? parseFloat(amount) : item.amount,
    window_start != null ? parseInt(window_start) : item.window_start,
    window_end != null ? parseInt(window_end) : item.window_end,
    item.id
  );
  res.json(db.prepare('SELECT * FROM budget_items WHERE id = ?').get(item.id));
});

// DELETE /api/budget-items/:id
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const item = db.prepare('SELECT * FROM budget_items WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Podpoložka nenalezena.' });
  db.prepare('DELETE FROM budget_items WHERE id = ?').run(item.id);
  res.json({ ok: true });
});

module.exports = router;
