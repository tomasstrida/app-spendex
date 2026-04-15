const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { getUserBillingDay, currentPeriodKey } = require('../utils/period');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/income?period=YYYY-MM
router.get('/', requireAuth, (req, res) => {
  const billingDay = getUserBillingDay(db, req.user.id);
  const period = req.query.period || currentPeriodKey(billingDay);
  const rows = db.prepare(
    'SELECT * FROM income WHERE user_id = ? AND period = ? ORDER BY person ASC'
  ).all(req.user.id, period);
  res.json({ period, income: rows });
});

// POST /api/income
// body: { person, amount, period, note }
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { person, amount, period, note } = req.body;
  if (!person || amount == null || !period) {
    return res.status(400).json({ error: 'person, amount a period jsou povinné.' });
  }
  try {
    const result = db.prepare(
      'INSERT INTO income (user_id, person, amount, period, note) VALUES (?, ?, ?, ?, ?)'
    ).run(req.user.id, person.trim(), amount, period, note || null);
    res.status(201).json(db.prepare('SELECT * FROM income WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: `Příjem pro "${person}" v tomto období již existuje.` });
    }
    throw e;
  }
});

// PATCH /api/income/:id
router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM income WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  const { person, amount, note } = req.body;
  db.prepare('UPDATE income SET person = ?, amount = ?, note = ? WHERE id = ?').run(
    person ?? row.person, amount ?? row.amount, note !== undefined ? note : row.note, row.id
  );
  res.json(db.prepare('SELECT * FROM income WHERE id = ?').get(row.id));
});

// DELETE /api/income/:id
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM income WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  db.prepare('DELETE FROM income WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
