const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { parseAirBankCSV } = require('../utils/csvParser');

// POST /api/import/preview
router.post('/preview', requireAuth, express.text({ limit: '10mb', type: '*/*' }), (req, res) => {
  try {
    const transactions = parseAirBankCSV(req.body);
    if (!transactions.length) return res.status(400).json({ error: 'CSV neobsahuje žádné transakce.' });

    const existingIds = new Set(
      db.prepare('SELECT external_id FROM transactions WHERE user_id = ? AND external_id IS NOT NULL')
        .all(req.user.id)
        .map(r => r.external_id)
    );

    const parsed = transactions.map(t => ({
      ...t,
      duplicate: t.external_id ? existingIds.has(t.external_id) : false,
    }));

    const abCategories = [...new Set(parsed.map(t => t.ab_category).filter(Boolean))].sort();

    // Načti uložená mapování pro tohoto uživatele
    const mappingRows = db.prepare(
      'SELECT ab_category, category_id FROM airbank_category_mappings WHERE user_id = ?'
    ).all(req.user.id);
    const savedMappings = {};
    mappingRows.forEach(r => { savedMappings[r.ab_category] = r.category_id; });

    // Detekce účtu: najdi čísla účtů /3030 z protistrany – kandidáti jsou vlastní účty v DB
    const counterpartyNums = new Set(
      parsed
        .map(t => t.counterparty_account?.match(/^(\d+)\/\d+/)?.[1])
        .filter(Boolean)
    );
    const userAccounts = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY name ASC').all(req.user.id);
    // Účty jejichž číslo se NEVYSKYTUJE jako protistrana jsou kandidáti na zdrojový účet
    const candidates = userAccounts.filter(a => a.account_number && !counterpartyNums.has(a.account_number));

    res.json({
      transactions: parsed,
      ab_categories: abCategories,
      saved_mappings: savedMappings,
      accounts: userAccounts,
      detected_account_ids: candidates.map(a => a.id),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/import/confirm
router.post('/confirm', requireAuth, (req, res) => {
  const { transactions, category_map = {}, skip_incoming = true, account_id = null } = req.body;
  if (!Array.isArray(transactions)) return res.status(400).json({ error: 'Neplatná data.' });

  // Ověř že account_id patří tomuto uživateli
  let resolvedAccountId = null;
  if (account_id) {
    const acc = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(account_id, req.user.id);
    if (!acc) return res.status(400).json({ error: 'Neplatný účet.' });
    resolvedAccountId = acc.id;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (user_id, category_id, amount, currency, date, description, note, source, external_id,
       tx_time, tx_type, counterparty_account, entered_by, place, account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank', ?, ?, ?, ?, ?, ?, ?)
  `);

  const upsertMapping = db.prepare(`
    INSERT INTO airbank_category_mappings (user_id, ab_category, category_id)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, ab_category) DO UPDATE SET category_id = excluded.category_id
  `);

  let imported = 0;
  let skipped = 0;

  db.transaction(() => {
    for (const t of transactions) {
      if (t.duplicate) { skipped++; continue; }
      if (skip_incoming && t.direction === 'Příchozí') { skipped++; continue; }

      const categoryId = category_map[t.ab_category] || null;
      const result = insert.run(
        req.user.id, categoryId, t.amount, t.currency, t.date,
        t.description, t.note || '', t.external_id || null,
        t.tx_time || null, t.tx_type || null,
        t.counterparty_account || null, t.entered_by || null, t.place || null,
        resolvedAccountId,
      );
      if (result.changes > 0) imported++;
      else skipped++;
    }

    // Ulož mapování pro všechny AB kategorie kde bylo přiřazení
    for (const [abCat, catId] of Object.entries(category_map)) {
      if (catId) upsertMapping.run(req.user.id, abCat, parseInt(catId));
    }
  })();

  res.json({ imported, skipped });
});

// GET /api/import/mappings
router.get('/mappings', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT m.id, m.ab_category, m.category_id, c.name as category_name, c.color as category_color
    FROM airbank_category_mappings m
    JOIN categories c ON c.id = m.category_id
    WHERE m.user_id = ?
    ORDER BY m.ab_category ASC
  `).all(req.user.id);
  res.json(rows);
});

// PUT /api/import/mappings  — změna kategorie pro existující mapování
router.put('/mappings', requireAuth, (req, res) => {
  const { ab_category, category_id } = req.body;
  if (!ab_category || !category_id) return res.status(400).json({ error: 'Neplatná data.' });
  db.prepare(`
    INSERT INTO airbank_category_mappings (user_id, ab_category, category_id)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, ab_category) DO UPDATE SET category_id = excluded.category_id
  `).run(req.user.id, ab_category, parseInt(category_id));
  const row = db.prepare('SELECT * FROM airbank_category_mappings WHERE user_id = ? AND ab_category = ?')
    .get(req.user.id, ab_category);
  res.json(row);
});

// DELETE /api/import/mappings/:id
router.delete('/mappings/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id FROM airbank_category_mappings WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Mapování nenalezeno.' });
  db.prepare('DELETE FROM airbank_category_mappings WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
