'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-arec-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./appleReceipts']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x'),(2,'jiny@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (5,1,'Y_Licence',2)").run();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (100,1,5,-269,'2026-06-30','APPLE.COM/BILL'),(200,2,5,-269,'2026-06-30','APPLE.COM/BILL')`).run();
  db.prepare(`INSERT INTO apple_receipts (id, user_id, order_id, receipt_date, total_amount, card_last4, items_json, raw_text, status)
              VALUES (1,1,'AAA','2026-06-30',269,'4225','[{"app":"YouTube","description":"YouTube Premium","amount":269}]','raw','pending'),
                     (2,2,'BBB','2026-06-30',269,NULL,'[]','raw','pending')`).run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/apple-receipts', require('./appleReceipts'));
  return { db, app };
}

test('GET vraci jen faktury vlastnika a rozparsovane polozky', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const { receipts } = await (await fetch(`${base}/api/apple-receipts?status=all`)).json();
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].order_id, 'AAA');
  assert.equal(receipts[0].items[0].app, 'YouTube');
  server.close();
});

test('GET u pending nabidne kandidaty', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const { receipts } = await (await fetch(`${base}/api/apple-receipts`)).json();
  assert.ok(Array.isArray(receipts[0].candidates));
  assert.equal(receipts[0].candidates[0].id, 100);
  server.close();
});

test('rucni prirazeni spa ruje a doplni poznamku', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const r = await fetch(`${base}/api/apple-receipts/1/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction_id: 100 }),
  });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT status, transaction_id FROM apple_receipts WHERE id=1').get().status, 'matched');
  assert.ok(db.prepare('SELECT note FROM transactions WHERE id=100').get().note.includes('YouTube'));
  server.close();
});

test('rucni prirazeni cizi transakce neprojde', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const r = await fetch(`${base}/api/apple-receipts/1/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction_id: 200 }),
  });
  assert.equal(r.status, 404);
  server.close();
});

test('cizi fakturu nelze precist ani zmenit', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  assert.equal((await fetch(`${base}/api/apple-receipts/2/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction_id: 100 }),
  })).status, 404);
  assert.equal((await fetch(`${base}/api/apple-receipts/2`, { method: 'DELETE' })).status, 404);
  server.close();
});

test('unmatch vrati fakturu do pending', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  await fetch(`${base}/api/apple-receipts/1/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction_id: 100 }),
  });
  const r = await fetch(`${base}/api/apple-receipts/1/unmatch`, { method: 'POST' });
  assert.equal(r.status, 200);
  const row = db.prepare('SELECT status, transaction_id FROM apple_receipts WHERE id=1').get();
  assert.equal(row.status, 'pending');
  assert.equal(row.transaction_id, null);
  server.close();
});

test('DELETE nastavi rejected, zaznam zustava', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  assert.equal((await fetch(`${base}/api/apple-receipts/1`, { method: 'DELETE' })).status, 200);
  assert.equal(db.prepare('SELECT status FROM apple_receipts WHERE id=1').get().status, 'rejected');
  server.close();
});

// I1: zahození spárované faktury musí uvolnit i vazbu na transakci.
test('DELETE spa rovane faktury vynuluje transaction_id', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  await fetch(`${base}/api/apple-receipts/1/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction_id: 100 }),
  });
  await fetch(`${base}/api/apple-receipts/1`, { method: 'DELETE' });
  const row = db.prepare('SELECT status, transaction_id, matched_at FROM apple_receipts WHERE id=1').get();
  assert.equal(row.status, 'rejected');
  assert.equal(row.transaction_id, null);
  assert.equal(row.matched_at, null);
  server.close();
});

// I2: jedna platba = jedna faktura (kandidáti i ruční přiřazení).
test('uz zabranou transakci GET nenabidne jako kandidata a match ji odmitne', async () => {
  const { db, app } = setup();
  db.prepare(`INSERT INTO apple_receipts (id, user_id, order_id, receipt_date, total_amount, card_last4, items_json, raw_text, status)
              VALUES (3,1,'CCC','2026-06-30',269,'4225','[{"app":"iCloud"}]','raw','pending')`).run();
  const { server, base } = await listen(app);
  await fetch(`${base}/api/apple-receipts/1/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction_id: 100 }),
  });
  const { receipts } = await (await fetch(`${base}/api/apple-receipts?status=pending`)).json();
  const rec3 = receipts.find(r => r.id === 3);
  assert.deepEqual(rec3.candidates.map(c => c.id), [], 'zabrana transakce uz neni kandidat');

  const r = await fetch(`${base}/api/apple-receipts/3/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction_id: 100 }),
  });
  assert.equal(r.status, 409);
  assert.ok((await r.json()).error.includes('jiná faktura'));
  const note = db.prepare('SELECT note FROM transactions WHERE id=100').get().note;
  assert.ok(!note.includes('iCloud'), 'poznamky se neslepi');
  server.close();
});

test('zahozena faktura uz transakci neblokuje', async () => {
  const { db, app } = setup();
  db.prepare(`INSERT INTO apple_receipts (id, user_id, order_id, receipt_date, total_amount, card_last4, items_json, raw_text, status)
              VALUES (3,1,'CCC','2026-06-30',269,'4225','[]','raw','pending')`).run();
  const { server, base } = await listen(app);
  await fetch(`${base}/api/apple-receipts/1/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction_id: 100 }),
  });
  await fetch(`${base}/api/apple-receipts/1`, { method: 'DELETE' });
  const r = await fetch(`${base}/api/apple-receipts/3/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction_id: 100 }),
  });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT transaction_id FROM apple_receipts WHERE id=3').get().transaction_id, 100);
  server.close();
});

test('kandidat nese i popis transakce', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const { receipts } = await (await fetch(`${base}/api/apple-receipts`)).json();
  assert.equal(receipts[0].candidates[0].description, 'APPLE.COM/BILL');
  server.close();
});
