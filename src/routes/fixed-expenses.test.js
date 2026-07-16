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
    body: JSON.stringify({ name:'Nájem', amount:38000, amount_min:36000, amount_max:40000, frequency_months:1, match_pattern:'NÁJEM' }) });
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
    body: JSON.stringify({ name:'Nájem', amount:38000, amount_min:40000, amount_max:36000, match_pattern:'NÁJEM' }) });
  assert.equal(res.status, 400);
  server.close();
});

test('PATCH jen amount_min vyšší než stávající amount_max → 400', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  // POST položka
  const postRes = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Nájem', amount:38000, amount_min:36000, amount_max:40000, frequency_months:1, match_pattern:'NÁJEM' }) });
  assert.equal(postRes.status, 201);
  const row = await postRes.json();
  const id = row.id;
  // PATCH amount_min na 41000 (koliduje s max 40000)
  const patchRes = await fetch(`${base}/api/fixed-expenses/${id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ amount_min: 41000 }) });
  assert.equal(patchRes.status, 400);
  server.close();
});

test('PATCH jen amount_max nižší než stávající amount_min → 400', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  // POST položka
  const postRes = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Nájem', amount:38000, amount_min:36000, amount_max:40000, frequency_months:1, match_pattern:'NÁJEM' }) });
  assert.equal(postRes.status, 201);
  const row = await postRes.json();
  const id = row.id;
  // PATCH amount_max na 35000 (koliduje s min 36000)
  const patchRes = await fetch(`${base}/api/fixed-expenses/${id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ amount_max: 35000 }) });
  assert.equal(patchRes.status, 400);
  server.close();
});

test('PATCH partial update zachová nezadaná pole', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  // POST položka s min/max/frequency
  const postRes = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Nájem', amount:38000, amount_min:36000, amount_max:40000, frequency_months:1, note:'Původní', match_pattern:'NÁJEM' }) });
  assert.equal(postRes.status, 201);
  const row = await postRes.json();
  const id = row.id;
  // PATCH jen note
  const patchRes = await fetch(`${base}/api/fixed-expenses/${id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ note: 'Nová poznámka' }) });
  assert.equal(patchRes.status, 200);
  const updated = await patchRes.json();
  assert.equal(updated.note, 'Nová poznámka');
  assert.equal(updated.amount_min, 36000);
  assert.equal(updated.amount_max, 40000);
  assert.equal(updated.frequency_months, 1);
  server.close();
});

test('POST bez matcheru → 400', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Nájem', amount:38000 }) });
  assert.equal(res.status, 400);
  server.close();
});

test('POST s counterparty → 201 a uloží číslo účtu', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Splátka', amount:5000, match_counterparty_account:'1679014999' }) });
  assert.equal(res.status, 201);
  const row = await res.json();
  assert.equal(row.match_counterparty_account, '1679014999');
  server.close();
});

test('PATCH odebrání jediného matcheru → 400', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const postRes = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Splátka', amount:5000, match_pattern:'SPLÁTKA' }) });
  const { id } = await postRes.json();
  const patchRes = await fetch(`${base}/api/fixed-expenses/${id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ match_pattern: null }) });
  assert.equal(patchRes.status, 400);
  server.close();
});

test('POST s valid_from/valid_to → 201 a uloží okno platnosti', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'T-Mobile internet', amount:600, match_pattern:'T-MOBILE', valid_from:'2026-08', valid_to:null }) });
  assert.equal(res.status, 201);
  const row = await res.json();
  assert.equal(row.valid_from, '2026-08');
  assert.equal(row.valid_to, null);
  server.close();
});

test('POST se špatným formátem valid_from → 400', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'X', amount:1, match_pattern:'X', valid_from:'srpen 2026' }) });
  assert.equal(res.status, 400);
  server.close();
});

test('POST s valid_from s nesmyslným měsícem (2026-13) → 400', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'X', amount:1, match_pattern:'X', valid_from:'2026-13' }) });
  assert.equal(res.status, 400);
  server.close();
});

test('POST s valid_from > valid_to → 400', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'X', amount:1, match_pattern:'X', valid_from:'2026-09', valid_to:'2026-08' }) });
  assert.equal(res.status, 400);
  server.close();
});

test('PATCH nastaví valid_to a nezaslaná pole zachová', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const postRes = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'NORDIC internet', amount:500, match_pattern:'NORDIC', valid_from:'2024-01' }) });
  const { id } = await postRes.json();
  const patchRes = await fetch(`${base}/api/fixed-expenses/${id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ valid_to:'2026-07' }) });
  assert.equal(patchRes.status, 200);
  const updated = await patchRes.json();
  assert.equal(updated.valid_to, '2026-07');
  assert.equal(updated.valid_from, '2024-01');
  assert.equal(updated.match_pattern, 'NORDIC');
  server.close();
});

test('PATCH valid_from do konfliktu se stávajícím valid_to → 400', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const postRes = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'X', amount:1, match_pattern:'X', valid_to:'2026-07' }) });
  const { id } = await postRes.json();
  const patchRes = await fetch(`${base}/api/fixed-expenses/${id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ valid_from:'2026-09' }) });
  assert.equal(patchRes.status, 400);
  server.close();
});

test('PATCH valid_to=null smaže konec platnosti', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const postRes = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'X', amount:1, match_pattern:'X', valid_to:'2026-07' }) });
  const { id } = await postRes.json();
  const patchRes = await fetch(`${base}/api/fixed-expenses/${id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ valid_to:null }) });
  assert.equal(patchRes.status, 200);
  const updated = await patchRes.json();
  assert.equal(updated.valid_to, null);
  server.close();
});
