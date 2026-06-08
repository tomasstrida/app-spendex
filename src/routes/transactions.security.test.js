'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const express = require('express');
function freshApp() {
  const tmp = path.join(os.tmpdir(), `spendex-tx-sec-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./transactions']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO users (id, email) VALUES (2,'c@d.cz')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (10, 2, 'CizíKat')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (11, 1, 'MojeKat')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/transactions', require('./transactions'));
  return { app, db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }
function post(base, body){ return fetch(`${base}/api/transactions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); }

test('POST s cizí category_id → 400', async () => {
  const { app, db, tmp } = freshApp(); const { server, base } = await listen(app);
  const r = await post(base, { amount: -100, date: '2026-06-08', category_id: 10 });
  server.close(); cleanup(db, tmp);
  assert.equal(r.status, 400);
});
test('POST s vlastní category_id → 201', async () => {
  const { app, db, tmp } = freshApp(); const { server, base } = await listen(app);
  const r = await post(base, { amount: -100, date: '2026-06-08', category_id: 11 });
  server.close(); cleanup(db, tmp);
  assert.equal(r.status, 201);
});
test('POST amount=0 projde (regrese), amount="abc" → 400, date špatný → 400', async () => {
  const { app, db, tmp } = freshApp(); const { server, base } = await listen(app);
  const ok = await post(base, { amount: 0, date: '2026-06-08' });
  const badAmt = await post(base, { amount: 'abc', date: '2026-06-08' });
  const badDate = await post(base, { amount: -5, date: '8.6.2026' });
  server.close(); cleanup(db, tmp);
  assert.equal(ok.status, 201);
  assert.equal(badAmt.status, 400);
  assert.equal(badDate.status, 400);
});
