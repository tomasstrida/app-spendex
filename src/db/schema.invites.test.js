'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-invites-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('./connection')];
  delete require.cache[require.resolve('./schema')];
  const db = require('./connection'); require('./schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
test('household_invites má očekávané sloupce', () => {
  const { db, tmp } = freshDb();
  const cols = db.prepare("PRAGMA table_info(household_invites)").all().map(c=>c.name);
  cleanup(db, tmp);
  for (const c of ['id','data_owner_id','token','created_at']) assert.ok(cols.includes(c), `chybí ${c}`);
});
test('household_invites.data_owner_id je UNIQUE (1 pozvánka/vlastník)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO household_invites (data_owner_id, token) VALUES (1, 'tok1')").run();
  let threw=false; try { db.prepare("INSERT INTO household_invites (data_owner_id, token) VALUES (1, 'tok2')").run(); } catch { threw=true; }
  cleanup(db, tmp);
  assert.ok(threw, 'druhá pozvánka pro stejného vlastníka měla selhat');
});
