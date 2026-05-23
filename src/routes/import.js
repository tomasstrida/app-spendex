const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { parseAirBankCSV } = require('../utils/csvParser');
const { buildExternalId } = require('../utils/externalId');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// POST /api/import/preview
router.post('/preview', requireAuth, express.text({ limit: '10mb', type: '*/*' }), (req, res) => {
  try {
    const transactions = parseAirBankCSV(req.body);
    if (!transactions.length) return res.status(400).json({ error: 'CSV neobsahuje žádné transakce.' });

    const existingRefs = new Set();
    for (const r of db.prepare('SELECT external_id FROM transactions WHERE user_id = ? AND external_id IS NOT NULL').all(req.user.id)) {
      const v = r.external_id;
      existingRefs.add(v);
      const dash = v.lastIndexOf('-');
      if (dash > 0) existingRefs.add(v.slice(0, dash));
    }

    const parsed = transactions.map(t => ({
      ...t,
      duplicate: t.external_id ? existingRefs.has(t.external_id) : false,
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
router.post('/confirm', requireAuth, express.json({ limit: '10mb' }), (req, res) => {
  const { transactions, category_map = {}, skip_incoming = true, account_id = null, raw_csv = null, filename = null } = req.body;
  if (!Array.isArray(transactions)) return res.status(400).json({ error: 'Neplatná data.' });

  if (!account_id) {
    return res.status(400).json({ error: 'Vyberte účet, na který se transakce importují.' });
  }

  // Ověř že account_id patří tomuto uživateli
  let resolvedAccountId = null;
  let resolvedAccountNumber = null;
  if (account_id) {
    const acc = db.prepare('SELECT id, account_number FROM accounts WHERE id = ? AND user_id = ?').get(account_id, req.user.id);
    if (!acc) return res.status(400).json({ error: 'Neplatný účet.' });
    resolvedAccountId = acc.id;
    resolvedAccountNumber = acc.account_number || null;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (user_id, category_id, amount, currency, date, description, note, source, external_id,
       tx_time, tx_type, counterparty_account, entered_by, place, account_id, ab_category)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank', ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const upsertMapping = db.prepare(`
    INSERT INTO airbank_category_mappings (user_id, ab_category, category_id)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, ab_category) DO UPDATE SET category_id = excluded.category_id
  `);

  let imported = 0;
  let skipped = 0;
  let archiveStatus = null; // 'new' | 'duplicate' | null (když chybí raw_csv)

  // Autoritativní sada již uložených external_id pro tohoto uživatele
  const existingIds = new Set(
    db.prepare('SELECT external_id FROM transactions WHERE user_id = ? AND external_id IS NOT NULL')
      .all(req.user.id)
      .map(r => r.external_id)
  );

  db.transaction(() => {
    for (const t of transactions) {
      if (skip_incoming && t.direction === 'Příchozí') { skipped++; continue; }

      const extId = buildExternalId(t.external_id, resolvedAccountNumber);

      // Autoritativní dedup přes kanonické external_id
      if (extId && existingIds.has(extId)) { skipped++; continue; }

      const categoryId = category_map[t.ab_category] || null;
      const result = insert.run(
        req.user.id, categoryId, t.amount, t.currency, t.date,
        t.description, t.note || '', extId || null,
        t.tx_time || null, t.tx_type || null,
        t.counterparty_account || null, t.entered_by || null, t.place || null,
        resolvedAccountId, t.ab_category || null,
      );
      if (result.changes > 0) {
        imported++;
        if (extId) existingIds.add(extId);
      } else {
        skipped++;
      }
    }

    // Ulož mapování pro všechny AB kategorie kde bylo přiřazení
    for (const [abCat, catId] of Object.entries(category_map)) {
      if (catId) upsertMapping.run(req.user.id, abCat, parseInt(catId));
    }

    // Archivace originálu CSV (per soubor, dedup přes UNIQUE(user_id, file_hash))
    if (raw_csv && filename) {
      const hash = crypto.createHash('sha256').update(raw_csv).digest('hex');
      const result = db.prepare(`
        INSERT OR IGNORE INTO csv_archive
          (user_id, filename, source, account_id, content, file_hash, parsed_tx_count)
        VALUES (?, ?, 'airbank', ?, ?, ?, ?)
      `).run(req.user.id, filename, resolvedAccountId, raw_csv, hash, imported);
      archiveStatus = result.changes > 0 ? 'new' : 'duplicate';
    }
  })();

  res.json({ imported, skipped, archive: archiveStatus });
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

// GET /api/import/archive – seznam archivovaných CSV pro uživatele
router.get('/archive', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.filename, a.source, a.account_id, a.uploaded_at,
           a.file_hash, a.parsed_tx_count, LENGTH(a.content) AS size_bytes,
           acc.name AS account_name
    FROM csv_archive a
    LEFT JOIN accounts acc ON acc.id = a.account_id
    WHERE a.user_id = ?
    ORDER BY a.uploaded_at DESC, a.id DESC
  `).all(req.user.id);
  res.json(rows);
});

// GET /api/import/archive/:id/download – stáhne originál CSV
router.get('/archive/:id/download', requireAuth, (req, res) => {
  const row = db.prepare('SELECT filename, content FROM csv_archive WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${row.filename.replace(/"/g, '')}"`);
  res.send(row.content);
});

// DELETE /api/import/archive/:id – smaže záznam archivu (transakce zůstávají)
router.delete('/archive/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT id FROM csv_archive WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  db.prepare('DELETE FROM csv_archive WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
