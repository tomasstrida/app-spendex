#!/usr/bin/env node
'use strict';
/**
 * Doplní transactions.balance_after z uložených e-mailů (email_inbox.raw_text).
 *
 * Dry-run (výchozí):  node scripts/migrate-balance-after.cjs
 * Ostrý běh:          CONFIRM=1 node scripts/migrate-balance-after.cjs
 * Produkce (kopie mimo repo, viz PARSER_MODULE níže):
 *   PARSER_MODULE=/app/src/utils/emailParser DB_PATH=/data/data.db SQLITE_MODULE=/app/node_modules/better-sqlite3 node /tmp/mig.cjs
 *
 * Idempotentní: mění jen řádky, kde je balance_after NULL.
 */
const path = require('path');
const Database = require(process.env.SQLITE_MODULE || 'better-sqlite3');
// Skript se na produkci kopíruje mimo repo (např. do /tmp) → relativní cesta
// přes __dirname by tam mířila mimo strom projektu. PARSER_MODULE dovolí
// zadat absolutní cestu k parseru, stejně jako SQLITE_MODULE u better-sqlite3.
const parserPath = process.env.PARSER_MODULE || path.join(__dirname, '..', 'src', 'utils', 'emailParser');
const { parseEmailNotification } = require(parserPath);

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');
const confirm = process.env.CONFIRM === '1';
const db = new Database(dbPath, { readonly: !confirm });

const rows = db.prepare('SELECT id, user_id, external_id, raw_text FROM email_inbox WHERE raw_text IS NOT NULL').all();
const update = confirm
  ? db.prepare('UPDATE transactions SET balance_after = ? WHERE id = ?')
  : null;

let matched = 0, updated = 0, skipped = 0, noBalance = 0;

for (const row of rows) {
  const tx = parseEmailNotification(row.raw_text);
  if (!tx || tx.balance_after == null) { noBalance++; continue; }
  if (!row.external_id) { skipped++; continue; }
  // Unikátnost transakce je na dvojici (user_id, external_id), ne na
  // samotném external_id — bez user_id by párování mohlo trefit cizí
  // transakci se shodným external_id z jiné domácnosti.
  const target = db.prepare(
    'SELECT id, balance_after FROM transactions WHERE user_id = ? AND external_id = ?'
  ).get(row.user_id, row.external_id);
  if (!target) { skipped++; continue; }
  matched++;
  if (target.balance_after != null) continue;   // už doplněno
  console.log(`tx #${target.id} (external_id=${row.external_id}) → ${tx.balance_after}`);
  if (confirm) { update.run(tx.balance_after, target.id); updated++; }
}

console.log(`\n${confirm ? 'OSTRY BEH' : 'DRY-RUN'}: e-mailů ${rows.length}, spárováno ${matched}, ` +
  `zapsáno ${updated}, bez zůstatku ${noBalance}, bez transakce ${skipped}`);
