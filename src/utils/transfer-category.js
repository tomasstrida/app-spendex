'use strict';
// Vrátí NÁZEV kategorie interních převodů daného uživatele, nebo null.
// Marker je type=4 (účetní kategorie), NE název — proto přejmenování kategorie
// v UI nerozbije L0 detekci interních převodů. Viz apply-rules.js (L0) a
// categorize()/import.js, které tímto názvem plní rules.internalTransferCategory.
// AND system_role IS NULL: type=4 už není unikátní marker jen pro převody – stejný
// type mají i systémové účetní kategorie (např. fund_topup). Ty se za kategorii
// převodů nikdy nesmí vydávat, i kdyby měly nižší id.
function transferCategoryName(db, userId) {
  const row = db
    .prepare('SELECT name FROM categories WHERE user_id = ? AND type = 4 AND system_role IS NULL ORDER BY id ASC LIMIT 1')
    .get(userId);
  return row ? row.name : null;
}
module.exports = transferCategoryName;
