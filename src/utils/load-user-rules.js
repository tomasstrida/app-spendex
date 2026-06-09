'use strict';
// Načte textová kategorizační pravidla uživatele z DB ve tvaru, který očekává
// applyRules v `rules.textOverrides`. Pravidla s podmínkou na částku jdou první
// (specifičtější výjimky jako „benzinky < 200"), pak podle pořadí vložení.
function loadUserRules(db, userId) {
  const rows = db.prepare(`
    SELECT r.pattern, r.amount_max_abs, r.amount_min_abs, c.name AS category
    FROM category_rules r
    JOIN categories c ON c.id = r.category_id
    WHERE r.user_id = ?
    ORDER BY (r.amount_max_abs IS NOT NULL OR r.amount_min_abs IS NOT NULL) DESC, r.id ASC
  `).all(userId);
  return rows.map(r => {
    const o = { pattern: r.pattern, category: r.category };
    if (r.amount_max_abs != null) o.amount_max_abs = r.amount_max_abs;
    if (r.amount_min_abs != null) o.amount_min_abs = r.amount_min_abs;
    return o;
  });
}
module.exports = loadUserRules;
