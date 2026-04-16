const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const VALID_ROLES = ['spending', 'fixed', 'ignored'];

// GET /api/accounts
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, account_number, name, role, created_at
    FROM accounts WHERE user_id = ? ORDER BY name ASC
  `).all(req.user.id);
  res.json(rows);
});

// POST /api/accounts
router.post('/', requireAuth, (req, res) => {
  const { name, role = 'spending', account_number = null } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Zadejte název účtu.' });
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Neplatná role.' });
  try {
    const result = db.prepare(`
      INSERT INTO accounts (user_id, account_number, name, role)
      VALUES (?, ?, ?, ?)
    `).run(req.user.id, account_number?.trim() || null, name.trim(), role);
    res.status(201).json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(400).json({ error: 'Účet s tímto číslem již existuje.' });
    throw e;
  }
});

// PATCH /api/accounts/:id
router.patch('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Účet nenalezen.' });
  const name = req.body.name?.trim() ?? row.name;
  const role = req.body.role ?? row.role;
  const account_number = 'account_number' in req.body
    ? (req.body.account_number?.trim() || null)
    : row.account_number;
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Neplatná role.' });
  try {
    db.prepare('UPDATE accounts SET name = ?, role = ?, account_number = ? WHERE id = ?')
      .run(name, role, account_number, row.id);
    res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(row.id));
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(400).json({ error: 'Účet s tímto číslem již existuje.' });
    throw e;
  }
});

// DELETE /api/accounts/:id
router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Účet nenalezen.' });
  db.prepare('UPDATE transactions SET account_id = NULL WHERE account_id = ?').run(row.id);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
