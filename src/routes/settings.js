const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { currentPeriodKey, getPeriodDates } = require('../utils/period');

// GET /api/settings?period=YYYY-MM
router.get('/', requireAuth, (req, res) => {
  const ownerRow = db.prepare('SELECT billing_day FROM settings WHERE user_id = ?').get(req.dataUserId);
  const selfRow = db.prepare('SELECT notify_scope FROM settings WHERE user_id = ?').get(req.user.id);
  const billingDay = ownerRow?.billing_day ?? 1;
  const notifyScope = selfRow?.notify_scope ?? 'pending_only';
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

  // billing_day → vlastníkův řádek (sdílené období), bez dotčení jeho notify_scope
  db.prepare(`
    INSERT INTO settings (user_id, billing_day) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET billing_day = excluded.billing_day
  `).run(req.dataUserId, day);

  // notify_scope → volajícího řádek (osobní), bez dotčení jeho billing_day
  if (scope !== undefined) {
    db.prepare(`
      INSERT INTO settings (user_id, notify_scope) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET notify_scope = excluded.notify_scope
    `).run(req.user.id, scope);
  }

  const periodKey = currentPeriodKey(day);
  const { start, end } = getPeriodDates(day, periodKey);
  const selfRow = db.prepare('SELECT notify_scope FROM settings WHERE user_id = ?').get(req.user.id);
  res.json({ billing_day: day, notify_scope: selfRow?.notify_scope ?? 'pending_only', current_period: periodKey, period_start: start, period_end: end });
});

module.exports = router;
