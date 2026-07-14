'use strict';

// Ověří, že subkategorie patří danému uživateli A spadá pod danou kategorii.
// Sdíleno mezi routes/rules.js a routes/transactions.js, aby obě místa
// používala stejnou (user_id, category_id) validaci proti data-isolation
// a nekonzistenci sub/kategorie.
function ownsSubcategory(db, userId, subcategoryId, categoryId) {
  return !!db.prepare('SELECT 1 FROM subcategories WHERE id = ? AND user_id = ? AND category_id = ?')
    .get(subcategoryId, userId, categoryId);
}

module.exports = { ownsSubcategory };
