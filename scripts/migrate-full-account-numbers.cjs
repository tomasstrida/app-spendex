'use strict';
/**
 * Migrace na KOMPLETNÍ čísla účtů (vč. kódu banky) v konfiguračních tabulkách.
 *
 * 1. accounts.account_number: bez '/' → doplní kód banky. Výchozí '/3030'
 *    (AirBank — všechny účty domácnosti), lze přepsat env BANK_CODE.
 * 2. income_sources.match_counterparty_account: bez '/' → dohledá kompletní
 *    číslo z transactions (unikátní protiúčet začínající "číslo/"); pokud
 *    kandidátů není přesně 1, řádek přeskočí a vypíše.
 * 3. fixed_expenses.match_counterparty_account: stejná logika jako income
 *    (aktuálně na prod už kompletní — jen pojistka).
 *
 * transactions.counterparty_account se NEMĚNÍ (už kompletní z banky).
 * external_id se NEMĚNÍ (perzistentní legacy klíč, viz utils/externalId.js).
 *
 * Dry-run výchozí; ostrý běh: CONFIRM=1 node scripts/migrate-full-account-numbers.cjs
 * Na prod: DB_PATH=/data/data.db, better-sqlite3 z /app/node_modules.
 */
const path = require('path');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data.db');
const BANK_CODE = process.env.BANK_CODE || '3030';
const CONFIRM = process.env.CONFIRM === '1';

let Database;
try { Database = require('better-sqlite3'); }
catch { Database = require('/app/node_modules/better-sqlite3'); }
const db = new Database(DB_PATH);

console.log(`DB: ${DB_PATH} | ${CONFIRM ? 'OSTRÝ BĚH' : 'DRY-RUN (spusť s CONFIRM=1 pro zápis)'}\n`);

// 1) accounts
const accounts = db.prepare(
  "SELECT id, name, account_number FROM accounts WHERE account_number IS NOT NULL AND account_number NOT LIKE '%/%'"
).all();
console.log(`accounts bez kódu banky: ${accounts.length}`);
for (const a of accounts) {
  const full = `${a.account_number}/${BANK_CODE}`;
  console.log(`  #${a.id} ${a.name}: ${a.account_number} → ${full}`);
  if (CONFIRM) db.prepare('UPDATE accounts SET account_number = ? WHERE id = ?').run(full, a.id);
}

// 2+3) matchery: dohledání kompletního čísla z transakcí
function fixMatchers(table) {
  const rows = db.prepare(
    `SELECT id, match_counterparty_account AS num, user_id FROM ${table}
     WHERE match_counterparty_account IS NOT NULL AND match_counterparty_account NOT LIKE '%/%'`
  ).all();
  console.log(`\n${table} bez kódu banky: ${rows.length}`);
  for (const r of rows) {
    const candidates = db.prepare(
      'SELECT DISTINCT counterparty_account FROM transactions WHERE user_id = ? AND counterparty_account LIKE ?'
    ).all(r.user_id, `${r.num}/%`).map(x => x.counterparty_account);
    if (candidates.length !== 1) {
      console.log(`  #${r.id} ${r.num}: PŘESKOČENO — kandidátů z transakcí: ${candidates.length} ${JSON.stringify(candidates)}`);
      continue;
    }
    console.log(`  #${r.id}: ${r.num} → ${candidates[0]}`);
    if (CONFIRM) db.prepare(`UPDATE ${table} SET match_counterparty_account = ? WHERE id = ?`).run(candidates[0], r.id);
  }
}
fixMatchers('income_sources');
fixMatchers('fixed_expenses');

console.log(`\n${CONFIRM ? 'HOTOVO — změny zapsány.' : 'Dry-run dokončen, nic nezapsáno.'}`);
db.close();
