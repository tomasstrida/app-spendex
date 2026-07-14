const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

function ownsCategory(userId, categoryId) {
  return !!db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(categoryId, userId);
}

router.get('/', requireAuth, (req, res) => {
  const catId = parseInt(req.query.category_id);
  if (!catId) return res.status(400).json({ error: 'Chybí category_id.' });
  res.json(db.prepare('SELECT * FROM subcategories WHERE user_id = ? AND category_id = ? ORDER BY sort_order ASC, name ASC').all(req.dataUserId, catId));
});

router.post('/', requireAuth, writeLimiter, (req, res) => {
  const categoryId = parseInt(req.body.category_id);
  const name = (req.body.name || '').trim();
  if (!categoryId || !name) return res.status(400).json({ error: 'Vyplň kategorii a název.' });
  if (!ownsCategory(req.dataUserId, categoryId)) return res.status(404).json({ error: 'Kategorie nenalezena.' });
  try {
    const r = db.prepare('INSERT INTO subcategories (user_id, category_id, name, sort_order) VALUES (?, ?, ?, ?)').run(req.dataUserId, categoryId, name, req.body.sort_order ?? 0);
    res.status(201).json(db.prepare('SELECT * FROM subcategories WHERE id = ?').get(r.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Subkategorie s tímto názvem už v kategorii existuje.' });
    throw e;
  }
});

router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM subcategories WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Nenalezeno.' });
  const name = req.body.name != null ? (req.body.name || '').trim() : row.name;
  if (!name) return res.status(400).json({ error: 'Název je povinný.' });
  try {
    db.prepare('UPDATE subcategories SET name = ?, sort_order = ? WHERE id = ?').run(name, req.body.sort_order ?? row.sort_order, row.id);
    res.json(db.prepare('SELECT * FROM subcategories WHERE id = ?').get(row.id));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Duplicitní název.' });
    throw e;
  }
});

router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM subcategories WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Nenalezeno.' });
  db.prepare('DELETE FROM subcategories WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
