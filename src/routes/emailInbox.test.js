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

test('GET / vrací i awaiting_card položky', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'awaiting_card')")
    .run(JSON.stringify({ description: 'HAMR', amount: -482, card_last4: '6062' }));
  const l = await listen(appFor(1));
  const rows = await (await fetch(`${l.base}/api/email-inbox`)).json();
  l.server.close(); cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'awaiting_card');
});

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

function appForMember(currentUid, ownerUid){
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:currentUid}; req.dataUserId=ownerUid; req.isAuthenticated=()=>true; next(); });
  app.use('/api/email-inbox', require('./emailInbox'));
  return app;
}

test('member vidí jen svoje karetní platby + awaiting_card, ne cizí ani bez karty', async () => {
  const { db, tmp } = setup();
  // Martin je člen domácnosti (data_owner = 1) — requireAuth to přečte a nastaví dataUserId=1
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1,2)").run();
  // karty: 6062 → Martin(2), 1111 → owner(1)
  db.prepare("INSERT INTO cards (data_owner_id, last4, assigned_user_id) VALUES (1,'6062',2),(1,'1111',1)").run();
  // Martinova karetní platba (pending)
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'pending')")
    .run(JSON.stringify({ description: 'Martin nákup', amount: -200, card_last4: '6062' }));
  // Owner karetní platba (pending) — Martin NEMÁ vidět
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'pending')")
    .run(JSON.stringify({ description: 'Owner nákup', amount: -300, card_last4: '1111' }));
  // Platba bez karty (převod) — Martin NEMÁ vidět
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'pending')")
    .run(JSON.stringify({ description: 'Převod', amount: -100 }));
  // awaiting_card (neznámá) — Martin MÁ vidět
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'awaiting_card')")
    .run(JSON.stringify({ description: 'Neznámá karta', amount: -50, card_last4: '9999' }));

  const l = await listen(appForMember(2, 1));
  const rows = await (await fetch(`${l.base}/api/email-inbox`)).json();
  l.server.close(); cleanup(db, tmp);
  const descs = rows.map(r => JSON.parse(r.parsed_json).description).sort();
  assert.deepEqual(descs, ['Martin nákup', 'Neznámá karta']);
});

test('owner vidí vše (beze změny)', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1,2)").run();
  db.prepare("INSERT INTO cards (data_owner_id, last4, assigned_user_id) VALUES (1,'6062',2)").run();
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'pending')")
    .run(JSON.stringify({ description: 'Martin nákup', amount: -200, card_last4: '6062' }));
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'pending')")
    .run(JSON.stringify({ description: 'Převod', amount: -100 }));
  const l = await listen(appFor(1));
  const rows = await (await fetch(`${l.base}/api/email-inbox`)).json();
  l.server.close(); cleanup(db, tmp);
  assert.equal(rows.length, 2);
});

test('member /history filtruje stejně', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1,2)").run();
  db.prepare("INSERT INTO cards (data_owner_id, last4, assigned_user_id) VALUES (1,'6062',2),(1,'1111',1)").run();
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'imported')")
    .run(JSON.stringify({ description: 'Martin nákup', amount: -200, card_last4: '6062' }));
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'imported')")
    .run(JSON.stringify({ description: 'Owner nákup', amount: -300, card_last4: '1111' }));
  const l = await listen(appForMember(2, 1));
  const rows = await (await fetch(`${l.base}/api/email-inbox/history`)).json();
  l.server.close(); cleanup(db, tmp);
  const descs = rows.map(r => JSON.parse(r.parsed_json).description);
  assert.deepEqual(descs, ['Martin nákup']);
});
