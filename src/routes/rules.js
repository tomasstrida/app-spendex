const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

// Ověří, že kategorie patří uživateli
function ownsCategory(userId, categoryId) {
  return !!db.prepare('SELECT 1 FROM categories WHERE id = ? AND user_id = ?').get(categoryId, userId);
}

// Volitelná částka: '' / undefined / null → null; jinak kladné číslo nebo {ok:false}
function parseAmount(v) {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

// GET /api/rules
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.pattern, r.category_id, r.amount_max_abs, r.amount_min_abs,
           c.name AS category_name, c.color AS category_color
    FROM category_rules r
    JOIN categories c ON c.id = r.category_id
    WHERE r.user_id = ?
    ORDER BY (r.amount_max_abs IS NOT NULL OR r.amount_min_abs IS NOT NULL) DESC, r.id ASC
  `).all(req.dataUserId);
  res.json(rows);
});

// POST /api/rules
router.post('/', requireAuth, (req, res) => {
  const pattern = (req.body.pattern || '').trim();
  const categoryId = parseInt(req.body.category_id);
  if (!pattern || !categoryId) return res.status(400).json({ error: 'Vyplň text a kategorii.' });
  if (!ownsCategory(req.dataUserId, categoryId)) return res.status(400).json({ error: 'Neplatná kategorie.' });
  const max = parseAmount(req.body.amount_max_abs);
  const min = parseAmount(req.body.amount_min_abs);
  if (!max.ok || !min.ok) return res.status(400).json({ error: 'Neplatná částka.' });
  const info = db.prepare(
    'INSERT INTO category_rules (user_id, category_id, pattern, amount_max_abs, amount_min_abs) VALUES (?, ?, ?, ?, ?)'
  ).run(req.dataUserId, categoryId, pattern, max.value, min.value);
  const row = db.prepare('SELECT * FROM category_rules WHERE id = ?').get(info.lastInsertRowid);
  res.json(row);
});

// PATCH /api/rules/:id
router.patch('/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM category_rules WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!existing) return res.status(404).json({ error: 'Pravidlo nenalezeno.' });
  const pattern = (req.body.pattern ?? existing.pattern).trim();
  const categoryId = req.body.category_id != null ? parseInt(req.body.category_id) : existing.category_id;
  if (!pattern || !categoryId) return res.status(400).json({ error: 'Vyplň text a kategorii.' });
  if (!ownsCategory(req.dataUserId, categoryId)) return res.status(400).json({ error: 'Neplatná kategorie.' });
  const max = parseAmount(req.body.amount_max_abs);
  const min = parseAmount(req.body.amount_min_abs);
  if (!max.ok || !min.ok) return res.status(400).json({ error: 'Neplatná částka.' });
  db.prepare('UPDATE category_rules SET pattern = ?, category_id = ?, amount_max_abs = ?, amount_min_abs = ? WHERE id = ?')
    .run(pattern, categoryId, max.value, min.value, existing.id);
  res.json(db.prepare('SELECT * FROM category_rules WHERE id = ?').get(existing.id));
});

// DELETE /api/rules/:id
router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id FROM category_rules WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Pravidlo nenalezeno.' });
  db.prepare('DELETE FROM category_rules WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
