const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { parseAirBankCSV } = require('../utils/csvParser');

// POST /api/import/preview
// Body: text/plain (CSV obsah)
router.post('/preview', requireAuth, express.text({ limit: '10mb', type: '*/*' }), (req, res) => {
  try {
    const transactions = parseAirBankCSV(req.body);
    if (!transactions.length) return res.status(400).json({ error: 'CSV neobsahuje žádné transakce.' });

    // Zjisti které external_id už existují (duplicity)
    const existingIds = new Set(
      db.prepare('SELECT external_id FROM transactions WHERE user_id = ? AND external_id IS NOT NULL')
        .all(req.user.id)
        .map(r => r.external_id)
    );

    // Označ duplicity
    const parsed = transactions.map(t => ({
      ...t,
      duplicate: t.external_id ? existingIds.has(t.external_id) : false,
    }));

    // Unikátní Air Bank kategorie
    const abCategories = [...new Set(parsed.map(t => t.ab_category).filter(Boolean))].sort();

    res.json({ transactions: parsed, ab_categories: abCategories });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/import/confirm
// Body: { transactions: [...], category_map: { "Restaurace": 3, "Nákupy": 5 } }
router.post('/confirm', requireAuth, (req, res) => {
  const { transactions, category_map = {}, skip_incoming = true } = req.body;
  if (!Array.isArray(transactions)) return res.status(400).json({ error: 'Neplatná data.' });

  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (user_id, category_id, amount, currency, date, description, note, source, external_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank', ?)
  `);

  let imported = 0;
  let skipped = 0;

  const importAll = db.transaction(() => {
    for (const t of transactions) {
      if (t.duplicate) { skipped++; continue; }
      if (skip_incoming && t.direction === 'Příchozí') { skipped++; continue; }

      const categoryId = category_map[t.ab_category] || null;
      const result = insert.run(
        req.user.id,
        categoryId,
        t.amount,
        t.currency,
        t.date,
        t.description,
        t.note || '',
        t.external_id || null,
      );
      if (result.changes > 0) imported++;
      else skipped++;
    }
  });

  importAll();
  res.json({ imported, skipped });
});

module.exports = router;
