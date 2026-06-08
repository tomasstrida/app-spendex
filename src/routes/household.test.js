'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const express = require('express');

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-household-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./household']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email, name) VALUES (1,'owner@x','Owner'),(2,'member@x','Member'),(3,'solo@x','Solo')").run();
  return { db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
function appFor(uid){
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:uid}; req.isAuthenticated=()=>true; next(); });
  app.use('/api/household', require('./household'));
  return app;
}
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }
function jpost(base, p, body){ return fetch(`${base}${p}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})}); }

test('invite → join → membership vznikne a kód se spotřebuje', async () => {
  const { db, tmp } = setup();
  let l = await listen(appFor(1));
  const { code } = await (await jpost(l.base, '/api/household/invite')).json();
  l.server.close();
  assert.ok(code && code.length > 10);
  l = await listen(appFor(2));
  const r = await jpost(l.base, '/api/household/join', { code });
  l.server.close();
  assert.equal(r.status, 200);
  const mem = db.prepare("SELECT data_owner_id FROM household_members WHERE user_id = 2").get();
  const invGone = db.prepare("SELECT 1 FROM household_invites WHERE token = ?").get(code);
  cleanup(db, tmp);
  assert.equal(mem.data_owner_id, 1);
  assert.equal(invGone, undefined);
});

test('join: vlastní domácnost → 400, neplatný kód → 400', async () => {
  const { db, tmp } = setup();
  const l = await listen(appFor(1));
  const { code } = await (await jpost(l.base, '/api/household/invite')).json();
  const own = await jpost(l.base, '/api/household/join', { code });
  const bad = await jpost(l.base, '/api/household/join', { code: 'neexistuje' });
  l.server.close(); cleanup(db, tmp);
  assert.equal(own.status, 400);
  assert.equal(bad.status, 400);
});

test('join: už člen → 409', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  db.prepare("INSERT INTO household_invites (data_owner_id, token) VALUES (3, 'kod3')").run();
  const l = await listen(appFor(2));
  const r = await jpost(l.base, '/api/household/join', { code: 'kod3' });
  l.server.close(); cleanup(db, tmp);
  assert.equal(r.status, 409);
});

test('member nesmí generovat pozvánku → 403', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  const l = await listen(appFor(2));
  const r = await jpost(l.base, '/api/household/invite');
  l.server.close(); cleanup(db, tmp);
  assert.equal(r.status, 403);
});

test('leave smaže membership; ne-člen → 400', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  let l = await listen(appFor(2));
  const ok = await jpost(l.base, '/api/household/leave');
  l.server.close();
  const gone = db.prepare("SELECT 1 FROM household_members WHERE user_id = 2").get();
  l = await listen(appFor(3));
  const no = await jpost(l.base, '/api/household/leave');
  l.server.close(); cleanup(db, tmp);
  assert.equal(ok.status, 200);
  assert.equal(gone, undefined);
  assert.equal(no.status, 400);
});

test('owner odebere člena; cizí/neexistující → 404', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  let l = await listen(appFor(1));
  const ok = await fetch(`${l.base}/api/household/members/2`, { method:'DELETE' });
  l.server.close();
  const gone = db.prepare("SELECT 1 FROM household_members WHERE user_id = 2").get();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  l = await listen(appFor(3));
  const no = await fetch(`${l.base}/api/household/members/2`, { method:'DELETE' });
  l.server.close(); cleanup(db, tmp);
  assert.equal(ok.status, 200);
  assert.equal(gone, undefined);
  assert.equal(no.status, 404);
});

test('GET / vrací role solo/owner/member', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  let l = await listen(appFor(1)); const owner = await (await fetch(`${l.base}/api/household`)).json(); l.server.close();
  l = await listen(appFor(2)); const member = await (await fetch(`${l.base}/api/household`)).json(); l.server.close();
  l = await listen(appFor(3)); const solo = await (await fetch(`${l.base}/api/household`)).json(); l.server.close();
  cleanup(db, tmp);
  assert.equal(owner.role, 'owner');
  assert.ok(owner.members.some(m=>m.user_id===2));
  assert.equal(member.role, 'member');
  assert.equal(member.owner.id, 1);
  assert.equal(solo.role, 'solo');
});
