'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-transactions-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./transactions']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (5,1,'Licence')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/transactions', require('./transactions'));
  return { db, app };
}

test('PATCH nastaví subcategory_id a GET vrátí subcategory_name', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const subId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'ChatGPT')").run().lastInsertRowid;
  const txId = db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-500,'2026-07-01','OPENAI')").run().lastInsertRowid;
  const res = await fetch(`${base}/api/transactions/${txId}`, { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ subcategory_id: subId }) });
  assert.equal(res.status, 200);
  const list = await (await fetch(`${base}/api/transactions`)).json();
  const rows = list.transactions || list;
  const tx = rows.find(t => t.id === txId);
  assert.equal(tx.subcategory_name, 'ChatGPT');
  assert.equal(tx.subcategory_id, subId);
  server.close();
});

test('PATCH: vynechání subcategory_id zachová dřívější hodnotu (partial update)', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const subId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'ChatGPT')").run().lastInsertRowid;
  const txId = db.prepare("INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description) VALUES (1,5,?,-500,'2026-07-01','OPENAI')").run(subId).lastInsertRowid;
  const res = await fetch(`${base}/api/transactions/${txId}`, { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ note: 'test' }) });
  assert.equal(res.status, 200);
  const patched = await res.json();
  assert.equal(patched.subcategory_id, subId);
  server.close();
});

test('PATCH: subcategory_id=null vymaže subkategorii', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const subId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'ChatGPT')").run().lastInsertRowid;
  const txId = db.prepare("INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description) VALUES (1,5,?,-500,'2026-07-01','OPENAI')").run(subId).lastInsertRowid;
  const res = await fetch(`${base}/api/transactions/${txId}`, { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ subcategory_id: null }) });
  assert.equal(res.status, 200);
  const patched = await res.json();
  assert.equal(patched.subcategory_id, null);
  server.close();
});

test('GET: transakce bez subcategory_id vrátí subcategory_name = null', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-100,'2026-07-02','JINA')").run();
  const list = await (await fetch(`${base}/api/transactions`)).json();
  const rows = list.transactions || list;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subcategory_name, null);
  server.close();
});

test('GET: cizí subkategorie se stejným id (jiný user) se nepromítne (defense-in-depth JOIN)', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO users (id, email) VALUES (2,'other@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (6,2,'Cizí')").run();
  const foreignSubId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (2,6,'Cizí sub')").run().lastInsertRowid;
  // tx patřící userovi 1, ale s subcategory_id ukazujícím na subkategorii cizího usera (simulace nekonzistence)
  db.prepare("INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description) VALUES (1,5,?,-100,'2026-07-03','X')").run(foreignSubId);
  const list = await (await fetch(`${base}/api/transactions`)).json();
  const rows = list.transactions || list;
  const tx = rows.find(t => t.description === 'X');
  assert.equal(tx.subcategory_name, null);
  server.close();
});
