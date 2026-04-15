const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/categories
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY name ASC').all(req.user.id);
  res.json(rows);
});

// POST /api/categories
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { name, color, icon, type } = req.body;
  if (!name) return res.status(400).json({ error: 'Název kategorie je povinný.' });

  const result = db.prepare(
    'INSERT INTO categories (user_id, name, color, icon, type) VALUES (?, ?, ?, ?, ?)'
  ).run(req.user.id, name, color || '#6366f1', icon || 'tag', type || 1);

  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid));
});

// PATCH /api/categories/:id
router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!cat) return res.status(404).json({ error: 'Kategorie nenalezena.' });

  const { name, color, icon, type } = req.body;
  db.prepare('UPDATE categories SET name = ?, color = ?, icon = ?, type = ? WHERE id = ?').run(
    name ?? cat.name, color ?? cat.color, icon ?? cat.icon, type ?? cat.type ?? 1, cat.id
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
