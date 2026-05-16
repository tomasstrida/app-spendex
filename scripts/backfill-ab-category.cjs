'use strict';
/**
 * Jednorázový nedestruktivní backfill transactions.ab_category dle external_id.
 * Env: DB_PATH (povinné), CSV_DIR (povinné), CONFIRM ('1' = COMMIT; jinak dry-run + ROLLBACK).
 * Páruje stejně jako rebuild.cjs: external_id = `<ref>-<účet>`. UPDATE jen řádků
 * s ab_category IS NULL (idempotentní).
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { parseAirBankCSV } = require('../src/utils/csvParser');

const DB_PATH = process.env.DB_PATH;
const CSV_DIR = process.env.CSV_DIR;
const CONFIRM = process.env.CONFIRM === '1';
const USER_ID = 1;

if (!DB_PATH || !CSV_DIR) {
  console.error('DB_PATH a CSV_DIR jsou povinné.');
  process.exit(1);
}

const db = new Database(DB_PATH);

const csvFiles = {};
for (const f of fs.readdirSync(CSV_DIR)) {
  const m = f.match(/airbank_(\d+)/);
  if (m && f.endsWith('.csv')) csvFiles[m[1]] = path.join(CSV_DIR, f);
}

const report = { csv_total: 0, csv_no_ref: 0, updated: 0, no_match: 0 };

db.exec('BEGIN');
try {
  const upd = db.prepare(
    'UPDATE transactions SET ab_category = ? WHERE user_id = ? AND external_id = ? AND ab_category IS NULL'
  );
  for (const [accountNumber, file] of Object.entries(csvFiles)) {
    const txs = parseAirBankCSV(fs.readFileSync(file, 'utf-8'));
    for (const t of txs) {
      report.csv_total++;
      if (!t.external_id) { report.csv_no_ref++; continue; }
      const extId = `${t.external_id}-${accountNumber}`;
      const res = upd.run(t.ab_category || null, USER_ID, extId);
      if (res.changes > 0) report.updated += res.changes;
      else report.no_match++;
    }
  }

  report.remaining_null = db.prepare(
    'SELECT COUNT(*) n FROM transactions WHERE user_id = ? AND ab_category IS NULL'
  ).get(USER_ID).n;

  if (CONFIRM) { db.exec('COMMIT'); console.log('✅ COMMIT (ostrý běh)'); }
  else { db.exec('ROLLBACK'); console.log('🧪 ROLLBACK (dry-run; pro ostrý běh nastav CONFIRM=1)'); }
} catch (e) {
  try { db.exec('ROLLBACK'); } catch { /* žádná aktivní transakce */ }
  console.error('❌ CHYBA, ROLLBACK:', e.message);
  try { db.close(); } catch { /* už zavřeno */ }
  process.exit(1);
}

db.close();
console.log(JSON.stringify(report, null, 2));
