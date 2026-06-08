'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-schema-push-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('./connection')];
  delete require.cache[require.resolve('./schema')];
  const db = require('./connection');
  require('./schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + s); } catch { /* ok */ } }
}

test('push_subscriptions tabulka existuje a má očekávané sloupce', () => {
  const { db, tmp } = freshDb();
  const cols = db.prepare("PRAGMA table_info(push_subscriptions)").all().map(c => c.name);
  cleanup(db, tmp);
  for (const c of ['id', 'user_id', 'endpoint', 'p256dh', 'auth', 'user_agent', 'created_at']) {
    assert.ok(cols.includes(c), `chybí sloupec ${c}`);
  }
});

test('settings.notify_scope existuje s defaultem pending_only', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO settings (user_id, billing_day) VALUES (1, 1)").run();
  const row = db.prepare("SELECT notify_scope FROM settings WHERE user_id = 1").get();
  cleanup(db, tmp);
  assert.equal(row.notify_scope, 'pending_only');
});
