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

async function draw(base, pkgId, body = {}) {
  return fetch(`${base}/api/prepaid/${pkgId}/draws`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('POST draws zapise cerpani s cenou jednotky a posune zbytek', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  const r = await draw(base, pkg.id, { date: '2026-04-02' });
  assert.equal(r.status, 201);
  const updated = await r.json();
  assert.equal(updated.drawn_units, 1);
  assert.equal(updated.drawn_amount, 500);
  assert.equal(updated.remaining_units, 9);
  assert.equal(updated.draws[0].amount, 500);
  server.close();
});

test('POST draws umi vice jednotek najednou', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  const updated = await (await draw(base, pkg.id, { units: 3, date: '2026-04-02' })).json();
  assert.equal(updated.drawn_amount, 1500);
  assert.equal(updated.remaining_units, 7);
  server.close();
});

test('POST draws odmitne prekroceni zbyvajicich jednotek', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  await draw(base, pkg.id, { units: 9, date: '2026-04-02' });
  const r = await draw(base, pkg.id, { units: 2, date: '2026-04-03' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /zbývá/i);
  server.close();
});

test('POST draws odmitne nekladne jednotky a spatny format data', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  assert.equal((await draw(base, pkg.id, { units: 0 })).status, 400);
  assert.equal((await draw(base, pkg.id, { date: '2. 4. 2026' })).status, 400);
  server.close();
});

test('DELETE draws smaze cerpani a vrati zbytek', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  const afterDraw = await (await draw(base, pkg.id, { date: '2026-04-02' })).json();
  const drawId = afterDraw.draws[0].id;
  const r = await fetch(`${base}/api/prepaid/draws/${drawId}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  const n = db.prepare('SELECT COUNT(*) AS n FROM prepaid_draws').get().n;
  assert.equal(n, 0);
  server.close();
});

test('cerpani cizim uzivatelem neprojde', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const pkgId = db.prepare(`
    INSERT INTO prepaid_packages (user_id, category_id, name, total_amount, units_total, unit_amount)
    VALUES (2, 9, 'Cizi balicek', 1000, 2, 500)
  `).run().lastInsertRowid;
  assert.equal((await draw(base, pkgId, {})).status, 404);
  server.close();
});

async function close(base, pkgId, writeOff) {
  return fetch(`${base}/api/prepaid/${pkgId}/close`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ write_off: writeOff }),
  });
}

test('close s write_off doucuje zbytek jednim cerpanim', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  await draw(base, pkg.id, { units: 4, date: '2026-04-02' });
  const closed = await (await close(base, pkg.id, true)).json();
  assert.equal(closed.status, 'closed');
  assert.equal(closed.drawn_amount, 5000, 'doucteni srovna celou castku');
  assert.equal(closed.remaining_amount, 0);
  assert.equal(closed.draws.length, 2);
  assert.equal(closed.draws[1].amount, 3000);
  server.close();
});

test('close bez write_off jen uzavre a zbytek nechá nedocerpany', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  await draw(base, pkg.id, { units: 4, date: '2026-04-02' });
  const closed = await (await close(base, pkg.id, false)).json();
  assert.equal(closed.status, 'closed');
  assert.equal(closed.drawn_amount, 2000);
  assert.equal(closed.remaining_amount, 3000);
  server.close();
});

test('uzavreny balicek uz nelze cerpat', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  await close(base, pkg.id, false);
  const r = await draw(base, pkg.id, { date: '2026-05-02' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /uzavřen/i);
  server.close();
});

test('DELETE vrati transakci do puvodni kategorie a smaze cerpani', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  await draw(base, pkg.id, { date: '2026-04-02' });
  const r = await fetch(`${base}/api/prepaid/${pkg.id}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT category_id FROM transactions WHERE id = 100').get().category_id, 5);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prepaid_draws').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prepaid_packages').get().n, 0);
  server.close();
});

test('GET status=closed vraci uzavrene balicky', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  await close(base, pkg.id, false);
  assert.equal((await (await fetch(`${base}/api/prepaid`)).json()).packages.length, 0);
  assert.equal((await (await fetch(`${base}/api/prepaid?status=closed`)).json()).packages.length, 1);
  assert.equal((await (await fetch(`${base}/api/prepaid?status=all`)).json()).packages.length, 1);
  server.close();
});
