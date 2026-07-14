'use strict';
// Čistá funkce: (tx, account, rules) → { category, subcategory_id }.
// Precedence: L0 Převody → L3 text → L1 účet → L2 AB → fallback.

function normalizeAccount(raw) {
  if (!raw) return '';
  return String(raw).split('/')[0].replace(/\s/g, '').replace(/^0+/, '');
}

function applyRules(tx, account, rules) {
  // L0 – interní převod
  const cp = normalizeAccount(tx.counterparty_account);
  if (cp && rules.ownAccountNumbers.includes(cp)) {
    return { category: rules.internalTransferCategory, subcategory_id: null };
  }

  // L3 – text override (popis + note, case-insensitive substring).
  // Volitelné amount_max_abs / amount_min_abs zužují match podle absolutní částky
  // (užitečné pro „benzinky < 200 Kč = občerstvení, ne PHM" apod.).
  const hay = `${tx.description || ''} ${tx.note || ''} ${tx.place || ''}`.toLowerCase();
  const absAmount = Math.abs(tx.amount);
  for (const o of rules.textOverrides) {
    if (!hay.includes(o.pattern.toLowerCase())) continue;
    if (o.amount_max_abs != null && absAmount > o.amount_max_abs) continue;
    if (o.amount_min_abs != null && absAmount < o.amount_min_abs) continue;
    return { category: o.category, subcategory_id: o.subcategory_id ?? null };
  }

  // L1 – účetní pravidlo
  if (account && rules.accountRules[account.account_number]) {
    return { category: rules.accountRules[account.account_number], subcategory_id: null };
  }

  // L2 – AB kategorie
  const ab = (tx.ab_category || '').trim();
  if (rules.abCategoryMap[ab]) return { category: rules.abCategoryMap[ab], subcategory_id: null };

  // fallback
  return { category: rules.fallbackCategory, subcategory_id: null };
}

module.exports = applyRules;
