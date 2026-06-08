'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-verifyexp-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('./connection')];
  delete require.cache[require.resolve('./schema')];
  const db = require('./connection'); require('./schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
test('users má sloupec verify_expires', () => {
  const { db, tmp } = freshDb();
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c=>c.name);
  cleanup(db, tmp);
  assert.ok(cols.includes('verify_expires'), 'chybí verify_expires');
});
