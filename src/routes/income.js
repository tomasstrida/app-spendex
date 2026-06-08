const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { getUserBillingDay, currentPeriodKey } = require('../utils/period');
const { incomeSourcesForPeriod } = require('../utils/income');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/income?period=YYYY-MM
router.get('/', requireAuth, (req, res) => {
  const billingDay = getUserBillingDay(db, req.dataUserId);
  const period = req.query.period || currentPeriodKey(billingDay);
  const sources = incomeSourcesForPeriod(db, req.dataUserId, period, billingDay);
  res.json({ period, sources });
});

function resolveAccountId(db, userId, value, fallback) {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  const id = parseInt(value);
  if (!Number.isFinite(id)) return null;
  const acc = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(id, userId);
  return acc ? id : null;
}

// POST /api/income  body: { person, planned_amount, match_pattern, match_counterparty_account, account_id, sort_order }
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { person, planned_amount, match_pattern, match_counterparty_account, account_id, sort_order } = req.body;
  if (!person || !person.trim()) {
    return res.status(400).json({ error: 'person je povinný.' });
  }
  if (account_id != null && account_id !== '') {
    const id = parseInt(account_id);
    const acc = Number.isFinite(id) && db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(id, req.dataUserId);
    if (!acc) return res.status(400).json({ error: 'Neplatný cílový účet.' });
  }
  const result = db.prepare(
    'INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, match_counterparty_account, account_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    req.dataUserId,
    person.trim(),
    parseFloat(planned_amount) || 0,
    match_pattern && match_pattern.trim() ? match_pattern.trim() : null,
    match_counterparty_account && String(match_counterparty_account).trim() ? String(match_counterparty_account).trim() : null,
    resolveAccountId(db, req.dataUserId, account_id, null),
    sort_order ?? 0
  );
  res.status(201).json(db.prepare('SELECT * FROM income_sources WHERE id = ?').get(result.lastInsertRowid));
});

// PATCH /api/income/:id
router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM income_sources WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  const { person, planned_amount, match_pattern, match_counterparty_account, account_id, sort_order } = req.body;
  db.prepare('UPDATE income_sources SET person = ?, planned_amount = ?, match_pattern = ?, match_counterparty_account = ?, account_id = ?, sort_order = ? WHERE id = ?').run(
    person && person.trim() ? person.trim() : row.person,
    planned_amount != null ? parseFloat(planned_amount) : row.planned_amount,
    match_pattern !== undefined ? (match_pattern && match_pattern.trim() ? match_pattern.trim() : null) : row.match_pattern,
    match_counterparty_account !== undefined
      ? (match_counterparty_account && String(match_counterparty_account).trim() ? String(match_counterparty_account).trim() : null)
      : row.match_counterparty_account,
    resolveAccountId(db, req.dataUserId, account_id, row.account_id),
    sort_order ?? row.sort_order,
    row.id
  );
  res.json(db.prepare('SELECT * FROM income_sources WHERE id = ?').get(row.id));
});

// DELETE /api/income/:id
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM income_sources WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  db.prepare('DELETE FROM income_sources WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
