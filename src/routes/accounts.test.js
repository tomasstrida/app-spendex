'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-accounts-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./accounts']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/accounts', require('./accounts'));
  return { db, app };
}

test('POST: is_fund se uloží jako 1, default je 0', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const a = await (await fetch(`${base}/api/accounts`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Licence', account_number:'200/3030', is_fund:true }) })).json();
  const b = await (await fetch(`${base}/api/accounts`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Společný', account_number:'300/3030' }) })).json();
  server.close();
  assert.equal(a.is_fund, 1);
  assert.equal(b.is_fund, 0);
});

test('PATCH: is_fund lze zapnout i vypnout, vynechání ho nemění', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const acc = await (await fetch(`${base}/api/accounts`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Licence', account_number:'200/3030' }) })).json();
  const on = await (await fetch(`${base}/api/accounts/${acc.id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ is_fund: true }) })).json();
  assert.equal(on.is_fund, 1);
  const renamed = await (await fetch(`${base}/api/accounts/${acc.id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name: 'Licence 2' }) })).json();
  assert.equal(renamed.is_fund, 1, 'partial update nesmí is_fund shodit');
  const off = await (await fetch(`${base}/api/accounts/${acc.id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ is_fund: false }) })).json();
  server.close();
  assert.equal(off.is_fund, 0);
});

test('GET: seznam obsahuje is_fund', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  await fetch(`${base}/api/accounts`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Licence', is_fund:true }) });
  const rows = await (await fetch(`${base}/api/accounts`)).json();
  server.close();
  assert.equal(rows[0].is_fund, 1);
});
