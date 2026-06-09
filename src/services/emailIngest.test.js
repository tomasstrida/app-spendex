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

test('neznámá karta v domácnosti se členem → awaiting_card, žádná transakce, karta nepřiřazená, bez notify', () => {
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
  const seedRules = require('../../scripts/seed/rules');
  seedRules.textOverrides.push({ pattern: 'HAMR', category: 'Restaurace' });
  try {
    const { ingestEmail } = require('./emailIngest');
    const r = ingestEmail(db, { userEmail: 'tom@example.com', text: CARD_TX });
    const tx = db.prepare("SELECT * FROM transactions WHERE user_id = 1").get();
    cleanup(db, tmp);
    assert.equal(r.status, 'imported');
    assert.equal(r.notifyUserId, 2);
    assert.equal(tx.category_id, 7);
    assert.equal(tx.place, 'HAMR - BRANIK,RESTAURA, PRAHA 4');
  } finally {
    seedRules.textOverrides.pop();
  }
});

test('solo uživatel (bez členů) → karta auto-přiřazená vlastníkovi, import, notify vlastník', () => {
  const { db, tmp } = freshDb();
  seed(db);
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (7, 1, 'Restaurace')").run();
  const seedRules = require('../../scripts/seed/rules');
  seedRules.textOverrides.push({ pattern: 'HAMR', category: 'Restaurace' });
  try {
    const { ingestEmail } = require('./emailIngest');
    const r = ingestEmail(db, { userEmail: 'tom@example.com', text: CARD_TX });
    const card = db.prepare("SELECT * FROM cards WHERE data_owner_id = 1 AND last4 = '6062'").get();
    cleanup(db, tmp);
    assert.equal(r.status, 'imported');
    assert.equal(r.notifyUserId, 1);
    assert.equal(card.assigned_user_id, 1);
  } finally {
    seedRules.textOverrides.pop();
  }
});

test('releaseHeldCard: jistá kategorie → import transakce + řádek imported, idempotentní', () => {
  const { db, tmp } = freshDb();
  seed(db);
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (7, 1, 'Restaurace')").run();
  const parsed = JSON.stringify({ amount: -482, currency: 'CZK', date: '2026-06-08', description: '', note: '', place: 'HAMR - BRANIK', card_last4: '6062', account_id: 10, tx_type: 'Platba kartou' });
  db.prepare("INSERT INTO email_inbox (user_id, raw_text, parsed_json, external_id, status) VALUES (1, '', ?, '26918903543-1679014023', 'awaiting_card')").run(parsed);
  const seedRules = require('../../scripts/seed/rules');
  seedRules.textOverrides.push({ pattern: 'HAMR', category: 'Restaurace' });
  try {
    const { releaseHeldCard } = require('./emailIngest');
    const n1 = releaseHeldCard(db, 1, '6062');
    const n2 = releaseHeldCard(db, 1, '6062'); // druhý běh už nic
    const tx = db.prepare("SELECT * FROM transactions WHERE user_id = 1").get();
    const txCount = db.prepare("SELECT COUNT(*) c FROM transactions").get();
    const inbox = db.prepare("SELECT status FROM email_inbox WHERE external_id = '26918903543-1679014023'").get();
    assert.equal(n1, 1);
    assert.equal(n2, 0);
    assert.equal(txCount.c, 1);
    assert.equal(tx.category_id, 7);
    assert.equal(tx.place, 'HAMR - BRANIK');
    assert.equal(inbox.status, 'imported');
  } finally {
    seedRules.textOverrides.pop();
    cleanup(db, tmp);
  }
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
