'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-backuplog-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  delete require.cache[require.resolve('./backupLog')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + s); } catch { /* ok */ } }
}

test('recordBackup success zapíše řádek s detaily', () => {
  const { db, tmp } = freshDb();
  const { recordBackup } = require('./backupLog');
  recordBackup(db, { status: 'success', res: { key: 'backups/data-x.db.gz', sizeBytes: 1234, prunedCount: 2 } });
  const row = db.prepare("SELECT * FROM backup_log").get();
  cleanup(db, tmp);
  assert.equal(row.status, 'success');
  assert.equal(row.object_key, 'backups/data-x.db.gz');
  assert.equal(row.size_bytes, 1234);
  assert.equal(row.pruned_count, 2);
  assert.equal(row.error, null);
});

test('recordBackup failure zapíše status a error', () => {
  const { db, tmp } = freshDb();
  const { recordBackup } = require('./backupLog');
  recordBackup(db, { status: 'failure', err: new Error('R2 down') });
  const row = db.prepare("SELECT * FROM backup_log").get();
  cleanup(db, tmp);
  assert.equal(row.status, 'failure');
  assert.equal(row.error, 'R2 down');
  assert.equal(row.object_key, null);
});

test('hasRecentSuccess: true při čerstvém success', () => {
  const { db, tmp } = freshDb();
  const { recordBackup, hasRecentSuccess } = require('./backupLog');
  recordBackup(db, { status: 'success', res: { key: 'k', sizeBytes: 1, prunedCount: 0 } });
  const ok = hasRecentSuccess(db, 3);
  cleanup(db, tmp);
  assert.equal(ok, true);
});

test('hasRecentSuccess: false když je success starší než okno', () => {
  const { db, tmp } = freshDb();
  const { hasRecentSuccess } = require('./backupLog');
  db.prepare("INSERT INTO backup_log (status, object_key, created_at) VALUES ('success', 'k', datetime('now', '-10 hours'))").run();
  const ok = hasRecentSuccess(db, 3);
  cleanup(db, tmp);
  assert.equal(ok, false);
});

test('hasRecentSuccess: false když je jen failure řádek', () => {
  const { db, tmp } = freshDb();
  const { recordBackup, hasRecentSuccess } = require('./backupLog');
  recordBackup(db, { status: 'failure', err: new Error('x') });
  const ok = hasRecentSuccess(db, 3);
  cleanup(db, tmp);
  assert.equal(ok, false);
});

test('listRecent vrací záznamy nejnovější první a respektuje limit', () => {
  const { db, tmp } = freshDb();
  const { recordBackup, listRecent } = require('./backupLog');
  db.prepare("INSERT INTO backup_log (status, object_key, created_at) VALUES ('success', 'old', datetime('now', '-2 days'))").run();
  recordBackup(db, { status: 'success', res: { key: 'new', sizeBytes: 5, prunedCount: 1 } });
  const all = listRecent(db, 20);
  const limited = listRecent(db, 1);
  cleanup(db, tmp);
  assert.equal(all.length, 2);
  assert.equal(all[0].object_key, 'new'); // nejnovější první
  assert.equal(limited.length, 1);
  assert.equal(limited[0].object_key, 'new');
});

test('lastSuccessAt ignoruje failure a vrací poslední success', () => {
  const { db, tmp } = freshDb();
  const { recordBackup, lastSuccessAt } = require('./backupLog');
  assert.equal(lastSuccessAt(db), null);
  recordBackup(db, { status: 'success', res: { key: 'k', sizeBytes: 1, prunedCount: 0 } });
  recordBackup(db, { status: 'failure', err: new Error('later fail') });
  const last = lastSuccessAt(db);
  cleanup(db, tmp);
  assert.ok(last); // existuje úspěch i přes pozdější selhání
});
