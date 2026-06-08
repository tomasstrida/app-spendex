'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

function freshApp() {
  const tmp = path.join(os.tmpdir(), `spendex-push-route-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  process.env.VAPID_PUBLIC_KEY = 'TEST_PUBLIC_KEY';
  for (const m of ['../db/connection', '../db/schema', './push']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1 }; req.isAuthenticated = () => true; next(); });
  app.use('/api/push', require('./push'));
  return { app, db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + s); } catch { /* ok */ } }
}
async function listen(app) {
  const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  const port = server.address().port;
  return { server, base: `http://127.0.0.1:${port}` };
}

test('GET /api/push/public-key vrací VAPID public key', async () => {
  const { app, db, tmp } = freshApp();
  const { server, base } = await listen(app);
  const r = await fetch(`${base}/api/push/public-key`);
  const j = await r.json();
  server.close(); cleanup(db, tmp);
  assert.equal(j.publicKey, 'TEST_PUBLIC_KEY');
});

test('POST /api/push/subscribe uloží subscription (upsert dle endpoint)', async () => {
  const { app, db, tmp } = freshApp();
  const { server, base } = await listen(app);
  const sub = { endpoint: 'https://x/ep1', keys: { p256dh: 'k', auth: 'a' } };
  await fetch(`${base}/api/push/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) });
  await fetch(`${base}/api/push/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) });
  const cnt = db.prepare("SELECT COUNT(*) c FROM push_subscriptions WHERE endpoint = 'https://x/ep1'").get().c;
  server.close(); cleanup(db, tmp);
  assert.equal(cnt, 1);
});

test('POST /api/push/unsubscribe smaže subscription', async () => {
  const { app, db, tmp } = freshApp();
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://x/ep1', 'k', 'a')").run();
  const { server, base } = await listen(app);
  await fetch(`${base}/api/push/unsubscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'https://x/ep1' }) });
  const cnt = db.prepare("SELECT COUNT(*) c FROM push_subscriptions").get().c;
  server.close(); cleanup(db, tmp);
  assert.equal(cnt, 0);
});
