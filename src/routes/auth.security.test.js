'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const express = require('express');
function freshApp() {
  const tmp = path.join(os.tmpdir(), `spendex-auth-sec-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./auth','../services/passport']) { try { delete require.cache[require.resolve(m)]; } catch {/* ok */} }
  const db = require('../db/connection'); require('../db/schema').initSchema();
  const app = express(); app.use(express.json());
  app.use('/auth', require('./auth'));
  return { app, db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

test('/auth/verify s prošlým tokenem → redirect na invalid_token', async () => {
  const { app, db, tmp } = freshApp();
  db.prepare("INSERT INTO users (id, email, verify_token, verify_expires) VALUES (1, 'a@b.cz', 'tok', ?)").run(Date.now() - 1000);
  const { server, base } = await listen(app);
  const r = await fetch(`${base}/auth/verify?token=tok`, { redirect: 'manual' });
  server.close(); cleanup(db, tmp);
  assert.ok(r.status >= 300 && r.status < 400);
  assert.match(r.headers.get('location') || '', /invalid_token/);
});
test('/auth/verify s platným tokenem → ověří uživatele', async () => {
  const { app, db, tmp } = freshApp();
  db.prepare("INSERT INTO users (id, email, verify_token, verify_expires) VALUES (1, 'a@b.cz', 'tok2', ?)").run(Date.now() + 3600_000);
  const { server, base } = await listen(app);
  await fetch(`${base}/auth/verify?token=tok2`, { redirect: 'manual' });
  const verified = db.prepare("SELECT email_verified FROM users WHERE id=1").get().email_verified;
  server.close(); cleanup(db, tmp);
  assert.equal(verified, 1);
});
