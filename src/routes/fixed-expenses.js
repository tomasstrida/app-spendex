const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

const { fixedExpensesForPeriod } = require('../utils/fixed-expenses');
const { parseAccountNumberField } = require('../utils/account-number');

const PERIOD_RE = /^\d{4}-\d{2}$/;
// Normalizuje vstup okna platnosti: '' / null / undefined → null, jinak trimovaný
// string; vrací { value } nebo { error } při špatném formátu.
function parsePeriodField(raw, label) {
  if (raw == null || String(raw).trim() === '') return { value: null };
  const v = String(raw).trim();
  if (!PERIOD_RE.test(v)) return { error: `${label} musí být ve formátu RRRR-MM.` };
  const month = parseInt(v.slice(5), 10);
  if (month < 1 || month > 12) return { error: `${label}: měsíc musí být 01–12.` };
  return { value: v };
}

// GET /api/fixed-expenses?period=YYYY-MM
router.get('/', requireAuth, (req, res) => {
  res.json(fixedExpensesForPeriod(db, req.dataUserId, req.query.period));
});

// POST /api/fixed-expenses
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { name, amount, note, sort_order, match_pattern, match_counterparty_account, amount_min, amount_max, frequency_months, valid_from, valid_to } = req.body;
  if (!name || amount == null) return res.status(400).json({ error: 'Název a částka jsou povinné.' });
  const pattern = match_pattern && match_pattern.trim() ? match_pattern.trim() : null;
  const cpParsed = parseAccountNumberField(match_counterparty_account, 'Číslo účtu příjemce');
  if (cpParsed.error) return res.status(400).json({ error: cpParsed.error });
  const cpAccount = cpParsed.value;
  if (!pattern && !cpAccount) return res.status(400).json({ error: 'Zadej text v popisu nebo číslo účtu příjemce.' });
  const min = amount_min != null ? parseFloat(amount_min) : null;
  const max = amount_max != null ? parseFloat(amount_max) : null;
  if (min != null && max != null && min > max) return res.status(400).json({ error: 'Min nesmí být větší než max.' });
  const freq = frequency_months != null ? Math.max(1, parseInt(frequency_months, 10) || 1) : 1;
  const vf = parsePeriodField(valid_from, 'Platí od');
  if (vf.error) return res.status(400).json({ error: vf.error });
  const vt = parsePeriodField(valid_to, 'Platí do');
  if (vt.error) return res.status(400).json({ error: vt.error });
  if (vf.value && vt.value && vf.value > vt.value) return res.status(400).json({ error: '„Platí od" nesmí být později než „Platí do".' });
  const result = db.prepare(
    'INSERT INTO fixed_expenses (user_id, name, amount, note, sort_order, match_pattern, match_counterparty_account, amount_min, amount_max, frequency_months, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.dataUserId, name.trim(), parseFloat(amount), note || null, sort_order ?? 0,
    pattern, cpAccount, min, max, freq, vf.value, vt.value);
  res.status(201).json(db.prepare('SELECT * FROM fixed_expenses WHERE id = ?').get(result.lastInsertRowid));
});

// PATCH /api/fixed-expenses/:id
router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  const { name, amount, note, sort_order, match_pattern, match_counterparty_account, amount_min, amount_max, frequency_months, valid_from, valid_to } = req.body;
  const min = amount_min !== undefined ? (amount_min != null ? parseFloat(amount_min) : null) : row.amount_min;
  const max = amount_max !== undefined ? (amount_max != null ? parseFloat(amount_max) : null) : row.amount_max;
  if (min != null && max != null && min > max) return res.status(400).json({ error: 'Min nesmí být větší než max.' });
  const pattern = match_pattern !== undefined ? (match_pattern && match_pattern.trim() ? match_pattern.trim() : null) : row.match_pattern;
  let cpAccount = row.match_counterparty_account;
  if (match_counterparty_account !== undefined) {
    const cpParsed = parseAccountNumberField(match_counterparty_account, 'Číslo účtu příjemce');
    if (cpParsed.error) return res.status(400).json({ error: cpParsed.error });
    cpAccount = cpParsed.value;
  }
  if (!pattern && !cpAccount) return res.status(400).json({ error: 'Zadej text v popisu nebo číslo účtu příjemce.' });
  let vfValue = row.valid_from;
  if (valid_from !== undefined) {
    const vf = parsePeriodField(valid_from, 'Platí od');
    if (vf.error) return res.status(400).json({ error: vf.error });
    vfValue = vf.value;
  }
  let vtValue = row.valid_to;
  if (valid_to !== undefined) {
    const vt = parsePeriodField(valid_to, 'Platí do');
    if (vt.error) return res.status(400).json({ error: vt.error });
    vtValue = vt.value;
  }
  if (vfValue && vtValue && vfValue > vtValue) return res.status(400).json({ error: '„Platí od" nesmí být později než „Platí do".' });
  db.prepare('UPDATE fixed_expenses SET name = ?, amount = ?, note = ?, sort_order = ?, match_pattern = ?, match_counterparty_account = ?, amount_min = ?, amount_max = ?, frequency_months = ?, valid_from = ?, valid_to = ? WHERE id = ?').run(
    name ?? row.name,
    amount != null ? parseFloat(amount) : row.amount,
    note !== undefined ? (note || null) : row.note,
    sort_order ?? row.sort_order,
    pattern, cpAccount,
    min, max,
    frequency_months !== undefined ? Math.max(1, parseInt(frequency_months, 10) || 1) : row.frequency_months,
    vfValue, vtValue,
    row.id
  );
  res.json(db.prepare('SELECT * FROM fixed_expenses WHERE id = ?').get(row.id));
});

// DELETE /api/fixed-expenses/:id
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  db.prepare('DELETE FROM fixed_expenses WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
