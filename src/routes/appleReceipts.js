const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { applyReceiptToTransaction } = require('../services/appleReceipts');
const { matchesReceipt } = require('../utils/appleMatch');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

function toReceipt(row) {
  return {
    receipt_date: row.receipt_date,
    total_amount: row.total_amount,
    card_last4: row.card_last4,
    is_refund: !!row.is_refund,
    items: row.items_json ? JSON.parse(row.items_json) : [],
  };
}

// Kandidáti k ručnímu výběru: Apple platby v širším okně, seřazené podle data.
function candidatesFor(userId, row) {
  if (!row.receipt_date) return [];
  const rows = db.prepare(`
    SELECT id, date, amount, description, card_last4
    FROM transactions
    WHERE user_id = ?
      AND (UPPER(COALESCE(description,'')) LIKE 'APPLE.COM%'
        OR UPPER(COALESCE(place,'')) LIKE 'APPLE.COM%')
      AND date >= date(?, '-10 days') AND date <= date(?, '+10 days')
    ORDER BY date DESC, id DESC
  `).all(userId, row.receipt_date, row.receipt_date);
  const receipt = toReceipt(row);
  // Nejdřív ti, co splňují párovací pravidla, pak zbytek jako záloha pro ruční volbu.
  const fits = rows.filter(t => matchesReceipt(t, receipt));
  const rest = rows.filter(t => !fits.includes(t));
  return [...fits, ...rest].slice(0, 10);
}

// GET /api/apple-receipts?status=…
router.get('/', requireAuth, (req, res) => {
  const status = req.query.status || 'all';
  const params = [req.dataUserId];
  let where = 'user_id = ?';
  if (status !== 'all') { where += ' AND status = ?'; params.push(status); }

  const rows = db.prepare(`SELECT * FROM apple_receipts WHERE ${where} ORDER BY receipt_date DESC, id DESC`)
    .all(...params);

  res.json({
    receipts: rows.map(row => ({
      ...row,
      items: row.items_json ? JSON.parse(row.items_json) : [],
      candidates: (row.status === 'pending' || row.status === 'ambiguous')
        ? candidatesFor(req.dataUserId, row) : [],
    })),
  });
});

// POST /api/apple-receipts/:id/match — ruční přiřazení k transakci
router.post('/:id/match', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM apple_receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Faktura nenalezena.' });

  const tx = db.prepare('SELECT id FROM transactions WHERE id = ? AND user_id = ?')
    .get(req.body.transaction_id, req.dataUserId);
  if (!tx) return res.status(404).json({ error: 'Transakce nenalezena.' });

  applyReceiptToTransaction(db, req.dataUserId, toReceipt(row), tx.id);
  db.prepare("UPDATE apple_receipts SET status = 'matched', transaction_id = ?, matched_at = datetime('now') WHERE id = ?")
    .run(tx.id, row.id);

  res.json(db.prepare('SELECT * FROM apple_receipts WHERE id = ?').get(row.id));
});

// POST /api/apple-receipts/:id/unmatch — odpojení (poznámka u transakce zůstává)
router.post('/:id/unmatch', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM apple_receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Faktura nenalezena.' });
  db.prepare("UPDATE apple_receipts SET status = 'pending', transaction_id = NULL, matched_at = NULL WHERE id = ?")
    .run(row.id);
  res.json(db.prepare('SELECT * FROM apple_receipts WHERE id = ?').get(row.id));
});

// DELETE /api/apple-receipts/:id — zahození (záznam zůstává kvůli idempotenci)
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT id FROM apple_receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Faktura nenalezena.' });
  db.prepare("UPDATE apple_receipts SET status = 'rejected' WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

module.exports = router;
