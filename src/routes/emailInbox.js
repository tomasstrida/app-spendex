'use strict';
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/email-inbox — čekající (pending) i nerozpoznané (unparsed) položky
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.received_at, i.raw_text, i.parsed_json, i.external_id,
           i.suggested_category_id, i.status, i.created_at,
           c.name AS suggested_category_name, c.color AS suggested_category_color
    FROM email_inbox i
    LEFT JOIN categories c ON c.id = i.suggested_category_id
    WHERE i.user_id = ? AND i.status IN ('pending', 'unparsed')
    ORDER BY i.created_at DESC, i.id DESC
  `).all(req.user.id);
  res.json(rows);
});

// POST /api/email-inbox/:id/approve { category_id } — zařadí pending položku do transactions
router.post('/:id/approve', requireAuth, writeLimiter, (req, res) => {
  const { category_id = null } = req.body || {};
  const row = db.prepare("SELECT * FROM email_inbox WHERE id = ? AND user_id = ? AND status = 'pending'")
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Položka nenalezena.' });
  if (!row.parsed_json) return res.status(400).json({ error: 'Položku nelze zařadit (nerozpoznaná).' });

  const tx = JSON.parse(row.parsed_json);
  // category_id z UI má přednost; jinak navržená kategorie
  let categoryId = category_id ? parseInt(category_id) : row.suggested_category_id;
  if (categoryId) {
    const ok = db.prepare('SELECT 1 FROM categories WHERE id = ? AND user_id = ?').get(categoryId, req.user.id);
    if (!ok) return res.status(400).json({ error: 'Neplatná kategorie.' });
  }

  const result = db.transaction(() => {
    const r = db.prepare(`INSERT OR IGNORE INTO transactions
        (user_id, category_id, amount, currency, date, description, note, source, external_id,
         tx_time, tx_type, counterparty_account, entered_by, place, account_id, ab_category)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank-email', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, categoryId || null, tx.amount, tx.currency, tx.date, tx.description,
           tx.note || '', row.external_id || null, tx.tx_time || null, tx.tx_type || null,
           tx.counterparty_account || null, tx.entered_by || null, tx.place || null,
           tx.account_id || null, tx.ab_category || null);
    // Idempotence: status nastavíme 'imported' i když INSERT OR IGNORE nic nevložil
    // (transakce už existuje, např. ze souběžného CSV importu se shodným external_id).
    // Cíl uživatele je splněn → položku z fronty odebíráme tak jako tak.
    db.prepare("UPDATE email_inbox SET status = 'imported' WHERE id = ?").run(row.id);
    return r;
  })();

  res.json({ ok: true, imported: result.changes > 0 });
});

// DELETE /api/email-inbox/:id — zahodí položku (pending i unparsed)
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT id FROM email_inbox WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Položka nenalezena.' });
  db.prepare("UPDATE email_inbox SET status = 'rejected' WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

module.exports = router;
