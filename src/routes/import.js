const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { parseAirBankCSV } = require('../utils/csvParser');
const { buildExternalId } = require('../utils/externalId');
const applyRules = require('../utils/apply-rules');
const seedRules = require('../../scripts/seed/rules');
const loadUserRules = require('../utils/load-user-rules');
const transferCategoryName = require('../utils/transfer-category');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// POST /api/import/preview
router.post('/preview', requireAuth, writeLimiter, express.text({ limit: '2mb', type: '*/*' }), (req, res) => {
  try {
    const transactions = parseAirBankCSV(req.body);
    if (!transactions.length) return res.status(400).json({ error: 'CSV neobsahuje žádné transakce.' });
    if (transactions.length > 5000) return res.status(400).json({ error: 'Příliš velký výpis (> 5000 transakcí).' });

    const existingRefs = new Set();
    for (const r of db.prepare('SELECT external_id FROM transactions WHERE user_id = ? AND external_id IS NOT NULL').all(req.dataUserId)) {
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
    ).all(req.dataUserId);
    const savedMappings = {};
    mappingRows.forEach(r => { savedMappings[r.ab_category] = r.category_id; });

    // Detekce účtu: protistrany z výpisu (kompletní čísla vč. kódu banky) –
    // kandidáti jsou vlastní účty v DB, jejichž číslo se mezi protistranami nevyskytuje
    const counterpartyNums = new Set(
      parsed
        .map(t => t.counterparty_account?.replace(/\s/g, ''))
        .filter(Boolean)
    );
    const userAccounts = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY name ASC').all(req.dataUserId);
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
router.post('/confirm', requireAuth, writeLimiter, (req, res) => {
  const { transactions, category_map = {}, skip_incoming = false, account_id = null, raw_csv = null, filename = null } = req.body;
  if (!Array.isArray(transactions)) return res.status(400).json({ error: 'Neplatná data.' });
  if (transactions.length > 5000) return res.status(400).json({ error: 'Příliš mnoho transakcí (> 5000).' });

  if (!account_id) {
    return res.status(400).json({ error: 'Vyberte účet, na který se transakce importují.' });
  }

  // Ověř že account_id patří tomuto uživateli
  let resolvedAccountId = null;
  let resolvedAccountNumber = null;
  if (account_id) {
    const acc = db.prepare('SELECT id, account_number FROM accounts WHERE id = ? AND user_id = ?').get(account_id, req.dataUserId);
    if (!acc) return res.status(400).json({ error: 'Neplatný účet.' });
    resolvedAccountId = acc.id;
    resolvedAccountNumber = acc.account_number || null;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (user_id, category_id, subcategory_id, amount, currency, date, description, note, source, external_id,
       tx_time, tx_type, counterparty_account, entered_by, place, account_id, ab_category, variable_symbol, card_last4)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'airbank', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      .all(req.dataUserId)
      .map(r => r.external_id)
  );

  // Pravidla pro autokategorizaci (L0/L1/L2/L3). category_map z UI = user-override
  // AB mapování pro tento import, mergne se přes seedovou abCategoryMap (user vyhrává
  // pro stejnou AB kategorii, ale L3 textOverrides – vč. benzinky <200 – mají přednost
  // před L2). Lookup name→id per user, ať se nemusí dělat v každé iteraci.
  const userMapName = {};
  if (category_map && typeof category_map === 'object') {
    const ids = Object.values(category_map).filter(Boolean).map(Number);
    if (ids.length > 0) {
      const ph = ids.map(() => '?').join(',');
      const rows = db.prepare(`SELECT id, name FROM categories WHERE user_id = ? AND id IN (${ph})`)
        .all(req.dataUserId, ...ids);
      const nameById = Object.fromEntries(rows.map(r => [r.id, r.name]));
      for (const [ab, cid] of Object.entries(category_map)) {
        if (cid && nameById[cid]) userMapName[ab] = nameById[cid];
      }
    }
  }
  const transferName = transferCategoryName(db, req.dataUserId);
  const effectiveRules = {
    ...seedRules,
    // type=4 marker, ne hardcoded název → odolné vůči přejmenování kategorie převodů
    ...(transferName ? { internalTransferCategory: transferName } : {}),
    textOverrides: loadUserRules(db, req.dataUserId),
    abCategoryMap: { ...seedRules.abCategoryMap, ...userMapName },
  };
  const catIdByName = Object.fromEntries(
    db.prepare('SELECT id, name FROM categories WHERE user_id = ?').all(req.dataUserId)
      .map(r => [r.name, r.id])
  );
  const account = resolvedAccountNumber ? { account_number: resolvedAccountNumber } : null;

  db.transaction(() => {
    for (const t of transactions) {
      if (skip_incoming && t.direction === 'Příchozí') { skipped++; continue; }

      const extId = buildExternalId(t.external_id, resolvedAccountNumber);

      // Autoritativní dedup přes kanonické external_id
      if (extId && existingIds.has(extId)) { skipped++; continue; }

      // Kategorizace: applyRules vrací { category, subcategory_id } (precedence L0>L3>L1>L2>fallback).
      // Pokud kategorie u tohoto usera neexistuje (např. nový user bez seedu), padne na null.
      const { category: catName, subcategory_id } = applyRules(t, account, effectiveRules);
      const categoryId = catIdByName[catName] || null;
      const result = insert.run(
        req.dataUserId, categoryId, subcategory_id ?? null, t.amount, t.currency, t.date,
        t.description, t.note || '', extId || null,
        t.tx_time || null, t.tx_type || null,
        t.counterparty_account || null, t.entered_by || null, t.place || null,
        resolvedAccountId, t.ab_category || null, t.variable_symbol || null, t.card_last4 || null,
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
      if (catId) upsertMapping.run(req.dataUserId, abCat, parseInt(catId));
    }

    // Archivace originálu CSV (per soubor, dedup přes UNIQUE(user_id, file_hash))
    if (raw_csv && filename) {
      const hash = crypto.createHash('sha256').update(raw_csv).digest('hex');
      const result = db.prepare(`
        INSERT OR IGNORE INTO csv_archive
          (user_id, filename, source, account_id, content, file_hash, parsed_tx_count)
        VALUES (?, ?, 'airbank', ?, ?, ?, ?)
      `).run(req.dataUserId, filename, resolvedAccountId, raw_csv, hash, imported);
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
  `).all(req.dataUserId);
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
  `).run(req.dataUserId, ab_category, parseInt(category_id));
  const row = db.prepare('SELECT * FROM airbank_category_mappings WHERE user_id = ? AND ab_category = ?')
    .get(req.dataUserId, ab_category);
  res.json(row);
});

// DELETE /api/import/mappings/:id
router.delete('/mappings/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id FROM airbank_category_mappings WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
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
  `).all(req.dataUserId);
  res.json(rows);
});

// GET /api/import/archive/:id/download – stáhne originál CSV
router.get('/archive/:id/download', requireAuth, (req, res) => {
  const row = db.prepare('SELECT filename, content FROM csv_archive WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  const safeName = String(row.filename || 'export.csv').replace(/[^\w.\- ]+/g, '_').slice(0, 100);
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.send(row.content);
});

// DELETE /api/import/archive/:id – smaže záznam archivu (transakce zůstávají)
router.delete('/archive/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT id FROM csv_archive WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  db.prepare('DELETE FROM csv_archive WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
