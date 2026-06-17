'use strict';
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAdmin } = require('../middleware/auth');
const { isValidEmail, normalizeEmail } = require('../utils/allowlist');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/admin/allowlist — seznam povolených e-mailů + kdo je admin
router.get('/allowlist', requireAdmin, (req, res) => {
  const entries = db.prepare(`
    SELECT ae.id, ae.email, ae.created_at,
           u.id AS user_id, u.name, u.is_admin
    FROM allowed_emails ae
    LEFT JOIN users u ON u.email = ae.email COLLATE NOCASE
    ORDER BY ae.created_at ASC, ae.id ASC
  `).all();
  res.json({ entries });
});

// POST /api/admin/allowlist { email } — přidá e-mail na allowlist
router.post('/allowlist', requireAdmin, writeLimiter, (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Neplatný e-mail.' });
  const existing = db.prepare('SELECT id FROM allowed_emails WHERE email = ? COLLATE NOCASE').get(email);
  if (existing) return res.status(409).json({ error: 'Tento e-mail už je na seznamu.' });
  const r = db.prepare('INSERT INTO allowed_emails (email, added_by) VALUES (?, ?)').run(email, req.user.id);
  res.json({ ok: true, id: r.lastInsertRowid, email });
});

// DELETE /api/admin/allowlist/:id — odebere e-mail ze seznamu
// (neodebírá existující účet ani jeho přístup — jen brání budoucímu (re)založení)
router.delete('/allowlist/:id', requireAdmin, writeLimiter, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Neplatné id.' });
  const row = db.prepare('SELECT email FROM allowed_emails WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  // Nedovol odebrat e-mail admina (byl by to matoucí no-op — admin má přístup i tak).
  const adminUser = db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND is_admin = 1').get(row.email);
  if (adminUser) return res.status(409).json({ error: 'E-mail administrátora nelze odebrat.' });
  db.prepare('DELETE FROM allowed_emails WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
