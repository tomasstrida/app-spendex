'use strict';
// Čistá funkce: (tx, account, rules) → název kategorie.
// Precedence: L0 Převody → L3 text → L1 účet → L2 AB → fallback.

function normalizeAccount(raw) {
  if (!raw) return '';
  return String(raw).split('/')[0].replace(/\s/g, '').replace(/^0+/, '');
}

function applyRules(tx, account, rules) {
  // L0 – interní převod
  const cp = normalizeAccount(tx.counterparty_account);
  if (cp && rules.ownAccountNumbers.includes(cp)) {
    return rules.internalTransferCategory;
  }

  // L3 – text override (popis + note, case-insensitive substring)
  const hay = `${tx.description || ''} ${tx.note || ''}`.toLowerCase();
  for (const o of rules.textOverrides) {
    if (hay.includes(o.pattern.toLowerCase())) return o.category;
  }

  // L1 – účetní pravidlo
  if (account && rules.accountRules[account.account_number]) {
    return rules.accountRules[account.account_number];
  }

  // L2 – AB kategorie
  const ab = (tx.ab_category || '').trim();
  if (rules.abCategoryMap[ab]) return rules.abCategoryMap[ab];

  // fallback
  return rules.fallbackCategory;
}

module.exports = applyRules;
