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
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Společný', '1679014023/3030', 'spending')").run();
}

const INTERNAL = `zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 10,00 CZK. Dostupný zůstatek k 07.06.2026 v 17:47 je 4 934,46 CZK.
Odchozí úhrada na účet Tomáš Střída číslo 1679014138/3030
Datum zaúčtování: 07.06.2026
Kód transakce: 160610143222`;

const CARD_TX = `zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 482,00 CZK. Dostupný zůstatek k 08.06.2026 v 21:15 je 3 678,16 CZK.
Platba kartou (nezaúčtováno) v HAMR - BRANIK,RESTAURA, PRAHA 4, 000
Karta: 516844******6062
Datum provedení: 08.06.2026
Kód transakce: 26918903543`;

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

test('duplicita proti pending: stejná tx přijde podruhé → duplicate, druhý pending nevznikne', () => {
  const { db, tmp } = freshDb();
  seed(db);
  const text = `zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 349,00 CZK. Dostupný zůstatek k 07.06.2026 v 12:00 je 100,00 CZK.
Odchozí úhrada na účet NĚJAKÝ ESHOP s.r.o. číslo 2222222222/0800
Datum zaúčtování: 07.06.2026
Kód transakce: 160610777111`;
  const { ingestEmail } = require('./emailIngest');
  const first = ingestEmail(db, { userEmail: 'tom@example.com', fromHeader: 'info@airbank.cz', text });
  const second = ingestEmail(db, { userEmail: 'tom@example.com', fromHeader: 'info@airbank.cz', text });
  const cnt = db.prepare("SELECT COUNT(*) c FROM email_inbox WHERE status = 'pending'").get();
  cleanup(db, tmp);
  assert.equal(first.status, 'pending');
  assert.equal(second.status, 'duplicate');
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

test('ingestEmail vrací userId a notify payload (pending i imported)', () => {
  const { db, tmp } = freshDb();
  seed(db);
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', fromHeader: 'info@airbank.cz', text: INTERNAL });
  cleanup(db, tmp);
  assert.equal(r.userId, 1);
  assert.ok(r.notify, 'notify payload chybí');
  assert.equal(typeof r.notify.amount, 'number');
  assert.ok('merchant' in r.notify);
});

test('neznámá karta v domácnosti se členem → awaiting_card, žádná transakce, karta nepřiřazená + broadcast notifikace', () => {
  const { db, tmp } = freshDb();
  seed(db);
  db.prepare("INSERT INTO users (id, email) VALUES (2, 'martin@example.com')").run();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', text: CARD_TX });
  const txCount = db.prepare("SELECT COUNT(*) c FROM transactions").get();
  const inbox = db.prepare("SELECT * FROM email_inbox WHERE user_id = 1").get();
  const card = db.prepare("SELECT * FROM cards WHERE data_owner_id = 1 AND last4 = '6062'").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'awaiting_card');
  assert.equal(txCount.c, 0);
  assert.equal(inbox.status, 'awaiting_card');
  assert.ok(inbox.parsed_json.includes('6062'));
  assert.equal(card.assigned_user_id, null);
  assert.equal(r.broadcast, true);
  assert.equal(r.notify.unknownCard, true);
  assert.equal(r.notify.last4, '6062');
});

test('přiřazená karta člena → import + notifyUserId = člen', () => {
  const { db, tmp } = freshDb();
  seed(db);
  db.prepare("INSERT INTO users (id, email) VALUES (2, 'martin@example.com')").run();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (7, 1, 'Restaurace')").run();
  db.prepare("INSERT INTO cards (data_owner_id, last4, assigned_user_id) VALUES (1, '6062', 2)").run();
  db.prepare("INSERT INTO category_rules (user_id, category_id, pattern) VALUES (1, 7, 'HAMR')").run();
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', text: CARD_TX });
  const tx = db.prepare("SELECT * FROM transactions WHERE user_id = 1").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'imported');
  assert.equal(r.notifyUserId, 2);
  assert.equal(tx.category_id, 7);
  assert.equal(tx.place, 'HAMR - BRANIK,RESTAURA, PRAHA 4');
});

test('solo uživatel (bez členů) → karta auto-přiřazená vlastníkovi, import, notify vlastník', () => {
  const { db, tmp } = freshDb();
  seed(db);
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (7, 1, 'Restaurace')").run();
  db.prepare("INSERT INTO category_rules (user_id, category_id, pattern) VALUES (1, 7, 'HAMR')").run();
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', text: CARD_TX });
  const card = db.prepare("SELECT * FROM cards WHERE data_owner_id = 1 AND last4 = '6062'").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'imported');
  assert.equal(r.notifyUserId, 1);
  assert.equal(card.assigned_user_id, 1);
});

test('releaseHeldCard: jistá kategorie → import transakce + řádek imported, idempotentní', () => {
  const { db, tmp } = freshDb();
  seed(db);
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (7, 1, 'Restaurace')").run();
  db.prepare("INSERT INTO category_rules (user_id, category_id, pattern) VALUES (1, 7, 'HAMR')").run();
  const parsed = JSON.stringify({ amount: -482, currency: 'CZK', date: '2026-06-08', description: '', note: '', place: 'HAMR - BRANIK', card_last4: '6062', account_id: 10, tx_type: 'Platba kartou' });
  db.prepare("INSERT INTO email_inbox (user_id, raw_text, parsed_json, external_id, status) VALUES (1, '', ?, '26918903543-1679014023', 'awaiting_card')").run(parsed);
  const { releaseHeldCard } = require('./emailIngest');
  const n1 = releaseHeldCard(db, 1, '6062');
  const n2 = releaseHeldCard(db, 1, '6062'); // druhý běh už nic
  const tx = db.prepare("SELECT * FROM transactions WHERE user_id = 1").get();
  const txCount = db.prepare("SELECT COUNT(*) c FROM transactions").get();
  const inbox = db.prepare("SELECT status FROM email_inbox WHERE external_id = '26918903543-1679014023'").get();
  cleanup(db, tmp);
  assert.equal(n1, 1);
  assert.equal(n2, 0);
  assert.equal(txCount.c, 1);
  assert.equal(tx.category_id, 7);
  assert.equal(tx.place, 'HAMR - BRANIK');
  assert.equal(inbox.status, 'imported');
});

test('DB textové pravidlo (category_rules) kategorizuje platbu kartou → imported se správnou kategorií', () => {
  const { db, tmp } = freshDb();
  seed(db);
  // Solo uživatel (žádný household_members) → karta se auto-přiřadí vlastníkovi
  const catResult = db.prepare("INSERT INTO categories (user_id, name) VALUES (1, 'Restaurace a kávičky')").run();
  const categoryId = catResult.lastInsertRowid;
  db.prepare("INSERT INTO category_rules (user_id, category_id, pattern) VALUES (1, ?, 'ZIZKAVARNA')").run(categoryId);
  const text = `zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 89,00 CZK. Dostupný zůstatek k 09.06.2026 v 10:30 je 3 000,00 CZK.
Platba kartou (nezaúčtováno) v ZIZKAVARNA, PRAHA, 10
Karta: 516844******6062
Datum provedení: 09.06.2026
Kód transakce: 99887766554`;
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', text });
  const tx = db.prepare("SELECT * FROM transactions WHERE user_id = 1").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'imported');
  assert.equal(tx.category_id, categoryId, 'DB pravidlo ZIZKAVARNA musí přiřadit kategorii Restaurace a kávičky');
});

test('releaseHeldCard: nejistá kategorie → řádek pending se suggested_category_id (fallback)', () => {
  const { db, tmp } = freshDb();
  seed(db);
  const parsed = JSON.stringify({ amount: -120, currency: 'CZK', date: '2026-06-08', description: '', note: '', place: 'NEZNÁMÝ OBCHOD XY', card_last4: '7777', account_id: 10, tx_type: 'Platba kartou' });
  db.prepare("INSERT INTO email_inbox (user_id, raw_text, parsed_json, external_id, status) VALUES (1, '', ?, '99999-1679014023', 'awaiting_card')").run(parsed);
  const { releaseHeldCard } = require('./emailIngest');
  const n = releaseHeldCard(db, 1, '7777');
  const txCount = db.prepare("SELECT COUNT(*) c FROM transactions").get();
  const inbox = db.prepare("SELECT status, suggested_category_id FROM email_inbox WHERE external_id = '99999-1679014023'").get();
  cleanup(db, tmp);
  assert.equal(n, 1);
  assert.equal(txCount.c, 0);
  assert.equal(inbox.status, 'pending');
  assert.equal(inbox.suggested_category_id, 6); // Ostatní (fallback)
});

test('result imported nese transactionId a txDate', () => {
  const { db, tmp } = freshDb();
  seed(db);
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', text: INTERNAL });
  assert.equal(r.status, 'imported');
  assert.ok(Number.isInteger(r.transactionId) && r.transactionId > 0);
  assert.equal(r.txDate, '2026-06-07');
  const row = db.prepare('SELECT id FROM transactions WHERE id = ?').get(r.transactionId);
  assert.ok(row);
  cleanup(db, tmp);
});

test('result awaiting_card (neznámá karta v domácnosti) nese inboxId', () => {
  const { db, tmp } = freshDb();
  seed(db);
  // domácnost: owner=1, member=2 → nová karta zůstane nepřiřazená
  db.prepare("INSERT INTO users (id, email) VALUES (2, 'martin@example.com')").run();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', text: CARD_TX });
  assert.equal(r.status, 'awaiting_card');
  assert.ok(Number.isInteger(r.inboxId) && r.inboxId > 0);
  const row = db.prepare("SELECT id FROM email_inbox WHERE id = ? AND status = 'awaiting_card'").get(r.inboxId);
  assert.ok(row);
  cleanup(db, tmp);
});

test('result pending nese inboxId', () => {
  const { db, tmp } = freshDb();
  seed(db);
  // bez kategorie "Ostatní" fallback → ale necháme kartu přiřazenou ownerovi (solo),
  // platba kartou bez jistého pravidla → pending
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', text: CARD_TX });
  assert.equal(r.status, 'pending');
  assert.ok(Number.isInteger(r.inboxId) && r.inboxId > 0);
  const row = db.prepare("SELECT id FROM email_inbox WHERE id = ? AND status = 'pending'").get(r.inboxId);
  assert.ok(row);
  cleanup(db, tmp);
});

test('interní převod s PŘEJMENOVANOU kategorií (type=4, „Převody interní") → imported, ne pending', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'tom@example.com')").run();
  // Kategorie interních převodů NENÍ jménem „Převody" (seed default), ale přejmenovaná.
  // Identita drží na type=4 → L0 se musí trefit i tak.
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (5, 1, 'Převody interní', 4)").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (6, 1, 'Ostatní')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Společný', '1679014023/3030', 'spending')").run();
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', fromHeader: 'info@airbank.cz', text: INTERNAL });
  const tx = db.prepare("SELECT * FROM transactions WHERE user_id = 1").get();
  const inboxCount = db.prepare("SELECT COUNT(*) c FROM email_inbox").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'imported');
  assert.equal(tx.category_id, 5, 'zařadí přes type=4, ne přes hardcoded název „Převody"');
  assert.equal(inboxCount.c, 0);
});

test('recategorizePending: dřív uvázlý interní převod se po zavedení type=4 zařadí', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'tom@example.com')").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (5, 1, 'Převody interní', 4)").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (6, 1, 'Ostatní')").run();
  // Simulace uvázlé fronty: převod na vlastní účet zůstal pending se suggested=NULL.
  const parsed = JSON.stringify({ amount: -5000, currency: 'CZK', date: '2026-07-20', description: 'Tomáš Střída', note: '', place: null, counterparty_account: '1679014023/3030', account_id: null });
  db.prepare("INSERT INTO email_inbox (user_id, raw_text, parsed_json, external_id, suggested_category_id, status) VALUES (1, '', ?, 'stuck-1', NULL, 'pending')").run(parsed);
  const { recategorizePending } = require('./emailIngest');
  const n1 = recategorizePending(db, 1);
  const n2 = recategorizePending(db, 1); // idempotence — podruhé už nic
  const tx = db.prepare("SELECT * FROM transactions WHERE user_id = 1").get();
  const inbox = db.prepare("SELECT status FROM email_inbox WHERE external_id = 'stuck-1'").get();
  cleanup(db, tmp);
  assert.equal(n1, 1);
  assert.equal(n2, 0);
  assert.equal(tx.category_id, 5);
  assert.equal(inbox.status, 'imported');
});

test('recategorizePending: platba, co je pořád nejistá, zůstává pending', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'tom@example.com')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (6, 1, 'Ostatní')").run();
  const parsed = JSON.stringify({ amount: -300, currency: 'CZK', date: '2026-07-20', description: 'NEZNÁMÝ ESHOP', note: '', place: null, counterparty_account: '2222222222/0800', account_id: null });
  db.prepare("INSERT INTO email_inbox (user_id, raw_text, parsed_json, external_id, suggested_category_id, status) VALUES (1, '', ?, 'stuck-2', NULL, 'pending')").run(parsed);
  const { recategorizePending } = require('./emailIngest');
  const n = recategorizePending(db, 1);
  const txCount = db.prepare("SELECT COUNT(*) c FROM transactions").get();
  const inbox = db.prepare("SELECT status FROM email_inbox WHERE external_id = 'stuck-2'").get();
  cleanup(db, tmp);
  assert.equal(n, 0);
  assert.equal(txCount.c, 0);
  assert.equal(inbox.status, 'pending');
});
