'use strict';
/**
 * Čistý rebuild Spendex DB z verzované konfigurace.
 * Env: DB_PATH (povinné), CSV_DIR (povinné), CONFIRM ('1' = ostrý běh; jinak dry-run + ROLLBACK).
 * Bez CONFIRM=1 se transakce vrátí (ROLLBACK) a vytiskne jen report.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { parseAirBankCSV } = require('../src/utils/csvParser');
const { buildExternalId } = require('../src/utils/externalId');
const applyRules = require('../src/utils/apply-rules');

const categories = require('./seed/categories');
const accounts = require('./seed/accounts');
const budgets = require('./seed/budgets');
const fixedExpenses = require('./seed/fixed-expenses');
const annual = require('./seed/annual');
const income = require('./seed/income');
const incomeSources = require('./seed/income-sources');
const rules = require('./seed/rules');

const DB_PATH = process.env.DB_PATH;
const CSV_DIR = process.env.CSV_DIR;
const CONFIRM = process.env.CONFIRM === '1';
const USER_ID = 1;

if (!DB_PATH || !CSV_DIR) {
  console.error('DB_PATH a CSV_DIR jsou povinné.');
  process.exit(1);
}

// ── Záloha (jen při ostrém běhu) ─────────────────────────────────────────────
if (CONFIRM) {
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const backup = path.join(path.dirname(DB_PATH), `backup-rebuild-${ts}.db`);
  const bdb = new Database(DB_PATH);
  bdb.exec(`VACUUM INTO '${backup}'`);
  bdb.close();
  const check = new Database(backup, { readonly: true });
  const n = check.prepare('SELECT COUNT(*) n FROM transactions').get().n;
  check.close();
  console.log(`📦 Záloha: ${backup} (transactions: ${n})`);
}

const db = new Database(DB_PATH);

// ── CSV soubor pro každý účet (auto-detekce dle čísla v názvu) ────────────────
const csvFiles = {};
for (const f of fs.readdirSync(CSV_DIR)) {
  const m = f.match(/airbank_(\d+)/);
  if (m && f.endsWith('.csv')) csvFiles[m[1]] = path.join(CSV_DIR, f);
}

const report = {};

db.exec('BEGIN');
try {
  // 1. WIPE v FK-bezpečném pořadí
  for (const t of ['budget_items', 'annual_budgets', 'budgets', 'category_rules',
    'airbank_category_mappings', 'transactions', 'fixed_expenses', 'income', 'income_sources',
    'accounts', 'categories']) {
    db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(USER_ID);
  }

  // 2. SEED kategorie
  const insCat = db.prepare('INSERT INTO categories (user_id, name, type) VALUES (?, ?, ?)');
  for (const c of categories) insCat.run(USER_ID, c.name, c.type);
  const catId = {};
  for (const r of db.prepare('SELECT id, name FROM categories WHERE user_id = ?').all(USER_ID)) {
    catId[r.name] = r.id;
  }
  const needCat = (name) => {
    if (!catId[name]) throw new Error(`Seed odkazuje neexistující kategorii: ${name}`);
    return catId[name];
  };

  // 3. SEED účty
  const insAcc = db.prepare('INSERT INTO accounts (user_id, account_number, name, role) VALUES (?, ?, ?, ?)');
  for (const a of accounts) insAcc.run(USER_ID, a.account_number, a.name, a.role);
  const accByNum = {};
  for (const r of db.prepare('SELECT id, account_number FROM accounts WHERE user_id = ?').all(USER_ID)) {
    accByNum[r.account_number] = r.id;
  }

  // 4. SEED budgety (default)
  const insBud = db.prepare("INSERT INTO budgets (user_id, category_id, month, amount) VALUES (?, ?, 'default', ?)");
  for (const b of budgets) insBud.run(USER_ID, needCat(b.category), b.amount);

  // 5. SEED fixní výdaje
  const insFx = db.prepare('INSERT INTO fixed_expenses (user_id, name, amount, sort_order, match_pattern) VALUES (?, ?, ?, ?, ?)');
  for (const f of fixedExpenses) insFx.run(USER_ID, f.name, f.amount, f.sort_order, f.match_pattern || null);

  // 6. SEED roční budgety + položky
  const insAnn = db.prepare('INSERT INTO annual_budgets (user_id, category_id, amount) VALUES (?, ?, ?)');
  for (const a of annual.annualBudgets) insAnn.run(USER_ID, needCat(a.category), a.amount);
  const insItem = db.prepare('INSERT INTO budget_items (user_id, category_id, name, amount, window_start, window_end) VALUES (?, ?, ?, ?, ?, ?)');
  for (const i of annual.budgetItems) insItem.run(USER_ID, needCat(i.category), i.name, i.amount, i.window_start, i.window_end);

  // 7. SEED příjmy
  const insInc = db.prepare('INSERT INTO income (user_id, person, amount, period) VALUES (?, ?, ?, ?)');
  for (const i of income) insInc.run(USER_ID, i.person, i.amount, i.period);

  const insIncSrc = db.prepare('INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, sort_order) VALUES (?, ?, ?, ?, ?)');
  for (const s of incomeSources) insIncSrc.run(USER_ID, s.person, s.planned_amount, s.match_pattern, s.sort_order);

  // 8. SEED pravidla do DB (L2 → airbank_category_mappings, L3 → category_rules)
  const insMap = db.prepare('INSERT INTO airbank_category_mappings (user_id, ab_category, category_id) VALUES (?, ?, ?)');
  for (const [ab, cat] of Object.entries(rules.abCategoryMap)) insMap.run(USER_ID, ab, needCat(cat));
  const insRule = db.prepare('INSERT INTO category_rules (user_id, category_id, pattern) VALUES (?, ?, ?)');
  for (const o of rules.textOverrides) insRule.run(USER_ID, needCat(o.category), o.pattern);

  // 9. IMPORT transakcí
  const insTx = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (user_id, category_id, amount, currency, date, description, note, source,
       external_id, tx_time, tx_type, counterparty_account, entered_by, place, account_id, ab_category)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank', ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let imported = 0;
  const byCat = {};
  for (const a of accounts) {
    const file = csvFiles[a.account_number];
    if (!file) { report[`CSV chybí: ${a.name}`] = a.account_number; continue; }
    const txs = parseAirBankCSV(fs.readFileSync(file, 'utf-8'));
    const accId = accByNum[a.account_number];
    for (const t of txs) {
      const catName = applyRules(t, a, rules);
      const cId = needCat(catName);
      // external_id rozlišený per účet kvůli UNIQUE(user_id, external_id) a interním převodům.
      // Pozn.: bez ref. čísla je NULL → SQLite NULL je v UNIQUE distinktní, takže taková
      // tx by se při opakovaném běhu duplikovala. AirBank CSV ref. číslo vždy má (0 duplicit).
      const extId = buildExternalId(t.external_id, a.account_number);
      const res = insTx.run(USER_ID, cId, t.amount, t.currency, t.date,
        t.description, t.note || '', extId, t.tx_time || null, t.tx_type || null,
        t.counterparty_account || null, t.entered_by || null, t.place || null, accId,
        t.ab_category || null);
      if (res.changes > 0) { imported++; byCat[catName] = (byCat[catName] || 0) + 1; }
    }
  }
  report['importováno'] = imported;
  report['dle kategorie'] = byCat;

  // 10. VERIFIKACE
  const q1 = db.prepare('SELECT COUNT(*) n, ROUND(SUM(amount)) net FROM transactions WHERE user_id=?').get(USER_ID);
  const prevody = db.prepare("SELECT COUNT(*) n FROM transactions t JOIN categories c ON c.id=t.category_id WHERE t.user_id=? AND c.name='Převody'").get(USER_ID).n;
  const dead = db.prepare('SELECT COUNT(*) n FROM transactions t WHERE t.user_id=? AND t.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.id=t.category_id)').get(USER_ID).n;
  report['verifikace'] = {
    categories: db.prepare('SELECT COUNT(*) n FROM categories WHERE user_id=?').get(USER_ID).n,
    accounts: db.prepare('SELECT COUNT(*) n FROM accounts WHERE user_id=?').get(USER_ID).n,
    transactions: q1.n,
    net: q1.net,
    prevody: prevody,
    fixed_expenses: db.prepare('SELECT COUNT(*) n FROM fixed_expenses WHERE user_id=?').get(USER_ID).n,
    income: db.prepare('SELECT COUNT(*) n FROM income WHERE user_id=?').get(USER_ID).n,
    income_sources: db.prepare('SELECT COUNT(*) n FROM income_sources WHERE user_id=?').get(USER_ID).n,
    dead_category_fk: dead,
  };

  if (CONFIRM) { db.exec('COMMIT'); console.log('✅ COMMIT (ostrý běh)'); }
  else { db.exec('ROLLBACK'); console.log('🧪 ROLLBACK (dry-run; pro ostrý běh nastav CONFIRM=1)'); }
} catch (e) {
  try { db.exec('ROLLBACK'); } catch { /* žádná aktivní transakce */ }
  console.error('❌ CHYBA, ROLLBACK:', e.message);
  try { db.close(); } catch { /* connection už zavřená */ }
  process.exit(1);
}

db.close();
console.log(JSON.stringify(report, null, 2));
