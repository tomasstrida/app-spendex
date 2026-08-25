#!/usr/bin/env node
'use strict';
/**
 * Doplní transactions.balance_after z uložených e-mailů (email_inbox.raw_text).
 *
 * Dry-run (výchozí):  node scripts/migrate-balance-after.cjs
 * Ostrý běh:          CONFIRM=1 node scripts/migrate-balance-after.cjs
 *
 * Idempotentní: mění jen řádky, kde je balance_after NULL.
 */
const path = require('path');
const Database = require(process.env.SQLITE_MODULE || 'better-sqlite3');
const { parseEmailNotification } = require(path.join(__dirname, '..', 'src', 'utils', 'emailParser'));

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');
const confirm = process.env.CONFIRM === '1';
const db = new Database(dbPath, { readonly: !confirm });

const rows = db.prepare('SELECT id, external_id, raw_text FROM email_inbox WHERE raw_text IS NOT NULL').all();
const update = confirm
  ? db.prepare('UPDATE transactions SET balance_after = ? WHERE id = ?')
  : null;

let matched = 0, updated = 0, skipped = 0, noBalance = 0;

for (const row of rows) {
  const tx = parseEmailNotification(row.raw_text);
  if (!tx || tx.balance_after == null) { noBalance++; continue; }
  if (!row.external_id) { skipped++; continue; }
  const target = db.prepare(
    'SELECT id, balance_after FROM transactions WHERE external_id = ?'
  ).get(row.external_id);
  if (!target) { skipped++; continue; }
  matched++;
  if (target.balance_after != null) continue;   // už doplněno
  console.log(`tx #${target.id} (external_id=${row.external_id}) → ${tx.balance_after}`);
  if (confirm) { update.run(tx.balance_after, target.id); updated++; }
}

console.log(`\n${confirm ? 'OSTRY BEH' : 'DRY-RUN'}: e-mailů ${rows.length}, spárováno ${matched}, ` +
  `zapsáno ${updated}, bez zůstatku ${noBalance}, bez transakce ${skipped}`);
