'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-ingest-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  delete require.cache[require.resolve('./emailIngest')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + s); } catch { /* ok */ } }
}
function seed(db) {
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'tom@example.com')").run();
  // kategorie potřebné pro jisté zařazení
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (5, 1, 'Převody')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (6, 1, 'Ostatní')").run();
  // zdrojový účet
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Společný', '1679014023', 'spending')").run();
}

const INTERNAL = `zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 10,00 CZK. Dostupný zůstatek k 07.06.2026 v 17:47 je 4 934,46 CZK.
Odchozí úhrada na účet Tomáš Střída číslo 1679014138/3030
Datum zaúčtování: 07.06.2026
Kód transakce: 160610143222`;

test('interní převod (protiúčet = vlastní) → rovnou do transactions jako Převody', () => {
  const { db, tmp } = freshDb();
  seed(db);
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', fromHeader: 'info@airbank.cz', text: INTERNAL });
  const tx = db.prepare("SELECT * FROM transactions WHERE user_id = 1").get();
  const inbox = db.prepare("SELECT COUNT(*) c FROM email_inbox").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'imported');
  assert.equal(tx.category_id, 5);            // Převody (L0 — protiúčet 1679014138 ∈ ownAccountNumbers)
  assert.equal(tx.amount, -10);
  assert.equal(tx.external_id, '160610143222-1679014023');
  assert.equal(tx.source, 'airbank-email');
  assert.equal(tx.account_id, 10);
  assert.equal(inbox.c, 0);
});

test('neznámý obchodník bez pravidla → pending do email_inbox', () => {
  const { db, tmp } = freshDb();
  seed(db);
  const text = `zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 349,00 CZK. Dostupný zůstatek k 07.06.2026 v 12:00 je 100,00 CZK.
Odchozí úhrada na účet NĚJAKÝ ESHOP s.r.o. číslo 2222222222/0800
Datum zaúčtování: 07.06.2026
Kód transakce: 160610777111`;
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', fromHeader: 'info@airbank.cz', text });
  const inbox = db.prepare("SELECT * FROM email_inbox WHERE user_id = 1").get();
  const txCount = db.prepare("SELECT COUNT(*) c FROM transactions").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'pending');
  assert.equal(txCount.c, 0);
  assert.equal(inbox.status, 'pending');
  assert.equal(inbox.external_id, '160610777111-1679014023');
  assert.equal(inbox.suggested_category_id, 6); // Ostatní
  assert.ok(inbox.parsed_json.includes('349'));
});

test('nerozpoznaný e-mail → unparsed s raw textem', () => {
  const { db, tmp } = freshDb();
  seed(db);
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', fromHeader: 'info@airbank.cz', text: 'marketingový newsletter' });
  const inbox = db.prepare("SELECT * FROM email_inbox WHERE user_id = 1").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'unparsed');
  assert.equal(inbox.status, 'unparsed');
  assert.equal(inbox.parsed_json, null);
  assert.equal(inbox.raw_text, 'marketingový newsletter');
});

test('duplicita: stejná tx už v transactions → status duplicate, nevloží se', () => {
  const { db, tmp } = freshDb();
  seed(db);
  db.prepare("INSERT INTO transactions (user_id, amount, date, external_id) VALUES (1, -10, '2026-06-07', '160610143222-1679014023')").run();
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', fromHeader: 'info@airbank.cz', text: INTERNAL });
  const cnt = db.prepare("SELECT COUNT(*) c FROM transactions").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'duplicate');
  assert.equal(cnt.c, 1);
});

test('neznámý odesílatel / mimo whitelist → ignored, nic se neuloží', () => {
  const { db, tmp } = freshDb();
  seed(db);
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'nikdo@jiny.cz', fromHeader: 'info@airbank.cz', text: INTERNAL });
  const cnt = db.prepare("SELECT COUNT(*) c FROM transactions").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'ignored'); // uživatel s tímto e-mailem v DB neexistuje
  assert.equal(cnt.c, 0);
});
