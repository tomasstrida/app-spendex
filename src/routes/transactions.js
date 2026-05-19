const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { findDuplicates, wouldEmptyDuplicateGroup } = require('../utils/duplicates');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/transactions?from=...&to=...&category_id=&category_ids=1,2,none&amount_min=&amount_max=&limit=&offset=
router.get('/', requireAuth, (req, res) => {
  const { from, to, category_id, category_ids, amount_min, amount_max, limit = 200, offset = 0 } = req.query;
  let query = 'SELECT t.*, c.name as category_name, c.color as category_color FROM transactions t LEFT JOIN categories c ON t.category_id = c.id WHERE t.user_id = ?';
  const params = [req.user.id];

  if (from) { query += ' AND t.date >= ?'; params.push(from); }
  if (to)   { query += ' AND t.date <= ?'; params.push(to); }

  if (category_ids) {
    const ids = String(category_ids).split(',').map(s => s.trim()).filter(Boolean);
    const hasNone = ids.includes('none');
    const numericIds = ids
      .filter(id => id !== 'none')
      .map(id => parseInt(id))
      .filter(n => Number.isFinite(n));
    const conditions = [];
    if (hasNone) conditions.push('t.category_id IS NULL');
    if (numericIds.length > 0) {
      const placeholders = numericIds.map(() => '?').join(',');
      conditions.push(`t.category_id IN (${placeholders})`);
      params.push(...numericIds);
    }
    if (conditions.length > 0) {
      query += ` AND (${conditions.join(' OR ')})`;
    }
  } else if (category_id === 'none') {
    query += ' AND t.category_id IS NULL';
  } else if (category_id) {
    query += ' AND t.category_id = ?';
    params.push(category_id);
  }

  if (amount_min !== undefined && amount_min !== '') {
    const v = parseFloat(amount_min);
    if (Number.isFinite(v)) { query += ' AND ABS(t.amount) >= ?'; params.push(v); }
  }
  if (amount_max !== undefined && amount_max !== '') {
    const v = parseFloat(amount_max);
    if (Number.isFinite(v)) { query += ' AND ABS(t.amount) <= ?'; params.push(v); }
  }

  query += ' ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// GET /api/transactions/duplicates
router.get('/duplicates', requireAuth, (req, res) => {
  res.json(findDuplicates(db, req.user.id));
});

// POST /api/transactions
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { amount, currency, date, description, note, category_id } = req.body;
  if (!amount || !date) return res.status(400).json({ error: 'Částka a datum jsou povinné.' });

  const result = db.prepare(
    'INSERT INTO transactions (user_id, category_id, amount, currency, date, description, note, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, category_id || null, amount, currency || 'CZK', date, description || '', note || '', 'manual');

  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

// PATCH /api/transactions/:id
router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!tx) return res.status(404).json({ error: 'Transakce nenalezena.' });

  const { amount, currency, date, description, note, category_id } = req.body;
  db.prepare(
    'UPDATE transactions SET amount = ?, currency = ?, date = ?, description = ?, note = ?, category_id = ? WHERE id = ?'
  ).run(
    amount ?? tx.amount,
    currency ?? tx.currency,
    date ?? tx.date,
    description ?? tx.description,
    note ?? tx.note,
    category_id !== undefined ? category_id : tx.category_id,
    tx.id
  );

  res.json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id));
});

// DELETE /api/transactions/:id
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!tx) return res.status(404).json({ error: 'Transakce nenalezena.' });
  db.prepare('DELETE FROM transactions WHERE id = ?').run(tx.id);
  res.json({ ok: true });
});

// DELETE /api/transactions  body: { ids: [1,2,3], guardDuplicateGroups?: true }
router.delete('/', requireAuth, writeLimiter, (req, res) => {
  const { ids, guardDuplicateGroups } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Neplatná data.' });
  if (guardDuplicateGroups && wouldEmptyDuplicateGroup(db, req.user.id, ids)) {
    return res.status(400).json({ error: 'Ve skupině duplicit musí zůstat alespoň jedna transakce.' });
  }
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(
    `DELETE FROM transactions WHERE id IN (${placeholders}) AND user_id = ?`
  ).run(...ids, req.user.id);
  res.json({ deleted: result.changes });
});

module.exports = router;
