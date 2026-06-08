'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

test('izolace domácností: člen vidí vlastníkovu kategorii, outsider ne', async () => {
  const tmp = path.join(os.tmpdir(), `spendex-hh-iso-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./categories']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x'),(2,'m@x'),(3,'out@x')").run();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  db.prepare("INSERT INTO categories (user_id, name) VALUES (1, 'Sdílená')").run();

  function appFor(uid){
    const app = express(); app.use(express.json());
    app.use((req,_res,next)=>{
      req.user = { id: uid };
      const r = db.prepare('SELECT data_owner_id FROM household_members WHERE user_id = ?').get(uid);
      req.dataUserId = r ? r.data_owner_id : uid;
      req.isAuthenticated = () => true; next();
    });
    app.use('/api/categories', require('./categories'));
    return app;
  }

  const m = await listen(appFor(2));   // člen
  const memberCats = await (await fetch(`${m.base}/api/categories`)).json();
  m.server.close();

  const o = await listen(appFor(3));   // outsider
  const outsiderCats = await (await fetch(`${o.base}/api/categories`)).json();
  o.server.close();

  db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}}

  // GET /api/categories returns a plain array
  assert.ok(Array.isArray(memberCats), 'odpověď kategorie je pole');
  assert.ok(memberCats.some(c=>c.name==='Sdílená'), 'člen musí vidět vlastníkovu kategorii');
  assert.ok(!outsiderCats.some(c=>c.name==='Sdílená'), 'outsider NESMÍ vidět cizí kategorii');
});

test('izolace domácností: člen vidí vlastníkovu transakci, outsider ne', async () => {
  const tmp = path.join(os.tmpdir(), `spendex-hh-iso-tx-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./transactions']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x'),(2,'m@x'),(3,'out@x')").run();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  db.prepare("INSERT INTO transactions (user_id, amount, currency, date, description, source) VALUES (1, -123, 'CZK', '2026-06-08', 'SdilenaTx', 'manual')").run();

  function appFor(uid){
    const app = express(); app.use(express.json());
    app.use((req,_res,next)=>{
      req.user = { id: uid };
      const r = db.prepare('SELECT data_owner_id FROM household_members WHERE user_id = ?').get(uid);
      req.dataUserId = r ? r.data_owner_id : uid;
      req.isAuthenticated = () => true; next();
    });
    app.use('/api/transactions', require('./transactions'));
    return app;
  }

  const m = await listen(appFor(2));
  const memberTx = await (await fetch(`${m.base}/api/transactions`)).json();
  m.server.close();
  const o = await listen(appFor(3));
  const outsiderTx = await (await fetch(`${o.base}/api/transactions`)).json();
  o.server.close();
  db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}}

  // GET /api/transactions returns a plain array
  assert.ok(Array.isArray(memberTx), 'odpověď transakcí je pole');
  assert.ok(memberTx.some(t=>t.description==='SdilenaTx'), 'člen musí vidět vlastníkovu transakci');
  assert.ok(!outsiderTx.some(t=>t.description==='SdilenaTx'), 'outsider NESMÍ vidět cizí transakci');
});
