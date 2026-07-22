'use strict';
// Znovu projede pending frontu (email_inbox) a co je nově „jisté" přesune do
// transactions. Cíleno na převody, které uvázly kvůli nesouladu názvu kategorie
// (L0 vrátil „Převody", ale kategorie se v prod jmenuje „Převody interní"). Řeší se
// přes type=4 marker; NASAĎ NEJDŘÍV (schema migrace nastaví type=4), pak spusť tento skript.
//
// Env: DB_PATH (povinné), CONFIRM=1 pro ostrý zápis (jinak dry-run).
// Bezpečné: insertTx používá INSERT OR IGNORE na external_id (idempotentní), NEMAŽE nic.
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH;
const CONFIRM = process.env.CONFIRM === '1';
if (!DB_PATH) { console.error('Chybí DB_PATH'); process.exit(1); }

const db = new Database(DB_PATH);
const { categorize, recategorizePending } = require(path.resolve(__dirname, '../src/services/emailIngest'));

const transferCats = db.prepare("SELECT COUNT(*) c FROM categories WHERE type = 4").get().c;
if (transferCats === 0) {
  console.warn('⚠️  Žádná kategorie type=4 — nasaď nejdřív (schema migrace), jinak se převody nezařadí. Končím.');
  process.exit(1);
}

const users = db.prepare("SELECT DISTINCT user_id FROM email_inbox WHERE status = 'pending'").all();
let wouldMove = 0;
for (const { user_id } of users) {
  const rows = db.prepare("SELECT * FROM email_inbox WHERE user_id = ? AND status = 'pending'").all(user_id);
  for (const row of rows) {
    if (!row.parsed_json) continue;
    const tx = JSON.parse(row.parsed_json);
    const account = tx.account_id != null
      ? db.prepare('SELECT id, account_number FROM accounts WHERE id = ?').get(tx.account_id)
      : null;
    const { confident, catName } = categorize(db, user_id, tx, account);
    if (confident) {
      wouldMove++;
      console.log(`  [inbox ${row.id}] user ${user_id} → ${catName}  (${tx.amount} ${tx.currency || ''}, ${tx.description || tx.place || tx.note || '—'})`);
    }
  }
}
console.log(`\nZařaditelných pending: ${wouldMove}`);
if (!CONFIRM) { console.log('Dry-run — pro ostrý zápis spusť s CONFIRM=1.'); process.exit(0); }

let moved = 0;
for (const { user_id } of users) moved += recategorizePending(db, user_id);
console.log(`Přesunuto do transakcí: ${moved}`);
