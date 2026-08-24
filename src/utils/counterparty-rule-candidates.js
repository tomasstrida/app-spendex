'use strict';
// Detekce kandidátů na pravidlo podle PROTIÚČTU (ne textu) — stejný princip jako
// scripts/suggest-rules-from-history.cjs (coverage + purity), ale klíčováno přes
// counterparty_account. Používá se reaktivně (jeden protiúčet po ručním approve)
// i dávkově (celá historie ze stránky Pravidla).
const normalizeAccount = require('./normalize-account');

const MIN_COVERAGE = 3;
const MIN_PURITY = 0.90;

// Dominantní kategorie a její podíl v seznamu transakcí.
function topCategory(list) {
  const counts = new Map();
  for (const r of list) counts.set(r.category_id, (counts.get(r.category_id) || 0) + 1);
  let topCat = null, topN = 0;
  for (const [catId, n] of counts) if (n > topN) { topN = n; topCat = catId; }
  return { topCat, purity: list.length ? topN / list.length : 0 };
}

function findCounterpartyRuleCandidates(db, userId, { onlyCounterpartyAccount } = {}) {
  // Fetch all transactions without SQL-level counterparty filtering. Normalization
  // happens in JS below to avoid one-sided comparison (raw DB vs. normalized filter).
  const rows = db.prepare(`
    SELECT counterparty_account, category_id, subcategory_id, amount
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
  // Systémové účetní kategorie (Převody interní, dobití fondu, nákup předplacených
  // balíčků). Do nich platba nepatří podle PROTISTRANY, ale podle toho, co ta
  // konkrétní platba znamená: převody řeší identita účtu ve vrstvě L0, dobití fondu
  // i nákup balíčku jsou vědomá jednorázová rozhodnutí. Stejnému dodavateli přitom
  // zaplatíš jednou balíček a jindy jedno vstupné — bezesměrové trvalé pravidlo by
  // tenhle rozdíl zahodilo.
  const systemCategories = new Set(
    db.prepare('SELECT id FROM categories WHERE user_id = ? AND type = 4').all(userId).map(c => c.id)
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

    // Purity se počítá UVNITŘ dominantního směru platby. Ojedinělá vratka od
    // dodavatele (jiná kategorie, opačné znaménko) jinak trvale sráží skóre pod
    // práh a protiúčet se nikdy nenavrhne — viz ČSSZ: 8× odchozí „Mimo systém"
    // + 1× příchozí přeplatek v „Příjmech" = 0,889 < 0,90.
    // Samotné pravidlo zůstává bezesměrové (vratka má padnout do stejné
    // kategorie jako výdaj) — mění se jen skórování kandidáta.
    const outgoing = list.filter(r => r.amount < 0);
    const incoming = list.filter(r => r.amount >= 0);
    const major = outgoing.length >= incoming.length ? outgoing : incoming;
    const minor = major === outgoing ? incoming : outgoing;
    if (major.length < MIN_COVERAGE) continue;

    const { topCat, purity } = topCategory(major);
    if (systemCategories.has(topCat)) continue;
    if (purity < MIN_PURITY) continue;

    // Když má i opačný směr vlastní silný vzorec s JINOU kategorií, je protiúčet
    // nejednoznačný (platím i dostávám) — bezesměrové pravidlo by jeden ze
    // směrů přeštítkovalo špatně, takže radši nenavrhujeme nic.
    if (minor.length >= MIN_COVERAGE && topCategory(minor).topCat !== topCat) continue;

    const subCounts = new Map();
    for (const r of major) {
      if (r.category_id !== topCat || r.subcategory_id == null) continue;
      subCounts.set(r.subcategory_id, (subCounts.get(r.subcategory_id) || 0) + 1);
    }
    let topSub = null, topSubN = 0;
    for (const [subId, n] of subCounts) if (n > topSubN) { topSubN = n; topSub = subId; }

    candidates.push({
      counterparty_account: cp,
      category_id: topCat,
      subcategory_id: topSub,
      coverage_count: major.length,
      purity,
    });
  }
  return candidates;
}

module.exports = { findCounterpartyRuleCandidates, MIN_COVERAGE, MIN_PURITY };
