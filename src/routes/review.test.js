'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-review-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./review']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x')").run();
  // kategorie: reálné (typ 1/2/3) + výjimky
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (1,1,'Drahé věci',3),(2,1,'Jídlo',1),(3,1,'Mimo systém',1),(4,1,'Pravidelné platby',1)").run();
  // účty: spending + ignored + income
  db.prepare("INSERT INTO accounts (id,user_id,account_number,name,role) VALUES (10,1,'100/3030','Společný','spending'),(11,1,'200/3030','Spořicí','ignored'),(12,1,'300/3030','Tom-OSVC','income')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/review', require('./review'));
  return { db, app };
}
const get = async (base) => (await fetch(`${base}/api/review/misplaced`)).json();

test('detekce: reálná kategorie na ignorovaném účtu = podezřelá', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (id,user_id,category_id,account_id,amount,date,description,counterparty_account) VALUES (100,1,1,11,-4000,'2026-05-10','Drahá věc ze spořicího','999/0800')").run();
  const rows = await get(base);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 100);
  server.close();
});

test('detekce: stejná tx na výdajovém (spending) účtu NENÍ podezřelá', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description,counterparty_account) VALUES (1,1,10,-4000,'2026-05-10','OK ze společného','999/0800')").run();
  assert.equal((await get(base)).length, 0);
  server.close();
});

test('detekce: OSVČ (income) účet se ignoruje', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description,counterparty_account) VALUES (1,1,12,-4000,'2026-05-10','OSVC drahá věc','999/0800')").run();
  assert.equal((await get(base)).length, 0);
  server.close();
});

test('detekce: kategorie Mimo systém / Pravidelné platby se vylučují', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description,counterparty_account) VALUES (1,3,11,-4000,'2026-05-10','mimo','999/0800'),(1,4,11,-2000,'2026-05-11','fixni','888/0800')").run();
  assert.equal((await get(base)).length, 0);
  server.close();
});

test('detekce: interní převod (counterparty = vlastní účet) se vylučuje', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  // counterparty = 100/3030 = vlastní Společný účet → interní převod
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description,counterparty_account) VALUES (1,1,11,-4000,'2026-05-10','převod','100/3030')").run();
  assert.equal((await get(base)).length, 0);
  server.close();
});

test('dismiss skryje položku, undismiss ji vrátí', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (id,user_id,category_id,account_id,amount,date,description,counterparty_account) VALUES (100,1,1,11,-4000,'2026-05-10','x','999/0800')").run();
  assert.equal((await get(base)).length, 1);
  const d = await fetch(`${base}/api/review/dismiss`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:100})});
  assert.equal(d.status, 200);
  assert.equal((await get(base)).length, 0);
  await fetch(`${base}/api/review/undismiss`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:100})});
  assert.equal((await get(base)).length, 1);
  server.close();
});

test('dismiss cizí/neexistující tx = 404', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const r = await fetch(`${base}/api/review/dismiss`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:9999})});
  assert.equal(r.status, 404);
  server.close();
});
