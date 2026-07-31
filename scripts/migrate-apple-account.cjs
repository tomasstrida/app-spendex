'use strict';
// Doplní apple_account u faktur uložených PŘED zavedením toho sloupce.
// Přeparsuje uložený raw_text, takže uživatel nemusí nic přeposílat znovu.
// Dry-run je výchozí; zápis až s CONFIRM=1.
//
//   node scripts/migrate-apple-account.cjs                # co by se stalo
//   CONFIRM=1 node scripts/migrate-apple-account.cjs      # zapíše

const path = require('path');
const Database = require('better-sqlite3');
const { parseAppleInvoice } = require(path.join(__dirname, '..', 'src', 'utils', 'appleInvoiceParser'));

const DB_PATH = process.env.DB_PATH;
if (!DB_PATH) {
  console.error('DB_PATH je povinný.');
  process.exit(1);
}
const confirm = process.env.CONFIRM === '1';
const db = new Database(DB_PATH);

const rows = db.prepare(
  'SELECT id, raw_text FROM apple_receipts WHERE apple_account IS NULL AND raw_text IS NOT NULL'
).all();

let found = 0;
const update = db.prepare('UPDATE apple_receipts SET apple_account = ? WHERE id = ?');
for (const row of rows) {
  const parsed = parseAppleInvoice(row.raw_text);
  const account = parsed && parsed.apple_account;
  if (!account) {
    console.log(`  #${row.id}: ucet se nepodarilo vytahnout`);
    continue;
  }
  found++;
  console.log(`  #${row.id}: ${account}`);
  if (confirm) update.run(account, row.id);
}

console.log(`\nKandidatu: ${rows.length}, rozpoznano: ${found}`);
console.log(confirm ? 'ZAPSANO.' : 'DRY-RUN — spust s CONFIRM=1 pro zapis.');
