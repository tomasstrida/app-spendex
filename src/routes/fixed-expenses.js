const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/fixed-expenses
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM fixed_expenses WHERE user_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(req.user.id);
  res.json(rows);
});

// POST /api/fixed-expenses
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { name, amount, note, sort_order } = req.body;
  if (!name || amount == null) return res.status(400).json({ error: 'Název a částka jsou povinné.' });
  const result = db.prepare(
    'INSERT INTO fixed_expenses (user_id, name, amount, note, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(req.user.id, name.trim(), parseFloat(amount), note || null, sort_order ?? 0);
  res.status(201).json(db.prepare('SELECT * FROM fixed_expenses WHERE id = ?').get(result.lastInsertRowid));
});

// PATCH /api/fixed-expenses/:id
router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  const { name, amount, note, sort_order } = req.body;
  db.prepare('UPDATE fixed_expenses SET name = ?, amount = ?, note = ?, sort_order = ? WHERE id = ?').run(
    name ?? row.name,
    amount != null ? parseFloat(amount) : row.amount,
    note !== undefined ? (note || null) : row.note,
    sort_order ?? row.sort_order,
    row.id
  );
  res.json(db.prepare('SELECT * FROM fixed_expenses WHERE id = ?').get(row.id));
});

// DELETE /api/fixed-expenses/:id
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  db.prepare('DELETE FROM fixed_expenses WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
