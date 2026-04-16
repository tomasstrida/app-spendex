const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { getPeriodDates, getUserBillingDay, currentPeriodKey } = require('../utils/period');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/budgets?period=2026-04
// Vrátí výchozí budgety s případnými přepsáními pro dané období.
router.get('/', requireAuth, (req, res) => {
  const billingDay = getUserBillingDay(db, req.user.id);
  const periodKey = req.query.period || currentPeriodKey(billingDay);
  const { start, end } = getPeriodDates(billingDay, periodKey);

  // Načti výchozí budgety + přepsání pro toto období
  const rows = db.prepare(`
    SELECT
      c.id as category_id, c.name as category_name, c.color as category_color, c.icon as category_icon, c.type as category_type,
      db.id       as default_id,
      db.amount   as default_amount,
      pb.id       as override_id,
      pb.amount   as override_amount,
      COALESCE(pb.amount, db.amount) as amount,
      CASE WHEN pb.id IS NOT NULL THEN 1 ELSE 0 END as is_override,
      COALESCE((
        SELECT SUM(ABS(t.amount))
        FROM transactions t
        WHERE t.user_id = db.user_id
          AND t.category_id = db.category_id
          AND t.date >= ? AND t.date <= ?
          AND t.amount < 0
          AND (t.account_id IS NULL OR EXISTS (
            SELECT 1 FROM accounts a WHERE a.id = t.account_id AND a.role = 'spending'
          ))
      ), 0) as spent
    FROM budgets db
    JOIN categories c ON c.id = db.category_id AND c.user_id = db.user_id
    LEFT JOIN budgets pb
      ON pb.category_id = db.category_id AND pb.user_id = db.user_id AND pb.month = ?
    WHERE db.user_id = ? AND db.month = 'default'
    ORDER BY c.name ASC
  `).all(start, end, periodKey, req.user.id);

  // id pro frontend = override_id pokud existuje, jinak default_id
  const budgets = rows.map(r => ({
    ...r,
    id: r.override_id ?? r.default_id,
  }));

  res.json({ period: periodKey, period_start: start, period_end: end, billing_day: billingDay, budgets });
});

// PUT /api/budgets
// body: { category_id, period, amount, scope }
// scope='all'  → aktualizuje default + smaže VŠECHNA period-přepsání pro tuto kategorii
// scope='from' → aktualizuje default + smaže přepsání >= period (budoucnost)
router.put('/', requireAuth, writeLimiter, (req, res) => {
  const { category_id, period, amount, scope = 'all' } = req.body;
  if (!category_id || !period || amount == null) return res.status(400).json({ error: 'category_id, period a amount jsou povinné.' });

  const cat = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(category_id, req.user.id);
  if (!cat) return res.status(404).json({ error: 'Kategorie nenalezena.' });

  db.prepare(`
    INSERT INTO budgets (user_id, category_id, month, amount)
    VALUES (?, ?, 'default', ?)
    ON CONFLICT(user_id, category_id, month) DO UPDATE SET amount = excluded.amount
  `).run(req.user.id, category_id, amount);

  if (scope === 'all') {
    // Smaž všechna period-přepsání pro tuto kategorii
    db.prepare(`DELETE FROM budgets WHERE user_id = ? AND category_id = ? AND month != 'default'`)
      .run(req.user.id, category_id);
  } else {
    // Smaž přepsání od tohoto období dál (month >= period, ale není 'default')
    db.prepare(`DELETE FROM budgets WHERE user_id = ? AND category_id = ? AND month != 'default' AND month >= ?`)
      .run(req.user.id, category_id, period);
  }

  const row = db.prepare(`SELECT * FROM budgets WHERE user_id = ? AND category_id = ? AND month = 'default'`)
    .get(req.user.id, category_id);
  res.json(row);
});

// DELETE /api/budgets/:id
// Smaže záznam (override i default). Pokud se smaže override, vrátí se výchozí.
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const budget = db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!budget) return res.status(404).json({ error: 'Rozpočet nenalezen.' });
  db.prepare('DELETE FROM budgets WHERE id = ?').run(budget.id);
  res.json({ ok: true, was_override: budget.month !== 'default' });
});

module.exports = router;
