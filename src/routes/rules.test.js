'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-rules-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./rules']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x'),(2,'out@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (10,1,'Sport'),(11,2,'Cizí')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/rules', require('./rules'));
  return { db, app };
}

test('rules CRUD: create, list, patch, delete', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  let res = await fetch(`${base}/api/rules`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'ZIZKAVARNA', category_id:10 }) });
  assert.equal(res.status, 200);
  const created = await res.json();
  assert.equal(created.pattern, 'ZIZKAVARNA');
  res = await fetch(`${base}/api/rules`); const list = await res.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].category_name, 'Sport');
  res = await fetch(`${base}/api/rules/${created.id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'ZIZKA', category_id:10, amount_max_abs:300 }) });
  assert.equal(res.status, 200);
  const patched = await res.json();
  assert.equal(patched.pattern, 'ZIZKA');
  assert.equal(patched.amount_max_abs, 300);
  res = await fetch(`${base}/api/rules/${created.id}`, { method:'DELETE' });
  assert.equal(res.status, 200);
  res = await fetch(`${base}/api/rules`); assert.equal((await res.json()).length, 0);
  server.close();
});

test('rules: nelze přiřadit cizí kategorii', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/rules`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'X', category_id:11 }) });
  assert.equal(res.status, 400);
  server.close();
});

test('rules: prázdný pattern odmítnut', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/rules`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'   ', category_id:10 }) });
  assert.equal(res.status, 400);
  server.close();
});

test('rules PATCH: částku nepošlu → zachová se (partial update)', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  // create rule with amount_max_abs=200
  let res = await fetch(`${base}/api/rules`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'SHELL', category_id:10, amount_max_abs:200 }) });
  const created = await res.json();
  assert.equal(created.amount_max_abs, 200);
  // PATCH only the pattern — amount must survive
  res = await fetch(`${base}/api/rules/${created.id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'SHELL CZ' }) });
  assert.equal(res.status, 200);
  const patched = await res.json();
  assert.equal(patched.pattern, 'SHELL CZ');
  assert.equal(patched.amount_max_abs, 200); // preserved
  server.close();
});

test('rules: min > max odmítnuto', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/rules`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'X', category_id:10, amount_min_abs:500, amount_max_abs:100 }) });
  assert.equal(res.status, 400);
  server.close();
});

test('POST pravidlo se subcategory_id ho uloží a GET vrátí', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const catId = db.prepare("SELECT id FROM categories WHERE user_id=1 LIMIT 1").get().id;
  const subId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,?, 'ChatGPT')").run(catId).lastInsertRowid;
  const res = await fetch(`${base}/api/rules`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'OPENAI', category_id:catId, subcategory_id:subId }) });
  assert.equal(res.status, 200);
  const list = await (await fetch(`${base}/api/rules`)).json();
  const rule = list.find(r => r.pattern === 'OPENAI');
  assert.equal(rule.subcategory_id, subId);
  assert.equal(rule.subcategory_name, 'ChatGPT');
  server.close();
});

test('POST pravidlo s cizí subcategory_id (jiný uživatel) odmítnuto', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const catId = db.prepare("SELECT id FROM categories WHERE user_id=1 LIMIT 1").get().id;
  const otherCatId = db.prepare("SELECT id FROM categories WHERE user_id=2 LIMIT 1").get().id;
  const foreignSubId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (2,?, 'Cizí sub')")
    .run(otherCatId).lastInsertRowid;
  const res = await fetch(`${base}/api/rules`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'HACK', category_id:catId, subcategory_id:foreignSubId }) });
  assert.equal(res.status, 400);
  const list = await (await fetch(`${base}/api/rules`)).json();
  assert.equal(list.find(r => r.pattern === 'HACK'), undefined);
  server.close();
});

test('POST pravidlo se subcategory_id patřící vlastníkovi, ale pod jinou kategorií, odmítnuto', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const catId = db.prepare("SELECT id FROM categories WHERE user_id=1 LIMIT 1").get().id;
  const otherCatId = db.prepare("INSERT INTO categories (user_id, name) VALUES (1,'Jídlo')").run().lastInsertRowid;
  const subId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,?, 'Restaurace')")
    .run(otherCatId).lastInsertRowid;
  const res = await fetch(`${base}/api/rules`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'MISMATCH', category_id:catId, subcategory_id:subId }) });
  assert.equal(res.status, 400);
  server.close();
});

test('PATCH pravidlo s cizí subcategory_id odmítnuto', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const catId = db.prepare("SELECT id FROM categories WHERE user_id=1 LIMIT 1").get().id;
  const otherCatId = db.prepare("SELECT id FROM categories WHERE user_id=2 LIMIT 1").get().id;
  const foreignSubId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (2,?, 'Cizí sub 2')")
    .run(otherCatId).lastInsertRowid;
  const created = await (await fetch(`${base}/api/rules`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'OK', category_id:catId }) })).json();
  const res = await fetch(`${base}/api/rules/${created.id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ subcategory_id:foreignSubId }) });
  assert.equal(res.status, 400);
  const patched = db.prepare('SELECT subcategory_id FROM category_rules WHERE id = ?').get(created.id);
  assert.equal(patched.subcategory_id, null);
  server.close();
});
