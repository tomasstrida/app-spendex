'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path'); const fs = require('fs');
const { simpleParser } = require('mailparser');

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-apple-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./appleReceipts']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (5,1,'Y_Licence',2)").run();
  db.prepare("INSERT INTO subcategories (id, user_id, category_id, name) VALUES (11,1,5,'Apple'),(12,1,5,'ChatGPT')").run();
  const svc = require('./appleReceipts');
  return { db, svc };
}

async function fixtureBody() {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'utils', '__fixtures__', 'apple-invoice.eml'), 'utf8');
  const parsed = await simpleParser(raw);
  return parsed.text || parsed.html || '';
}

test('faktura se spa ruje s odpovidajici transakci', async () => {
  const { db, svc } = setup();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, subcategory_id, amount, date, description)
              VALUES (100,1,5,11,-269,'2026-06-30','APPLE.COM/BILL, CORK')`).run();
  const r = svc.ingestAppleInvoice(db, 1, await fixtureBody());
  assert.equal(r.status, 'matched');
  assert.equal(r.transactionId, 100);
  const row = db.prepare('SELECT * FROM apple_receipts WHERE id = ?').get(r.receiptId);
  assert.equal(row.order_id, 'MQ9BQ86WV5');
  assert.equal(row.status, 'matched');
  assert.equal(row.transaction_id, 100);
  assert.ok(row.matched_at, 'matched_at se vyplni');
});

test('nazev sluzby se dopise do poznamky a nepretemi ji', async () => {
  const { db, svc } = setup();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description, note)
              VALUES (100,1,5,-269,'2026-06-30','APPLE.COM/BILL','puvodni text')`).run();
  svc.ingestAppleInvoice(db, 1, await fixtureBody());
  const tx = db.prepare('SELECT note FROM transactions WHERE id = 100').get();
  assert.ok(tx.note.includes('puvodni text'), 'puvodni poznamka zustava');
  assert.ok(tx.note.includes('YouTube Premium (Monthly)'), 'pribyl nazev sluzby');
});

test('opakovane pripsani poznamky ji nezdvoji', async () => {
  const { db, svc } = setup();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (100,1,5,-269,'2026-06-30','APPLE.COM/BILL')`).run();
  const { parseAppleInvoice } = require('../utils/appleInvoiceParser');
  const receipt = parseAppleInvoice(await fixtureBody());
  svc.applyReceiptToTransaction(db, 1, receipt, 100);
  svc.applyReceiptToTransaction(db, 1, receipt, 100);
  const tx = db.prepare('SELECT note FROM transactions WHERE id = 100').get();
  const occurrences = tx.note.split('YouTube Premium (Monthly)').length - 1;
  assert.equal(occurrences, 1, 'nazev sluzby jen jednou');
});

test('duplicita se pozna i u faktury bez order_id', () => {
  const { db, svc } = setup();
  const html = '<html><body><h1>Invoice</h1><div class="billing-information"><p>2 July 2026</p></div>'
    + '<div class="payment-information"><p>MasterCard •••• 4225</p><p>50,00 CZK</p></div></body></html>';
  const first = svc.ingestAppleInvoice(db, 1, html);
  assert.notEqual(first.status, 'duplicate');
  assert.equal(svc.ingestAppleInvoice(db, 1, html).status, 'duplicate');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 1);
});

test('pravidlo se subkategorii priradi subkategorii, kategorie zustava', async () => {
  const { db, svc } = setup();
  db.prepare("INSERT INTO category_rules (user_id, pattern, category_id, subcategory_id) VALUES (1,'YOUTUBE',5,12)").run();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, subcategory_id, amount, date, description)
              VALUES (100,1,5,11,-269,'2026-06-30','APPLE.COM/BILL')`).run();
  svc.ingestAppleInvoice(db, 1, await fixtureBody());
  const tx = db.prepare('SELECT category_id, subcategory_id FROM transactions WHERE id = 100').get();
  assert.equal(tx.subcategory_id, 12, 'subkategorie z pravidla');
  assert.equal(tx.category_id, 5, 'kategorie se nemeni');
});

test('bez sedici ho pravidla zustane subkategorie beze zmeny', async () => {
  const { db, svc } = setup();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, subcategory_id, amount, date, description)
              VALUES (100,1,5,11,-269,'2026-06-30','APPLE.COM/BILL')`).run();
  svc.ingestAppleInvoice(db, 1, await fixtureBody());
  const tx = db.prepare('SELECT subcategory_id, note FROM transactions WHERE id = 100').get();
  assert.equal(tx.subcategory_id, 11);
  assert.ok(tx.note.includes('YouTube'));
});

test('vicepolozkova faktura nemeni subkategorii, jen dopise obe polozky do poznamky', async () => {
  const { db, svc } = setup();
  db.prepare("INSERT INTO category_rules (user_id, pattern, category_id, subcategory_id) VALUES (1,'CHATGPT',5,12)").run();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, subcategory_id, amount, date, description)
              VALUES (100,1,5,11,-624,'2026-07-09','APPLE.COM/BILL')`).run();
  const html = '<html><body><h1>Invoice</h1><div class="billing-information"><p>9 July 2026</p>'
    + '<p>Order ID:</p><p>MULTI1</p></div>'
    + '<table class="lockup subscription-lockup__container"><tr class="subscription-lockup">'
    + '<td class="subscription-lockup__content"><p>iCloud</p><p>iCloud+ 50GB<br/></p></td>'
    + '<td class="subscription-lockup__bottom-text__col"><p>25,00&nbsp;CZK<br/></p></td></tr></table>'
    + '<table class="lockup subscription-lockup__container"><tr class="subscription-lockup">'
    + '<td class="subscription-lockup__content"><p>OpenAI</p><p>ChatGPT Plus<br/></p></td>'
    + '<td class="subscription-lockup__bottom-text__col"><p>599,00&nbsp;CZK<br/></p></td></tr></table>'
    + '<div class="payment-information"><p>MasterCard •••• 4225</p><p>624,00 CZK</p></div>'
    + '</body></html>';
  const r = svc.ingestAppleInvoice(db, 1, html);
  assert.equal(r.status, 'matched');
  const tx = db.prepare('SELECT subcategory_id, note FROM transactions WHERE id = 100').get();
  assert.equal(tx.subcategory_id, 11, 'subkategorie zustava puvodni, ne 12 z pravidla');
  assert.ok(tx.note.includes('iCloud'), 'poznamka obsahuje prvni polozku');
  assert.ok(tx.note.includes('ChatGPT Plus'), 'poznamka obsahuje druhou polozku');
});

test('bez odpovidajici transakce zustane faktura pending', async () => {
  const { db, svc } = setup();
  const r = svc.ingestAppleInvoice(db, 1, await fixtureBody());
  assert.equal(r.status, 'pending');
  assert.equal(db.prepare('SELECT status FROM apple_receipts WHERE id = ?').get(r.receiptId).status, 'pending');
});

test('dve stejne transakce = ambiguous, nic se nemeni', async () => {
  const { db, svc } = setup();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, subcategory_id, amount, date, description)
              VALUES (100,1,5,11,-269,'2026-06-30','APPLE.COM/BILL'),
                     (101,1,5,11,-269,'2026-07-01','APPLE.COM/BILL')`).run();
  const r = svc.ingestAppleInvoice(db, 1, await fixtureBody());
  assert.equal(r.status, 'ambiguous');
  assert.equal(db.prepare('SELECT note FROM transactions WHERE id = 100').get().note ?? '', '');
});

test('duplicitni faktura se stejnym order_id se neulozi dvakrat', async () => {
  const { db, svc } = setup();
  const body = await fixtureBody();
  svc.ingestAppleInvoice(db, 1, body);
  const second = svc.ingestAppleInvoice(db, 1, body);
  assert.equal(second.status, 'duplicate');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 1);
});

test('nerozpoznany mail se ulozi jako unparsed i s raw textem', () => {
  const { db, svc } = setup();
  const r = svc.ingestAppleInvoice(db, 1, 'Dobry den, tohle neni faktura.');
  assert.equal(r.status, 'unparsed');
  const row = db.prepare('SELECT status, raw_text FROM apple_receipts WHERE id = ?').get(r.receiptId);
  assert.equal(row.status, 'unparsed');
  assert.ok(row.raw_text.includes('tohle neni faktura'));
});

test('matchPendingForTransaction spa ruje cekajici fakturu po importu platby', async () => {
  const { db, svc } = setup();
  const r = svc.ingestAppleInvoice(db, 1, await fixtureBody());
  assert.equal(r.status, 'pending');
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (100,1,5,-269,'2026-06-30','APPLE.COM/BILL')`).run();
  const n = svc.matchPendingForTransaction(db, 1, 100);
  assert.equal(n, 1);
  assert.equal(db.prepare('SELECT status FROM apple_receipts WHERE id = ?').get(r.receiptId).status, 'matched');
});

test('cizi uzivatel neni dotcen', async () => {
  const { db, svc } = setup();
  db.prepare("INSERT INTO users (id, email) VALUES (2,'b@x')").run();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (200,2,5,-269,'2026-06-30','APPLE.COM/BILL')`).run();
  const r = svc.ingestAppleInvoice(db, 1, await fixtureBody());
  assert.equal(r.status, 'pending', 'cizi transakce se neparuje');
});
