const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { currentPeriodKey, getPeriodDates } = require('../utils/period');

// GET /api/settings?period=YYYY-MM
router.get('/', requireAuth, (req, res) => {
  const row = db.prepare('SELECT billing_day, notify_scope FROM settings WHERE user_id = ?').get(req.user.id);
  const billingDay = row?.billing_day ?? 1;
  const notifyScope = row?.notify_scope ?? 'pending_only';
  const currentKey = currentPeriodKey(billingDay);
  const periodKey = req.query.period || currentKey;
  const { start, end } = getPeriodDates(billingDay, periodKey);
  res.json({ billing_day: billingDay, notify_scope: notifyScope, current_period: currentKey, period_start: start, period_end: end });
});

// PUT /api/settings
router.put('/', requireAuth, (req, res) => {
  const { billing_day, notify_scope } = req.body;
  const day = parseInt(billing_day, 10);
  if (!day || day < 1 || day > 31) return res.status(400).json({ error: 'billing_day musí být 1–31.' });

  const VALID_SCOPES = ['off', 'pending_only', 'all'];
  const scope = notify_scope === undefined ? undefined : String(notify_scope);
  if (scope !== undefined && !VALID_SCOPES.includes(scope)) {
    return res.status(400).json({ error: 'Neplatný notify_scope.' });
  }

  db.prepare(`
    INSERT INTO settings (user_id, billing_day, notify_scope)
    VALUES (?, ?, COALESCE(?, 'pending_only'))
    ON CONFLICT(user_id) DO UPDATE SET
      billing_day = excluded.billing_day,
      notify_scope = COALESCE(?, settings.notify_scope)
  `).run(req.user.id, day, scope ?? null, scope ?? null);

  const periodKey = currentPeriodKey(day);
  const { start, end } = getPeriodDates(day, periodKey);
  const row = db.prepare('SELECT notify_scope FROM settings WHERE user_id = ?').get(req.user.id);
  res.json({ billing_day: day, notify_scope: row.notify_scope, current_period: periodKey, period_start: start, period_end: end });
});

module.exports = router;
