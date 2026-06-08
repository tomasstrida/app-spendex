'use strict';
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

function roleOf(userId) {
  const asMember = db.prepare('SELECT data_owner_id FROM household_members WHERE user_id = ?').get(userId);
  if (asMember) return { role: 'member', ownerId: asMember.data_owner_id };
  const members = db.prepare('SELECT 1 FROM household_members WHERE data_owner_id = ? LIMIT 1').get(userId);
  return { role: members ? 'owner' : 'solo', ownerId: userId };
}

router.get('/', requireAuth, (req, res) => {
  const { role } = roleOf(req.user.id);
  if (role === 'member') {
    const m = db.prepare('SELECT data_owner_id FROM household_members WHERE user_id = ?').get(req.user.id);
    const owner = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(m.data_owner_id);
    return res.json({ role, owner });
  }
  const members = db.prepare(`
    SELECT hm.user_id, u.name, u.email
    FROM household_members hm JOIN users u ON u.id = hm.user_id
    WHERE hm.data_owner_id = ?
  `).all(req.user.id);
  const inv = db.prepare('SELECT token FROM household_invites WHERE data_owner_id = ?').get(req.user.id);
  res.json({ role, members, invite_code: inv ? inv.token : null });
});

router.post('/invite', requireAuth, writeLimiter, (req, res) => {
  const { role } = roleOf(req.user.id);
  if (role === 'member') return res.status(403).json({ error: 'Člen nemůže vytvořit pozvánku.' });
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare(`
    INSERT INTO household_invites (data_owner_id, token) VALUES (?, ?)
    ON CONFLICT(data_owner_id) DO UPDATE SET token = excluded.token, created_at = datetime('now')
  `).run(req.user.id, token);
  res.json({ code: token });
});

router.post('/join', requireAuth, writeLimiter, (req, res) => {
  const { code } = req.body || {};
  const inv = db.prepare('SELECT data_owner_id FROM household_invites WHERE token = ?').get(code || '');
  if (!inv) return res.status(400).json({ error: 'Neplatný kód.' });
  if (inv.data_owner_id === req.user.id) return res.status(400).json({ error: 'Nelze se připojit do vlastní domácnosti.' });
  const iHaveMembers = db.prepare('SELECT 1 FROM household_members WHERE data_owner_id = ? LIMIT 1').get(req.user.id);
  if (iHaveMembers) return res.status(409).json({ error: 'Nejdřív odeber členy své domácnosti.' });
  const already = db.prepare('SELECT 1 FROM household_members WHERE user_id = ?').get(req.user.id);
  if (already) return res.status(409).json({ error: 'Už jsi ve sdílené domácnosti.' });
  db.transaction(() => {
    db.prepare('INSERT INTO household_members (data_owner_id, user_id) VALUES (?, ?)').run(inv.data_owner_id, req.user.id);
    db.prepare('DELETE FROM household_invites WHERE token = ?').run(code);
  })();
  res.json({ ok: true });
});

router.post('/leave', requireAuth, writeLimiter, (req, res) => {
  const r = db.prepare('DELETE FROM household_members WHERE user_id = ?').run(req.user.id);
  if (r.changes === 0) return res.status(400).json({ error: 'Nejsi ve sdílené domácnosti.' });
  res.json({ ok: true });
});

router.delete('/members/:userId', requireAuth, writeLimiter, (req, res) => {
  const uid = parseInt(req.params.userId, 10);
  if (!uid) return res.status(400).json({ error: 'Neplatný uživatel.' });
  const r = db.prepare('DELETE FROM household_members WHERE user_id = ? AND data_owner_id = ?').run(uid, req.user.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Člen nenalezen.' });
  res.json({ ok: true });
});

module.exports = router;
