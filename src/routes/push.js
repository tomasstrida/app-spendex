'use strict';
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { sendToUser } = require('../services/pushNotify');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

router.get('/public-key', requireAuth, (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

router.post('/subscribe', requireAuth, writeLimiter, (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'Neplatná subscription.' });
  }
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id, p256dh = excluded.p256dh,
      auth = excluded.auth, user_agent = excluded.user_agent
  `).run(req.user.id, endpoint, keys.p256dh, keys.auth, req.get('user-agent') || null);
  res.json({ ok: true });
});

router.post('/unsubscribe', requireAuth, writeLimiter, (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, req.user.id);
  res.json({ ok: true });
});

router.post('/test', requireAuth, writeLimiter, async (req, res) => {
  await sendToUser(db, req.user.id, { title: 'SPENDEX', body: 'Testovací notifikace ✅', url: '/import' });
  res.json({ ok: true });
});

module.exports = router;
