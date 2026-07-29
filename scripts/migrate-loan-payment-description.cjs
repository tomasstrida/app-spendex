'use strict';
/**
 * Retroaktivně doplní popis u e-mailových plateb BEZ protiúčtu (inkaso, splátka
 * půjčky, poplatek) a přeřadí je podle textových pravidel.
 *
 * Důvod: do generického fallbacku v parseru (2026-07-29) neuměl parser vytáhnout
 * holý popisný řádek z bloku „Pro úplnost uvádíme detaily této úhrady:" — např.
 * „Splátka půjčky Půjčka 1". Takové transakce mají prázdný `description`, `note`
 * i `place` → nechytí je textová category_rules ani matcher fixních plateb na
 * Schůzce. Nové importy to od té verze řeší samy; tento skript srovná historii.
 *
 * Zdroj pravdy je `email_inbox.raw_text` (drží se i po zařazení do transakcí),
 * takže se popis nehádá — přeparsuje se aktuálním parserem.
 *
 * Zpracuje:
 *   status='imported'  → UPDATE transactions (párování přes external_id) —
 *                        description + category_id podle applyRules
 *   status='pending'   → UPDATE email_inbox.parsed_json + suggested_category_id
 *
 * Mění jen řádky, kde je dnes popis prázdný a nový parser vrátí neprázdný.
 *
 * Env:
 *   DB_PATH   povinné, cesta k SQLite
 *   CONFIRM   '1' = ostrý běh (UPDATE), jinak dry-run (jen výpis)
 */
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const { parseEmailNotification } = require(path.join(ROOT, 'src/utils/emailParser'));
const applyRules = require(path.join(ROOT, 'src/utils/apply-rules'));
const loadUserRules = require(path.join(ROOT, 'src/utils/load-user-rules'));
const seedRules = require(path.join(ROOT, 'scripts/seed/rules'));
const transferCategoryName = require(path.join(ROOT, 'src/utils/transfer-category'));

const DB_PATH = process.env.DB_PATH;
const CONFIRM = process.env.CONFIRM === '1';

if (!DB_PATH) {
  console.error('DB_PATH je povinný.');
  process.exit(1);
}

const db = new Database(DB_PATH);

// Kategorie podle stejných pravidel, jaká používá emailIngest.categorize().
function categoryFor(userId, tx, accountNumber) {
  const rules = { ...seedRules, textOverrides: loadUserRules(db, userId) };
  const transferName = transferCategoryName(db, userId);
  if (transferName) rules.internalTransferCategory = transferName;
  const { category } = applyRules(tx, accountNumber ? { account_number: accountNumber } : null, rules);
  const row = db.prepare('SELECT id, name FROM categories WHERE user_id = ? AND name = ?').get(userId, category);
  return { name: category, id: row ? row.id : null, isFallback: category === rules.fallbackCategory };
}

const inbox = db.prepare(`
  SELECT id, user_id, external_id, raw_text, parsed_json, status, suggested_category_id
  FROM email_inbox
  WHERE status IN ('imported', 'pending') AND raw_text IS NOT NULL AND TRIM(raw_text) != ''
  ORDER BY id DESC
`).all();

const txPlan = [];    // { txId, description, categoryId, ...log }
const inboxPlan = [];  // { inboxId, parsedJson, categoryId, ...log }

for (const row of inbox) {
  const tx = parseEmailNotification(row.raw_text);
  if (!tx || !tx.description || !tx.description.trim()) continue;

  if (row.status === 'imported') {
    // external_id v transactions nese suffix účtu (buildExternalId) → hledáme LIKE.
    const hits = db.prepare(`
      SELECT t.id, t.description, t.date, t.amount, t.category_id, t.account_id, c.name AS cat_name, a.account_number
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.user_id = ? AND (t.external_id = ? OR t.external_id LIKE ? || '%')
    `).all(row.user_id, row.external_id, tx.external_id);
    for (const t of hits) {
      if (t.description && t.description.trim()) continue;  // popis už má → nesahat
      const cat = categoryFor(row.user_id, tx, t.account_number);
      txPlan.push({
        txId: t.id, userId: row.user_id, date: t.date, amount: t.amount,
        description: tx.description,
        oldCat: t.cat_name || '— bez kat. —',
        newCatId: cat.id, newCatName: cat.name,
        changeCat: cat.id != null && cat.id !== t.category_id && !cat.isFallback,
      });
    }
    continue;
  }

  // pending — v review frontě; oprav parsed_json a návrh kategorie
  let parsed = {};
  try { parsed = JSON.parse(row.parsed_json || '{}'); } catch { parsed = {}; }
  if (parsed.description && String(parsed.description).trim()) continue;
  const accNum = parsed.account_id
    ? (db.prepare('SELECT account_number FROM accounts WHERE id = ?').get(parsed.account_id) || {}).account_number
    : null;
  const cat = categoryFor(row.user_id, tx, accNum);
  inboxPlan.push({
    inboxId: row.id, userId: row.user_id, date: tx.date, amount: tx.amount,
    description: tx.description,
    parsedJson: JSON.stringify({ ...parsed, description: tx.description }),
    newCatId: cat.id, newCatName: cat.name,
  });
}

console.log(`Zaúčtované transakce k opravě: ${txPlan.length}`);
for (const p of txPlan) {
  const cat = p.changeCat ? `${p.oldCat} → ${p.newCatName}` : `${p.oldCat} (beze změny)`;
  console.log(`  tx#${p.txId} | ${p.date} | ${p.amount} Kč | popis: "${p.description}" | kat: ${cat}`);
}
console.log(`\nPoložky v review frontě k opravě: ${inboxPlan.length}`);
for (const p of inboxPlan) {
  console.log(`  inbox#${p.inboxId} | ${p.date} | ${p.amount} Kč | popis: "${p.description}" | návrh kat.: ${p.newCatName}`);
}

if (!CONFIRM) {
  console.log('\n🧪 Dry-run – nic se nezměnilo. Pro ostrý běh nastav CONFIRM=1.');
  process.exit(0);
}

if (txPlan.length === 0 && inboxPlan.length === 0) {
  console.log('Nic k úpravě.');
  process.exit(0);
}

const setDescOnly = db.prepare('UPDATE transactions SET description = ? WHERE id = ?');
const setDescCat = db.prepare('UPDATE transactions SET description = ?, category_id = ? WHERE id = ?');
const setInbox = db.prepare('UPDATE email_inbox SET parsed_json = ?, suggested_category_id = ? WHERE id = ?');

db.transaction(() => {
  for (const p of txPlan) {
    if (p.changeCat) setDescCat.run(p.description, p.newCatId, p.txId);
    else setDescOnly.run(p.description, p.txId);
  }
  for (const p of inboxPlan) setInbox.run(p.parsedJson, p.newCatId, p.inboxId);
})();

console.log(`\n✅ Hotovo: ${txPlan.length} transakcí, ${inboxPlan.length} položek fronty.`);
