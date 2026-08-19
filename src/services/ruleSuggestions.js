'use strict';
// Perzistence návrhů pravidel (rule_suggestions). Scoring dělá
// src/utils/counterparty-rule-candidates.js — tohle je čistě zápis/čtení.

const SELECT_WITH_NAMES = `
  SELECT s.id, s.counterparty_account, s.category_id, s.subcategory_id,
         s.coverage_count, s.purity, s.status, s.created_at,
         c.name AS category_name, c.color AS category_color,
         sc.name AS subcategory_name
  FROM rule_suggestions s
  JOIN categories c ON c.id = s.category_id
  LEFT JOIN subcategories sc ON sc.id = s.subcategory_id
`;

// Uloží/aktualizuje kandidáty jako pending návrhy. Kandidát, jehož protiúčet už
// byl approved/dismissed, se přeskočí (trvalé rozhodnutí, žádné re-navrhování).
// Vrací ID nově vytvořených/aktualizovaných PENDING návrhů.
function upsertRuleSuggestions(db, userId, candidates) {
  const find = db.prepare('SELECT id, status FROM rule_suggestions WHERE user_id = ? AND counterparty_account = ?');
  const insert = db.prepare(`INSERT INTO rule_suggestions
      (user_id, counterparty_account, category_id, subcategory_id, coverage_count, purity)
      VALUES (?, ?, ?, ?, ?, ?)`);
  const update = db.prepare(`UPDATE rule_suggestions
      SET category_id = ?, subcategory_id = ?, coverage_count = ?, purity = ? WHERE id = ?`);
  const ids = [];
  for (const c of candidates) {
    const existing = find.get(userId, c.counterparty_account);
    if (existing && existing.status !== 'pending') continue;
    if (existing) {
      update.run(c.category_id, c.subcategory_id, c.coverage_count, c.purity, existing.id);
      ids.push(existing.id);
    } else {
      const info = insert.run(userId, c.counterparty_account, c.category_id, c.subcategory_id, c.coverage_count, c.purity);
      ids.push(Number(info.lastInsertRowid));
    }
  }
  return ids;
}

function getSuggestion(db, userId, id) {
  return db.prepare(`${SELECT_WITH_NAMES} WHERE s.id = ? AND s.user_id = ?`).get(id, userId);
}

function listPendingSuggestions(db, userId) {
  return db.prepare(`${SELECT_WITH_NAMES} WHERE s.user_id = ? AND s.status = 'pending' ORDER BY s.coverage_count DESC`).all(userId);
}

module.exports = { upsertRuleSuggestions, getSuggestion, listPendingSuggestions };
