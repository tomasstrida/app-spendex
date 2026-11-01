const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
const PERIOD_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_NOTE_LENGTH = 2000;

// Textová poznámka k období (měsíční schůzka). Jedna na (data owner, periodKey),
// sdílená celou domácností přes req.dataUserId.
router.get('/', requireAuth, (req, res) => {
  const period = String(req.query.period || '');
  if (!PERIOD_KEY_RE.test(period)) return res.status(400).json({ error: 'Neplatné období.' });
  const row = db.prepare('SELECT note, updated_at FROM period_notes WHERE user_id = ? AND period_key = ?')
    .get(req.dataUserId, period);
  res.json({ period, note: row ? row.note : '', updated_at: row ? row.updated_at : null });
});

// Prázdný (po trimu) text poznámku smaže.
router.put('/', requireAuth, writeLimiter, (req, res) => {
  const { period, note } = req.body || {};
  if (typeof period !== 'string' || !PERIOD_KEY_RE.test(period)) {
    return res.status(400).json({ error: 'Neplatné období.' });
  }
  if (typeof note !== 'string') return res.status(400).json({ error: 'Poznámka musí být text.' });
  const text = note.trim();
  if (text.length > MAX_NOTE_LENGTH) {
    return res.status(400).json({ error: `Poznámka může mít nejvýš ${MAX_NOTE_LENGTH} znaků.` });
  }
  if (!text) {
    db.prepare('DELETE FROM period_notes WHERE user_id = ? AND period_key = ?').run(req.dataUserId, period);
    return res.json({ period, note: '', updated_at: null });
  }
  db.prepare(`
    INSERT INTO period_notes (user_id, period_key, note, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, period_key) DO UPDATE SET note = excluded.note, updated_at = datetime('now')
  `).run(req.dataUserId, period, text);
  const row = db.prepare('SELECT note, updated_at FROM period_notes WHERE user_id = ? AND period_key = ?')
    .get(req.dataUserId, period);
  res.json({ period, note: row.note, updated_at: row.updated_at });
});

module.exports = router;
