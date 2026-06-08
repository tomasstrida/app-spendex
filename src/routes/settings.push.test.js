'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

function freshApp() {
  const tmp = path.join(os.tmpdir(), `spendex-settings-push-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection', '../db/schema', './settings']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1 }; req.dataUserId = 1; req.isAuthenticated = () => true; next(); });
  app.use('/api/settings', require('./settings'));
  return { app, db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + s); } catch { /* ok */ } }
}
async function listen(app) {
  const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('PUT /api/settings uloží notify_scope a GET ho vrátí', async () => {
  const { app, db, tmp } = freshApp();
  const { server, base } = await listen(app);
  await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ billing_day: 1, notify_scope: 'all' }) });
  const r = await fetch(`${base}/api/settings`);
  const j = await r.json();
  server.close(); cleanup(db, tmp);
  assert.equal(j.notify_scope, 'all');
});

test('PUT /api/settings odmítne neplatný notify_scope', async () => {
  const { app, db, tmp } = freshApp();
  const { server, base } = await listen(app);
  const r = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ billing_day: 1, notify_scope: 'haha' }) });
  server.close(); cleanup(db, tmp);
  assert.equal(r.status, 400);
});

test('člen čte billing_day vlastníka, ale vlastní notify_scope', async () => {
  const { app, db, tmp } = freshApp(); // user 1 is the acting user in this harness
  // simuluj: vlastník (1) má billing_day=15; člen (2) má vlastní notify_scope='all'
  db.prepare("INSERT INTO settings (user_id, billing_day) VALUES (1, 15)").run();
  db.prepare("INSERT INTO users (id, email) VALUES (2, 'm@x.cz')").run();
  db.prepare("INSERT INTO settings (user_id, billing_day, notify_scope) VALUES (2, 1, 'all')").run();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  // přemountuj appku jako člen (user 2 → dataUserId 1)
  const express = require('express');
  const app2 = express(); app2.use(express.json());
  app2.use((req,_res,next)=>{ req.user={id:2}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app2.use('/api/settings', require('./settings'));
  const { server, base } = await listen(app2);
  const j = await (await fetch(`${base}/api/settings`)).json();
  server.close(); cleanup(db, tmp);
  assert.equal(j.billing_day, 15);   // vlastníkův
  assert.equal(j.notify_scope, 'all'); // vlastní
});
