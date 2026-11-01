'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

function setup(dataUserId = 1) {
  const tmp = path.join(os.tmpdir(), `spendex-pnotes-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection', '../db/schema', './period-notes']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id,email) VALUES (1,'o@x')").run();
  db.prepare("INSERT INTO users (id,email) VALUES (2,'p@x')").run();
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1 }; req.dataUserId = dataUserId; req.isAuthenticated = () => true; next(); });
  app.use('/api/period-notes', require('./period-notes'));
  return { db, app };
}
async function listen(app) { const s = await new Promise(r => { const x = app.listen(0, () => r(x)); }); return { server: s, base: `http://127.0.0.1:${s.address().port}` }; }
const put = (base, body) => fetch(`${base}/api/period-notes`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('GET bez poznámky vrací prázdný text', async () => {
  const { app } = setup(); const { server, base } = await listen(app);
  const r = await (await fetch(`${base}/api/period-notes?period=2026-10`)).json();
  assert.equal(r.note, '');
  server.close();
});

test('PUT uloží, GET vrátí, druhý PUT přepíše (jedna poznámka na období)', async () => {
  const { app, db } = setup(); const { server, base } = await listen(app);
  assert.equal((await put(base, { period: '2026-10', note: '  Platba z OSVČ  ' })).status, 200);
  assert.equal((await (await fetch(`${base}/api/period-notes?period=2026-10`)).json()).note, 'Platba z OSVČ');
  await put(base, { period: '2026-10', note: 'Upraveno' });
  assert.equal((await (await fetch(`${base}/api/period-notes?period=2026-10`)).json()).note, 'Upraveno');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM period_notes').get().c, 1);
  server.close();
});

test('PUT s prázdným textem poznámku smaže', async () => {
  const { app, db } = setup(); const { server, base } = await listen(app);
  await put(base, { period: '2026-10', note: 'x' });
  assert.equal((await put(base, { period: '2026-10', note: '   ' })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM period_notes').get().c, 0);
  server.close();
});

test('validace: špatný period, nestringová a příliš dlouhá poznámka → 400', async () => {
  const { app } = setup(); const { server, base } = await listen(app);
  assert.equal((await put(base, { period: '2026-13', note: 'x' })).status, 400);
  assert.equal((await put(base, { period: 'abc', note: 'x' })).status, 400);
  assert.equal((await put(base, { period: '2026-10', note: 123 })).status, 400);
  assert.equal((await put(base, { period: '2026-10', note: 'a'.repeat(2001) })).status, 400);
  assert.equal((await put(base, { period: '2026-10', note: 'a'.repeat(2000) })).status, 200);
  assert.equal((await fetch(`${base}/api/period-notes?period=bad`)).status, 400);
  server.close();
});

test('poznámky jsou izolované podle data ownera', async () => {
  const { app, db } = setup(1); const { server, base } = await listen(app);
  db.prepare("INSERT INTO period_notes (user_id, period_key, note) VALUES (2,'2026-10','cizi')").run();
  assert.equal((await (await fetch(`${base}/api/period-notes?period=2026-10`)).json()).note, '');
  await put(base, { period: '2026-10', note: 'moje' });
  assert.equal(db.prepare("SELECT note FROM period_notes WHERE user_id = 2 AND period_key = '2026-10'").get().note, 'cizi');
  server.close();
});
