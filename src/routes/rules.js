const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { ownsSubcategory: ownsSubcategoryShared } = require('../utils/subcategory-ownership');
const { findCounterpartyRuleCandidates } = require('../utils/counterparty-rule-candidates');
const { upsertRuleSuggestions, getSuggestion, listPendingSuggestions } = require('../services/ruleSuggestions');
const { recategorizePending } = require('../services/emailIngest');

// Návrhové routy jedou přes limiter — /suggestions/scan projíždí celou historii.
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// Ověří, že kategorie patří uživateli
function ownsCategory(userId, categoryId) {
  return !!db.prepare('SELECT 1 FROM categories WHERE id = ? AND user_id = ?').get(categoryId, userId);
}

// Ověří, že subkategorie patří uživateli A spadá pod danou kategorii
function ownsSubcategory(userId, subcategoryId, categoryId) {
  return ownsSubcategoryShared(db, userId, subcategoryId, categoryId);
}

// Volitelná částka: '' / undefined / null → null; jinak kladné číslo nebo {ok:false}
function parseAmount(v) {
  if (v === undefined || v === null || String(v).trim() === '') return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

// Volitelné ID subkategorie: '' / undefined / null → null; jinak celé číslo nebo {ok:false} (NaN apod.)
function parseOptionalId(v) {
  if (v === undefined || v === null || String(v).trim() === '') return { ok: true, value: null };
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return { ok: false };
  return { ok: true, value: n };
}

// GET /api/rules
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.pattern, r.category_id, r.amount_max_abs, r.amount_min_abs,
           r.subcategory_id, sc.name AS subcategory_name,
           r.match_counterparty_account, r.match_account_id,
           c.name AS category_name, c.color AS category_color
    FROM category_rules r
    JOIN categories c ON c.id = r.category_id
    LEFT JOIN subcategories sc ON sc.id = r.subcategory_id AND sc.user_id = r.user_id
    WHERE r.user_id = ?
    ORDER BY (r.amount_max_abs IS NOT NULL OR r.amount_min_abs IS NOT NULL) DESC, r.id ASC
  `).all(req.dataUserId);
  res.json(rows);
});

// POST /api/rules
router.post('/', requireAuth, (req, res) => {
  const pattern = (req.body.pattern || '').trim();
  const categoryId = parseInt(req.body.category_id);
  if (!pattern || !categoryId) return res.status(400).json({ error: 'Vyplň text a kategorii.' });
  if (!ownsCategory(req.dataUserId, categoryId)) return res.status(400).json({ error: 'Neplatná kategorie.' });
  const max = parseAmount(req.body.amount_max_abs);
  const min = parseAmount(req.body.amount_min_abs);
  if (!max.ok || !min.ok) return res.status(400).json({ error: 'Neplatná částka.' });
  if (max.value != null && min.value != null && min.value > max.value)
    return res.status(400).json({ error: 'Minimální částka nesmí být větší než maximální.' });
  const subParsed = parseOptionalId(req.body.subcategory_id);
  if (!subParsed.ok) return res.status(400).json({ error: 'Neplatná subkategorie pro tuto kategorii.' });
  const subId = subParsed.value;
  if (subId != null && !ownsSubcategory(req.dataUserId, subId, categoryId))
    return res.status(400).json({ error: 'Neplatná subkategorie pro tuto kategorii.' });
  const info = db.prepare(
    'INSERT INTO category_rules (user_id, category_id, pattern, amount_max_abs, amount_min_abs, subcategory_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.dataUserId, categoryId, pattern, max.value, min.value, subId);
  const row = db.prepare('SELECT * FROM category_rules WHERE id = ?').get(info.lastInsertRowid);
  res.json(row);
});

// PATCH /api/rules/:id
router.patch('/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM category_rules WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!existing) return res.status(404).json({ error: 'Pravidlo nenalezeno.' });
  const pattern = (req.body.pattern ?? existing.pattern).trim();
  const categoryId = req.body.category_id != null ? parseInt(req.body.category_id) : existing.category_id;
  if (!pattern || !categoryId) return res.status(400).json({ error: 'Vyplň text a kategorii.' });
  if (!ownsCategory(req.dataUserId, categoryId)) return res.status(400).json({ error: 'Neplatná kategorie.' });
  const max = 'amount_max_abs' in req.body ? parseAmount(req.body.amount_max_abs) : { ok: true, value: existing.amount_max_abs };
  const min = 'amount_min_abs' in req.body ? parseAmount(req.body.amount_min_abs) : { ok: true, value: existing.amount_min_abs };
  if (!max.ok || !min.ok) return res.status(400).json({ error: 'Neplatná částka.' });
  if (max.value != null && min.value != null && min.value > max.value)
    return res.status(400).json({ error: 'Minimální částka nesmí být větší než maximální.' });
  let subId = existing.subcategory_id;
  if ('subcategory_id' in req.body) {
    const subParsed = parseOptionalId(req.body.subcategory_id);
    if (!subParsed.ok) return res.status(400).json({ error: 'Neplatná subkategorie pro tuto kategorii.' });
    subId = subParsed.value;
  }
  if (subId != null && !ownsSubcategory(req.dataUserId, subId, categoryId))
    return res.status(400).json({ error: 'Neplatná subkategorie pro tuto kategorii.' });
  db.prepare('UPDATE category_rules SET pattern = ?, category_id = ?, amount_max_abs = ?, amount_min_abs = ?, subcategory_id = ? WHERE id = ?')
    .run(pattern, categoryId, max.value, min.value, subId, existing.id);
  res.json(db.prepare('SELECT * FROM category_rules WHERE id = ?').get(existing.id));
});

// DELETE /api/rules/:id
router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id FROM category_rules WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Pravidlo nenalezeno.' });
  db.prepare('DELETE FROM category_rules WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// GET /api/rules/suggestions — pending návrhy pravidel (protiúčet → kategorie)
router.get('/suggestions', requireAuth, writeLimiter, (req, res) => {
  res.json(listPendingSuggestions(db, req.dataUserId));
});

// POST /api/rules/suggestions/scan — projede celou historii, založí/aktualizuje pending návrhy
router.post('/suggestions/scan', requireAuth, writeLimiter, (req, res) => {
  const candidates = findCounterpartyRuleCandidates(db, req.dataUserId);
  const ids = upsertRuleSuggestions(db, req.dataUserId, candidates);
  res.json({ ok: true, found: ids.length });
});

// POST /api/rules/suggestions/:id/approve — založí category_rules pravidlo z návrhu
router.post('/suggestions/:id/approve', requireAuth, writeLimiter, (req, res) => {
  const s = getSuggestion(db, req.dataUserId, req.params.id);
  if (!s) return res.status(404).json({ error: 'Návrh nenalezen.' });
  if (s.status !== 'pending') return res.status(400).json({ error: 'Návrh už je vyřešený.' });
  const info = db.prepare(`INSERT INTO category_rules
      (user_id, category_id, pattern, match_counterparty_account, subcategory_id)
      VALUES (?, ?, '', ?, ?)`)
    .run(req.dataUserId, s.category_id, s.counterparty_account, s.subcategory_id);
  db.prepare("UPDATE rule_suggestions SET status = 'approved', resolved_at = datetime('now') WHERE id = ?").run(s.id);
  // Nové pravidlo platí i zpětně na frontu — jinak by uživatel musel zbylé platby
  // téhož protiúčtu doklikat ručně, což je přesně ta bolest, kterou feature řeší.
  // Best-effort: selhání nesmí shodit už provedené schválení pravidla.
  let recategorized = 0;
  try {
    recategorized = recategorizePending(db, req.dataUserId);
  } catch (e) {
    console.error('[rule-suggestions] recategorizePending po approve:', e && e.message);
  }
  res.json({ ok: true, rule_id: Number(info.lastInsertRowid), recategorized });
});

// POST /api/rules/suggestions/:id/dismiss — trvale zamítne návrh, žádné re-navrhování
router.post('/suggestions/:id/dismiss', requireAuth, writeLimiter, (req, res) => {
  const s = getSuggestion(db, req.dataUserId, req.params.id);
  if (!s) return res.status(404).json({ error: 'Návrh nenalezen.' });
  if (s.status !== 'pending') return res.status(400).json({ error: 'Návrh už je vyřešený.' });
  db.prepare("UPDATE rule_suggestions SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ?").run(s.id);
  res.json({ ok: true });
});

module.exports = router;
