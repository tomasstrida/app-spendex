'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-schema-backuplog-${Date.now()}-${Math.random()}.db`);
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

test('backup_log tabulka má očekávané sloupce', () => {
  const { db, tmp } = freshDb();
  const cols = db.prepare("PRAGMA table_info(backup_log)").all().map(c => c.name);
  cleanup(db, tmp);
  for (const c of ['id', 'status', 'object_key', 'size_bytes', 'pruned_count', 'error', 'created_at']) {
    assert.ok(cols.includes(c), `chybí sloupec ${c}`);
  }
});

test('backup_log: created_at má default (vloží se i bez explicitní hodnoty)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO backup_log (status) VALUES ('success')").run();
  const row = db.prepare("SELECT created_at FROM backup_log LIMIT 1").get();
  cleanup(db, tmp);
  assert.ok(row.created_at, 'created_at je prázdné');
});
