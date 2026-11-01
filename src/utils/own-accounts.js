'use strict';
// Čísla vlastních účtů pro L0 (interní převod) v apply-rules: pevný seed
// (scripts/seed/rules.js) + všechny účty uživatele z tabulky `accounts`.
// Díky tomu nově založený účet funguje okamžitě, bez úpravy kódu — dřív účet,
// který nebyl v seedu, nebyl rozpoznán jako vlastní a jeho převody se zařazovaly
// podle AB kategorie (měsíc od měsíce jinak).
const normalizeAccount = require('./normalize-account');

function ownAccountNumbers(db, userId, seedList = []) {
  const set = new Set(seedList.map(normalizeAccount).filter(Boolean));
  const rows = db.prepare('SELECT account_number FROM accounts WHERE user_id = ?').all(userId);
  for (const r of rows) {
    const n = normalizeAccount(r.account_number);
    if (n) set.add(n);
  }
  return [...set];
}

module.exports = ownAccountNumbers;
