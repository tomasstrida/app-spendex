'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-scheduler-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + s); } catch { /* ok */ } }
}

test('shouldSchedule: false když chybí povinné R2 ENV', () => {
  const { shouldSchedule } = require('./scheduler');
  assert.equal(shouldSchedule({}), false);
  assert.equal(shouldSchedule({ R2_ACCOUNT_ID: 'a' }), false);
});

test('shouldSchedule: true když jsou všechny povinné R2 ENV', () => {
  const { shouldSchedule } = require('./scheduler');
  assert.equal(shouldSchedule({
    R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd',
  }), true);
});

test('checkBackupHeartbeat: čerstvý success → mailer nevolán', async () => {
  const { db, tmp } = freshDb();
  const { recordBackup } = require('./backupLog');
  recordBackup(db, { status: 'success', res: { key: 'k', sizeBytes: 1, prunedCount: 0 } });
  const { checkBackupHeartbeat } = require('./scheduler');
  let calls = 0;
  await checkBackupHeartbeat(db, async () => { calls++; }, 3);
  cleanup(db, tmp);
  assert.equal(calls, 0);
});

test('checkBackupHeartbeat: žádný čerstvý success → mailer volán s maxAge', async () => {
  const { db, tmp } = freshDb();
  const { checkBackupHeartbeat } = require('./scheduler');
  let received = null;
  await checkBackupHeartbeat(db, async (h) => { received = h; }, 3);
  cleanup(db, tmp);
  assert.equal(received, 3);
});
