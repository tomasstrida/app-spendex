'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-prepaid-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./prepaid']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x'),(2,'jiny@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (5,1,'Sport',1),(6,1,'Oblečení',2),(9,2,'Cizí',1)").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type, system_role) VALUES (7,1,'Nákup předplacených balíčků',4,'prepaid_purchase')").run();
  db.prepare("INSERT INTO transactions (id, user_id, category_id, amount, date, description) VALUES (100,1,5,-5000,'2026-03-04','Fitness 10x')").run();
  db.prepare("INSERT INTO transactions (id, user_id, category_id, amount, date, description) VALUES (101,2,9,-1000,'2026-03-04','Cizi platba')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/prepaid', require('./prepaid'));
  return { db, app };
}

async function createPackage(base, body = {}) {
  return fetch(`${base}/api/prepaid`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction_id: 100, name: 'Fitness 10x', category_id: 5, units_total: 10, ...body }),
  });
}

test('POST zalozi balicek a prehodi transakci do technicke kategorie', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const r = await createPackage(base);
  assert.equal(r.status, 201);
  const pkg = await r.json();
  assert.equal(pkg.total_amount, 5000);
  assert.equal(pkg.unit_amount, 500);
  assert.equal(pkg.category_id, 5);
  assert.equal(pkg.original_category_id, 5);
  assert.equal(pkg.status, 'active');
  const tx = db.prepare('SELECT category_id FROM transactions WHERE id = 100').get();
  assert.equal(tx.category_id, 7, 'transakce patri do kategorie prepaid_purchase');
  server.close();
});

test('POST odmitne cizi transakci i cizi kategorii', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  assert.equal((await createPackage(base, { transaction_id: 101 })).status, 404);
  assert.equal((await createPackage(base, { category_id: 9 })).status, 404);
  server.close();
});

test('POST odmitne kategorii, ktera neni typ 1', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const r = await createPackage(base, { category_id: 6 });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /měsíční/i);
  server.close();
});

test('POST odmitne neplatny pocet jednotek a prijmovou transakci', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  assert.equal((await createPackage(base, { units_total: 0 })).status, 400);
  db.prepare("INSERT INTO transactions (id,user_id,category_id,amount,date,description) VALUES (102,1,5,3000,'2026-03-05','Prijem')").run();
  assert.equal((await createPackage(base, { transaction_id: 102 })).status, 400);
  server.close();
});

test('GET vraci aktivni balicky s dopoctem zbytku', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  db.prepare("INSERT INTO prepaid_draws (user_id, package_id, date, units, amount) VALUES (1,?,'2026-04-02',2,1000)").run(pkg.id);
  const { packages } = await (await fetch(`${base}/api/prepaid`)).json();
  assert.equal(packages.length, 1);
  assert.equal(packages[0].drawn_units, 2);
  assert.equal(packages[0].remaining_units, 8);
  assert.equal(packages[0].remaining_amount, 4000);
  assert.equal(packages[0].category_name, 'Sport');
  assert.equal(packages[0].draws.length, 1);
  server.close();
});

test('GET s period vraci jen cerpani daneho obdobi, zbytek pocita ze vsech', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  db.prepare("INSERT INTO prepaid_draws (user_id, package_id, date, units, amount) VALUES (1,?,'2026-04-02',1,500),(1,?,'2026-05-02',1,500)").run(pkg.id, pkg.id);
  const { packages } = await (await fetch(`${base}/api/prepaid?period=2026-04`)).json();
  assert.equal(packages[0].draws.length, 1, 'jen cerpani z dubna');
  assert.equal(packages[0].draws[0].date, '2026-04-02');
  assert.equal(packages[0].drawn_units, 2, 'zbytek se pocita ze vsech cerpani');
  server.close();
});
