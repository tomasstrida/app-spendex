const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

const { fixedExpensesForPeriod } = require('../utils/fixed-expenses');

// GET /api/fixed-expenses?period=YYYY-MM
router.get('/', requireAuth, (req, res) => {
  res.json(fixedExpensesForPeriod(db, req.dataUserId, req.query.period));
});

// POST /api/fixed-expenses
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { name, amount, note, sort_order, match_pattern, amount_min, amount_max, frequency_months } = req.body;
  if (!name || amount == null) return res.status(400).json({ error: 'Název a částka jsou povinné.' });
  const min = amount_min != null ? parseFloat(amount_min) : null;
  const max = amount_max != null ? parseFloat(amount_max) : null;
  if (min != null && max != null && min > max) return res.status(400).json({ error: 'Min nesmí být větší než max.' });
  const freq = frequency_months != null ? Math.max(1, parseInt(frequency_months, 10) || 1) : 1;
  const result = db.prepare(
    'INSERT INTO fixed_expenses (user_id, name, amount, note, sort_order, match_pattern, amount_min, amount_max, frequency_months) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.dataUserId, name.trim(), parseFloat(amount), note || null, sort_order ?? 0,
    match_pattern && match_pattern.trim() ? match_pattern.trim() : null, min, max, freq);
  res.status(201).json(db.prepare('SELECT * FROM fixed_expenses WHERE id = ?').get(result.lastInsertRowid));
});

// PATCH /api/fixed-expenses/:id
router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  const { name, amount, note, sort_order, match_pattern, amount_min, amount_max, frequency_months } = req.body;
  const min = amount_min !== undefined ? (amount_min != null ? parseFloat(amount_min) : null) : row.amount_min;
  const max = amount_max !== undefined ? (amount_max != null ? parseFloat(amount_max) : null) : row.amount_max;
  if (min != null && max != null && min > max) return res.status(400).json({ error: 'Min nesmí být větší než max.' });
  db.prepare('UPDATE fixed_expenses SET name = ?, amount = ?, note = ?, sort_order = ?, match_pattern = ?, amount_min = ?, amount_max = ?, frequency_months = ? WHERE id = ?').run(
    name ?? row.name,
    amount != null ? parseFloat(amount) : row.amount,
    note !== undefined ? (note || null) : row.note,
    sort_order ?? row.sort_order,
    match_pattern !== undefined ? (match_pattern && match_pattern.trim() ? match_pattern.trim() : null) : row.match_pattern,
    min, max,
    frequency_months !== undefined ? Math.max(1, parseInt(frequency_months, 10) || 1) : row.frequency_months,
    row.id
  );
  res.json(db.prepare('SELECT * FROM fixed_expenses WHERE id = ?').get(row.id));
});

// DELETE /api/fixed-expenses/:id
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  db.prepare('DELETE FROM fixed_expenses WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
