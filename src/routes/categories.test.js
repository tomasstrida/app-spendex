'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-categories-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./categories']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x'),(2,'out@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (10,1,'Oblečení',1),(11,2,'Cizí',1)").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/categories', require('./categories'));
  return { db, app };
}

test('PATCH type 1→2: smaže měsíční budgety (default i override) kategorie', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO budgets (user_id, category_id, month, amount) VALUES (1,10,'default',2000),(1,10,'2026-06',3000)").run();

  const res = await fetch(`${base}/api/categories/10`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ type: 2 }) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).type, 2);

  const left = db.prepare("SELECT COUNT(*) c FROM budgets WHERE user_id=1 AND category_id=10").get().c;
  assert.equal(left, 0, 'měsíční budgety měly být smazány');
  server.close();
});

test('PATCH type zůstává 1: měsíční budgety zachovány', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO budgets (user_id, category_id, month, amount) VALUES (1,10,'default',2000)").run();

  const res = await fetch(`${base}/api/categories/10`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name: 'Oblečení a obuv' }) });
  assert.equal(res.status, 200);

  const left = db.prepare("SELECT COUNT(*) c FROM budgets WHERE user_id=1 AND category_id=10").get().c;
  assert.equal(left, 1, 'budgety se neměly mazat při zachování typu 1');
  server.close();
});

test('PATCH type 1→3 (fond): rovněž smaže měsíční budgety', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO budgets (user_id, category_id, month, amount) VALUES (1,10,'default',2000)").run();

  const res = await fetch(`${base}/api/categories/10`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ type: 3, typical_price: 5000, frequency_months: 12 }) });
  assert.equal(res.status, 200);

  const left = db.prepare("SELECT COUNT(*) c FROM budgets WHERE user_id=1 AND category_id=10").get().c;
  assert.equal(left, 0);
  server.close();
});
