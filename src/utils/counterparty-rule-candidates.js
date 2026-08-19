'use strict';
// Detekce kandidátů na pravidlo podle PROTIÚČTU (ne textu) — stejný princip jako
// scripts/suggest-rules-from-history.cjs (coverage + purity), ale klíčováno přes
// counterparty_account. Používá se reaktivně (jeden protiúčet po ručním approve)
// i dávkově (celá historie ze stránky Pravidla).
const normalizeAccount = require('./normalize-account');

const MIN_COVERAGE = 3;
const MIN_PURITY = 0.90;

function findCounterpartyRuleCandidates(db, userId, { onlyCounterpartyAccount } = {}) {
  // Fetch all transactions without SQL-level counterparty filtering. Normalization
  // happens in JS below to avoid one-sided comparison (raw DB vs. normalized filter).
  const rows = db.prepare(`
    SELECT counterparty_account, category_id, subcategory_id
    FROM transactions
    WHERE user_id = @userId AND category_id IS NOT NULL
      AND counterparty_account IS NOT NULL AND counterparty_account != ''
  `).all({ userId });

  const ownAccounts = new Set(
    db.prepare('SELECT account_number FROM accounts WHERE user_id = ?').all(userId)
      .map(a => normalizeAccount(a.account_number)).filter(Boolean)
  );
  const existingRuleAccounts = new Set(
    db.prepare(`SELECT match_counterparty_account FROM category_rules
                WHERE user_id = ? AND match_counterparty_account IS NOT NULL`).all(userId)
      .map(r => normalizeAccount(r.match_counterparty_account))
  );
  const resolvedAccounts = new Set(
    db.prepare(`SELECT counterparty_account FROM rule_suggestions
                WHERE user_id = ? AND status IN ('approved', 'dismissed')`).all(userId)
      .map(r => normalizeAccount(r.counterparty_account))
  );

  const groups = new Map(); // normalizovaný protiúčet -> pole řádků
  for (const r of rows) {
    const cp = normalizeAccount(r.counterparty_account);
    if (!groups.has(cp)) groups.set(cp, []);
    groups.get(cp).push(r);
  }

  // Apply onlyCounterpartyAccount filter in JS after normalization.
  if (onlyCounterpartyAccount) {
    const only = normalizeAccount(onlyCounterpartyAccount);
    for (const cp of [...groups.keys()]) if (cp !== only) groups.delete(cp);
  }

  const candidates = [];
  for (const [cp, list] of groups) {
    if (ownAccounts.has(cp) || existingRuleAccounts.has(cp) || resolvedAccounts.has(cp)) continue;
    const total = list.length;
    if (total < MIN_COVERAGE) continue;

    const catCounts = new Map();
    for (const r of list) catCounts.set(r.category_id, (catCounts.get(r.category_id) || 0) + 1);
    let topCat = null, topN = 0;
    for (const [catId, n] of catCounts) if (n > topN) { topN = n; topCat = catId; }
    const purity = topN / total;
    if (purity < MIN_PURITY) continue;

    const subCounts = new Map();
    for (const r of list) {
      if (r.category_id !== topCat || r.subcategory_id == null) continue;
      subCounts.set(r.subcategory_id, (subCounts.get(r.subcategory_id) || 0) + 1);
    }
    let topSub = null, topSubN = 0;
    for (const [subId, n] of subCounts) if (n > topSubN) { topSubN = n; topSub = subId; }

    candidates.push({
      counterparty_account: cp,
      category_id: topCat,
      subcategory_id: topSub,
      coverage_count: total,
      purity,
    });
  }
  return candidates;
}

module.exports = { findCounterpartyRuleCandidates, MIN_COVERAGE, MIN_PURITY };
