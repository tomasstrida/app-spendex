'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const express = require('express');

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-inbox-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./emailInbox']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email, name) VALUES (1,'owner@x','Owner'),(2,'martin@x','Martin')").run();
  return { db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
function appFor(uid){
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:uid}; req.dataUserId=uid; req.isAuthenticated=()=>true; next(); });
  app.use('/api/email-inbox', require('./emailInbox'));
  return app;
}
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

test('GET / doplní card_owner_name/id pro kartu; null bez karty', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO cards (data_owner_id, last4, assigned_user_id) VALUES (1, '6062', 2)").run();
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'pending')")
    .run(JSON.stringify({ description: 'HAMR', amount: -482, card_last4: '6062' }));
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'pending')")
    .run(JSON.stringify({ description: 'Převod', amount: -100 }));
  const l = await listen(appFor(1));
  const rows = await (await fetch(`${l.base}/api/email-inbox`)).json();
  l.server.close(); cleanup(db, tmp);
  const withCard = rows.find(r => JSON.parse(r.parsed_json).card_last4 === '6062');
  const noCard = rows.find(r => JSON.parse(r.parsed_json).description === 'Převod');
  assert.equal(withCard.card_owner_name, 'Martin');
  assert.equal(withCard.card_owner_id, 2);
  assert.equal(noCard.card_owner_name, null);
});
