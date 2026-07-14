'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-fx-route-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./fixed-expenses']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/fixed-expenses', require('./fixed-expenses'));
  return { db, app };
}
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

test('POST přijme rozmezí + frekvenci', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Nájem', amount:38000, amount_min:36000, amount_max:40000, frequency_months:1 }) });
  assert.equal(res.status, 201);
  const row = await res.json();
  assert.equal(row.amount_min, 36000);
  assert.equal(row.amount_max, 40000);
  assert.equal(row.frequency_months, 1);
  server.close();
});

test('POST s min > max → 400', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Nájem', amount:38000, amount_min:40000, amount_max:36000 }) });
  assert.equal(res.status, 400);
  server.close();
});
