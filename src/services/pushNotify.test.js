'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-pushnotify-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  delete require.cache[require.resolve('./pushNotify')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + s); } catch { /* ok */ } }
}
function seedUser(db, scope) {
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO settings (user_id, billing_day, notify_scope) VALUES (1, 1, ?)").run(scope);
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://x/ep1', 'k', 'a')").run();
}

test('sendToUser odešle na všechna zařízení uživatele', async () => {
  const { db, tmp } = freshDb();
  seedUser(db, 'pending_only');
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://x/ep2', 'k', 'a')").run();
  const sent = [];
  const fakeClient = { sendNotification: async (sub) => { sent.push(sub.endpoint); return { statusCode: 201 }; } };
  const { sendToUser } = require('./pushNotify');
  await sendToUser(db, 1, { title: 'T', body: 'B', url: '/import' }, fakeClient);
  cleanup(db, tmp);
  assert.deepEqual(sent.sort(), ['https://x/ep1', 'https://x/ep2']);
});

test('410 z push služby → subscription se smaže', async () => {
  const { db, tmp } = freshDb();
  seedUser(db, 'pending_only');
  const fakeClient = { sendNotification: async () => { const e = new Error('gone'); e.statusCode = 410; throw e; } };
  const { sendToUser } = require('./pushNotify');
  await sendToUser(db, 1, { title: 'T', body: 'B', url: '/import' }, fakeClient);
  const cnt = db.prepare("SELECT COUNT(*) c FROM push_subscriptions WHERE user_id = 1").get().c;
  cleanup(db, tmp);
  assert.equal(cnt, 0);
});

test('notifyForResult: pending + scope off → nic neodešle', async () => {
  const { db, tmp } = freshDb();
  seedUser(db, 'off');
  let calls = 0;
  const fakeClient = { sendNotification: async () => { calls++; return { statusCode: 201 }; } };
  const { notifyForResult } = require('./pushNotify');
  await notifyForResult(db, { status: 'pending', userId: 1, notify: { amount: -349, currency: 'CZK', merchant: 'Albert' } }, fakeClient);
  cleanup(db, tmp);
  assert.equal(calls, 0);
});

test('notifyForResult: pending + scope pending_only → odešle', async () => {
  const { db, tmp } = freshDb();
  seedUser(db, 'pending_only');
  let calls = 0;
  const fakeClient = { sendNotification: async () => { calls++; return { statusCode: 201 }; } };
  const { notifyForResult } = require('./pushNotify');
  await notifyForResult(db, { status: 'pending', userId: 1, notify: { amount: -349, currency: 'CZK', merchant: 'Albert' } }, fakeClient);
  cleanup(db, tmp);
  assert.equal(calls, 1);
});

test('notifyForResult: imported + scope pending_only → nic; scope all → odešle', async () => {
  const { db, tmp } = freshDb();
  seedUser(db, 'pending_only');
  let calls = 0;
  const fakeClient = { sendNotification: async () => { calls++; return { statusCode: 201 }; } };
  const { notifyForResult } = require('./pushNotify');
  const res = { status: 'imported', userId: 1, notify: { amount: -349, currency: 'CZK', merchant: 'Albert', categoryName: 'Potraviny' } };
  await notifyForResult(db, res, fakeClient);
  assert.equal(calls, 0);
  db.prepare("UPDATE settings SET notify_scope = 'all' WHERE user_id = 1").run();
  await notifyForResult(db, res, fakeClient);
  cleanup(db, tmp);
  assert.equal(calls, 1);
});

test('notifyForResult posílá na notifyUserId, ne na userId (data owner)', async () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'tom@x'),(2,'martin@x')").run();
  db.prepare("INSERT INTO settings (user_id, billing_day, notify_scope) VALUES (2, 1, 'all')").run();
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (2, 'https://x/martin', 'k', 'a')").run();
  const sent = [];
  const fakeClient = { sendNotification: async (sub) => { sent.push(sub.endpoint); return { statusCode: 201 }; } };
  const { notifyForResult } = require('./pushNotify');
  await notifyForResult(db, { status: 'imported', userId: 1, notifyUserId: 2, notify: { amount: -482, currency: 'CZK', merchant: 'HAMR', categoryName: 'Restaurace' } }, fakeClient);
  cleanup(db, tmp);
  assert.deepEqual(sent, ['https://x/martin']);
});

test('awaiting_card → broadcast všem v domácnosti i se scope off', async () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'tom@x'),(2,'martin@x')").run();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  db.prepare("INSERT INTO settings (user_id, billing_day, notify_scope) VALUES (1,1,'off'),(2,1,'off')").run();
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1,'e1','p','a'),(2,'e2','p','a')").run();
  const sent = [];
  const client = { sendNotification: async (sub) => { sent.push(sub.endpoint); return { statusCode: 201 }; } };
  const { notifyForResult } = require('./pushNotify');
  await notifyForResult(db, {
    status: 'awaiting_card', userId: 1, broadcast: true,
    notify: { amount: -482, currency: 'CZK', merchant: 'HAMR', unknownCard: true, last4: '6062' },
  }, client);
  cleanup(db, tmp);
  assert.deepEqual(sent.sort(), ['e1', 'e2']);
});

test('formatBody: neznámá karta → 💳 text', () => {
  const { formatBody } = require('./pushNotify');
  const body = formatBody({ amount: -482, currency: 'CZK', merchant: 'HAMR', unknownCard: true });
  assert.match(body, /💳/);
  assert.match(body, /HAMR/);
});

test('formatBody: bez kategorie → "potřebuje kategorii", s kategorií → "→ kat"', () => {
  const { formatBody } = require('./pushNotify');
  const pending = formatBody({ amount: -349, currency: 'CZK', merchant: 'Albert' });
  const imported = formatBody({ amount: -349, currency: 'CZK', merchant: 'Albert', categoryName: 'Potraviny' });
  assert.ok(pending.includes('Albert'));
  assert.ok(pending.includes('potřebuje kategorii'));
  assert.ok(pending.startsWith('⚠️'));
  assert.ok(imported.includes('→ Potraviny'));
  assert.ok(imported.startsWith('✅'));
});
