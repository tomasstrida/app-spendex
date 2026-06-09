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

const { releaseHeldCard } = require('../services/emailIngest');

// Lidé domácnosti = vlastník + členové (pro dropdown přiřazení karty)
function householdPeople(ownerId) {
  const owner = db.prepare('SELECT id AS user_id, name, email FROM users WHERE id = ?').get(ownerId);
  const members = db.prepare(`
    SELECT hm.user_id, u.name, u.email
    FROM household_members hm JOIN users u ON u.id = hm.user_id
    WHERE hm.data_owner_id = ?
  `).all(ownerId);
  return [owner, ...members].filter(Boolean);
}

// GET /api/household/cards — karty + lidé + počet zadržených plateb na kartu
router.get('/cards', requireAuth, (req, res) => {
  const { ownerId } = roleOf(req.user.id);
  const cards = db.prepare(`
    SELECT c.last4, c.assigned_user_id, c.label, u.name AS assigned_name,
      (SELECT COUNT(*) FROM email_inbox i
         WHERE i.user_id = c.data_owner_id AND i.status = 'awaiting_card'
           AND json_extract(i.parsed_json, '$.card_last4') = c.last4) AS waiting
    FROM cards c
    LEFT JOIN users u ON u.id = c.assigned_user_id
    WHERE c.data_owner_id = ?
    ORDER BY (c.assigned_user_id IS NOT NULL), c.last4
  `).all(ownerId);
  res.json({ cards, people: householdPeople(ownerId) });
});

// PATCH /api/household/cards/:last4 — přiřaď/přejmenuj kartu + uvolni zadržené platby
router.patch('/cards/:last4', requireAuth, writeLimiter, (req, res) => {
  const { ownerId } = roleOf(req.user.id);
  const last4 = String(req.params.last4).replace(/[^\d]/g, '').slice(-4);
  const { assigned_user_id = null, label } = req.body || {};
  const card = db.prepare('SELECT 1 FROM cards WHERE data_owner_id = ? AND last4 = ?').get(ownerId, last4);
  if (!card) return res.status(404).json({ error: 'Karta nenalezena.' });

  let assignTo = null;
  if (assigned_user_id != null) {
    assignTo = parseInt(assigned_user_id, 10);
    const ok = householdPeople(ownerId).some(p => p.user_id === assignTo);
    if (!ok) return res.status(400).json({ error: 'Uživatel není v domácnosti.' });
  }
  db.prepare('UPDATE cards SET assigned_user_id = ?, label = COALESCE(?, label) WHERE data_owner_id = ? AND last4 = ?')
    .run(assignTo, label != null ? String(label).slice(0, 60) : null, ownerId, last4);

  let released = 0;
  if (assignTo != null) released = releaseHeldCard(db, ownerId, last4);
  res.json({ ok: true, released });
});

module.exports = router;
