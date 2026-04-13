const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { currentPeriodKey, getPeriodDates } = require('../utils/period');

// GET /api/settings
router.get('/', requireAuth, (req, res) => {
  const row = db.prepare('SELECT billing_day FROM settings WHERE user_id = ?').get(req.user.id);
  const billingDay = row?.billing_day ?? 1;
  const periodKey = currentPeriodKey(billingDay);
  const { start, end } = getPeriodDates(billingDay, periodKey);
  res.json({ billing_day: billingDay, current_period: periodKey, period_start: start, period_end: end });
});

// PUT /api/settings
router.put('/', requireAuth, (req, res) => {
  const { billing_day } = req.body;
  const day = parseInt(billing_day, 10);
  if (!day || day < 1 || day > 31) return res.status(400).json({ error: 'billing_day musí být 1–31.' });

  db.prepare(`
    INSERT INTO settings (user_id, billing_day) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET billing_day = excluded.billing_day
  `).run(req.user.id, day);

  const periodKey = currentPeriodKey(day);
  const { start, end } = getPeriodDates(day, periodKey);
  res.json({ billing_day: day, current_period: periodKey, period_start: start, period_end: end });
});

module.exports = router;
