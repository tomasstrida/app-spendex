'use strict';
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { normCounterparty } = require('../utils/income');

// Kategorie vyloučené z revize: „Mimo systém" (vědomě mimo evidenci) a
// „Pravidelné platby" (fixní, počítané přes matcher jinde). Pozn.: vyloučení
// podle názvu je křehčí — do budoucna případně příznak přímo na kategorii.
const EXCLUDED_CATEGORIES = ['Mimo systém', 'Pravidelné platby'];

// GET /api/review/misplaced — výdaje s reálnou kategorií (typ 1/2/3) na účtu
// s rolí 'ignored', které nejsou interní převod ani odložené. „Omylem na
// špatném účtu" — SPENDING_FILTER je jinak ze všech výpočtů vyřadí.
router.get('/misplaced', requireAuth, (req, res) => {
  const ownNums = new Set(
    db.prepare('SELECT account_number FROM accounts WHERE user_id = ?')
      .all(req.dataUserId)
      .map(a => normCounterparty(a.account_number))
      .filter(Boolean)
  );
  const ph = EXCLUDED_CATEGORIES.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT t.id, t.date, t.description, t.place, t.amount, t.note, t.counterparty_account,
           t.category_id, c.name AS category_name, c.color AS category_color, c.type AS category_type,
           t.account_id, a.name AS account_name
    FROM transactions t
    JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
    JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
    WHERE t.user_id = ? AND t.amount < 0 AND t.review_dismissed = 0
      AND a.role = 'ignored'
      AND c.type IN (1, 2, 3)
      AND c.name NOT IN (${ph})
    ORDER BY t.amount ASC, t.date DESC
  `).all(req.dataUserId, ...EXCLUDED_CATEGORIES);

  // Vyloučit interní převody (counterparty = některé z vlastních čísel účtů).
  const filtered = rows.filter(r => {
    const cp = normCounterparty(r.counterparty_account);
    return !(cp && ownNums.has(cp));
  });
  res.json(filtered);
});

function setDismissed(req, res, value) {
  const id = Number(req.body?.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Chybí id transakce.' });
  const r = db.prepare('UPDATE transactions SET review_dismissed = ? WHERE id = ? AND user_id = ?')
    .run(value, id, req.dataUserId);
  if (r.changes === 0) return res.status(404).json({ error: 'Transakce nenalezena.' });
  res.json({ ok: true });
}

// POST /api/review/dismiss { id } — „Nechat, je to OK" (skryje z revize).
router.post('/dismiss', requireAuth, (req, res) => setDismissed(req, res, 1));
// POST /api/review/undismiss { id } — vrátí zpět do revize.
router.post('/undismiss', requireAuth, (req, res) => setDismissed(req, res, 0));

module.exports = router;
