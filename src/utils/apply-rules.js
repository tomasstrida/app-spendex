'use strict';
// Čistá funkce: (tx, account, rules) → { category, subcategory_id }.
// Precedence: L3a (pravidlo s protiúčtem I účtem) → L0 Převody → L3 text → L1 účet → L2 AB → fallback.
const normalizeAccount = require('./normalize-account');

// Splňuje transakce všechny podmínky uživatelského pravidla (text / protiúčet / účet / částka)?
function overrideMatches(o, ctx) {
  const hasText = !!o.pattern;
  const hasCounterparty = !!o.match_counterparty_account;
  if (!hasText && !hasCounterparty) return false; // pravidlo bez podmínky nikdy nesedí
  if (hasText && !ctx.hay.includes(o.pattern.toLowerCase())) return false;
  if (hasCounterparty && ctx.cp !== normalizeAccount(o.match_counterparty_account)) return false;
  if (o.match_account_id != null && (!ctx.account || ctx.account.id !== o.match_account_id)) return false;
  if (o.amount_max_abs != null && ctx.absAmount > o.amount_max_abs) return false;
  if (o.amount_min_abs != null && ctx.absAmount < o.amount_min_abs) return false;
  return true;
}

function applyRules(tx, account, rules) {
  const cp = normalizeAccount(tx.counterparty_account);
  const ctx = {
    cp,
    account,
    hay: `${tx.description || ''} ${tx.note || ''} ${tx.place || ''}`.toLowerCase(),
    absAmount: Math.abs(tx.amount),
  };

  // L3a – pravidlo, které určuje protiúčet I účet, přebíjí i L0. Je tak specifické
  // („z účtu X na účet Y"), že jde o vědomou výjimku z automatiky interních převodů
  // (např. noha převodu OSVČ ↔ rezerva na daň, která má být Mimo systém).
  for (const o of rules.textOverrides) {
    if (!o.match_counterparty_account || o.match_account_id == null) continue;
    if (overrideMatches(o, ctx)) return { category: o.category, subcategory_id: o.subcategory_id ?? null };
  }

  // L0 – interní převod
  if (cp && rules.ownAccountNumbers.includes(cp)) {
    return { category: rules.internalTransferCategory, subcategory_id: null };
  }

  // L3 – text override a/nebo protiúčet (kombinovatelné = AND, když jsou obě).
  // Pravidlo bez patternu (prázdný string – counterparty-only) přeskočí textovou
  // podmínku; pravidlo bez match_counterparty_account přeskočí kontrolu protiúčtu.
  // Volitelné amount_max_abs / amount_min_abs zužují match podle absolutní částky.
  for (const o of rules.textOverrides) {
    if (overrideMatches(o, ctx)) return { category: o.category, subcategory_id: o.subcategory_id ?? null };
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
