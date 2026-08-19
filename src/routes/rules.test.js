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

test('suggestions: scan najde kandidáta, approve založí category_rules pravidlo', async () => {
  const { app, db } = setup();
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
                VALUES (1, 10, -5000, '2026-0${i + 1}-15', 'DPH', '705-77628031/0710')`).run();
  }
  const { server, base } = await listen(app);

  let res = await fetch(`${base}/api/rules/suggestions/scan`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).found, 1);

  res = await fetch(`${base}/api/rules/suggestions`);
  const list = await res.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].counterparty_account, '705-77628031/0710');
  assert.equal(list[0].category_name, 'Sport'); // fixture kategorie id=10 se jmenuje Sport (viz setup())

  res = await fetch(`${base}/api/rules/suggestions/${list[0].id}/approve`, { method: 'POST' });
  assert.equal(res.status, 200);

  const rules = await (await fetch(`${base}/api/rules`)).json();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].pattern, '');

  res = await fetch(`${base}/api/rules/suggestions`);
  assert.equal((await res.json()).length, 0); // approved zmizí z pending listu
  server.close();
});

test('suggestions: dismiss zavře návrh bez založení pravidla', async () => {
  const { app, db } = setup();
  db.prepare(`INSERT INTO rule_suggestions (user_id, counterparty_account, category_id, coverage_count, purity)
              VALUES (1, '705-77628031/0710', 10, 3, 1.0)`).run();
  const { server, base } = await listen(app);
  const list = await (await fetch(`${base}/api/rules/suggestions`)).json();
  const res = await fetch(`${base}/api/rules/suggestions/${list[0].id}/dismiss`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal((await (await fetch(`${base}/api/rules/suggestions`)).json()).length, 0);
  assert.equal((await (await fetch(`${base}/api/rules`)).json()).length, 0);
  server.close();
});

test('suggestions: approve cizího návrhu vrací 404', async () => {
  const { app, db } = setup();
  db.prepare(`INSERT INTO rule_suggestions (user_id, counterparty_account, category_id, coverage_count, purity)
              VALUES (2, '705-77628031/0710', 11, 3, 1.0)`).run();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/rules/suggestions/1/approve`, { method: 'POST' });
  assert.equal(res.status, 404);
  server.close();
});

// Spec §8: schválení návrhu musí pročistit i frontu — jinak uživatel doklikává
// zbylé platby téhož protiúčtu ručně, což je bolest, kterou feature řeší.
test('suggestions: approve přeřadí čekající platby téhož protiúčtu z fronty', async () => {
  const { app, db } = setup();
  db.prepare(`INSERT INTO rule_suggestions (user_id, counterparty_account, category_id, coverage_count, purity)
              VALUES (1, '705-77628031/0710', 10, 3, 1.0)`).run();
  // Čekající platba na tentýž protiúčet — dosud nezařazená (fallback kategorie).
  db.prepare(`INSERT INTO email_inbox (user_id, parsed_json, external_id, status)
              VALUES (1, ?, 'ext-dph-1', 'pending')`)
    .run(JSON.stringify({ description: 'DPH 2026/09', amount: -5000, date: '2026-09-15',
                          currency: 'CZK', counterparty_account: '705-77628031/0710' }));

  const { server, base } = await listen(app);
  const list = await (await fetch(`${base}/api/rules/suggestions`)).json();
  const res = await fetch(`${base}/api/rules/suggestions/${list[0].id}/approve`, { method: 'POST' });
  const body = await res.json();
  server.close();

  assert.equal(res.status, 200);
  assert.equal(body.recategorized, 1, 'approve má vrátit počet přeřazených položek');
  const inbox = db.prepare("SELECT status FROM email_inbox WHERE external_id = 'ext-dph-1'").get();
  assert.equal(inbox.status, 'imported', 'čekající platba měla odejít z fronty');
  const tx = db.prepare("SELECT category_id FROM transactions WHERE external_id = 'ext-dph-1'").get();
  assert.equal(tx.category_id, 10, 'platba se měla zařadit do kategorie z návrhu');
});

test('suggestions: dismiss už vyřešeného návrhu vrací 400', async () => {
  const { app, db } = setup();
  db.prepare(`INSERT INTO rule_suggestions (user_id, counterparty_account, category_id, coverage_count, purity, status)
              VALUES (1, '705-77628031/0710', 10, 3, 1.0, 'approved')`).run();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/rules/suggestions/1/dismiss`, { method: 'POST' });
  server.close();
  assert.equal(res.status, 400);
});
