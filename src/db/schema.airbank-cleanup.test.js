'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-airbank-cleanup-${Date.now()}-${Math.random()}.db`);
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

test('airbank_tokens tabulka po initSchema NEEXISTUJE (čerstvá DB)', () => {
  const { db, tmp } = freshDb();
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='airbank_tokens'").get();
  cleanup(db, tmp);
  assert.equal(row, undefined);
});

test('DROP migrace smaže existující airbank_tokens (simulace staré DB)', () => {
  const { db, tmp } = freshDb();
  // Simuluj starou DB: ručně vytvoř tabulku a znovu spusť migrace.
  db.prepare("CREATE TABLE IF NOT EXISTS airbank_tokens (id INTEGER PRIMARY KEY, access_token TEXT)").run();
  db.prepare("INSERT INTO airbank_tokens (access_token) VALUES ('stale-secret')").run();
  // Znovu aplikuj schema (idempotentní migrace včetně DROP).
  delete require.cache[require.resolve('./schema')];
  require('./schema').initSchema();
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='airbank_tokens'").get();
  cleanup(db, tmp);
  assert.equal(row, undefined);
});
