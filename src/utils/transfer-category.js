'use strict';
// Vrátí NÁZEV kategorie interních převodů daného uživatele, nebo null.
// Marker je type=4 (účetní kategorie), NE název — proto přejmenování kategorie
// v UI nerozbije L0 detekci interních převodů. Viz apply-rules.js (L0) a
// categorize()/import.js, které tímto názvem plní rules.internalTransferCategory.
function transferCategoryName(db, userId) {
  const row = db
    .prepare('SELECT name FROM categories WHERE user_id = ? AND type = 4 ORDER BY id ASC LIMIT 1')
    .get(userId);
  return row ? row.name : null;
}
module.exports = transferCategoryName;
