'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-auth-mw-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./auth']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz'),(2,'c@d.cz'),(3,'e@f.cz')").run();
  return { db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
function run(reqUserId) {
  const { requireAuth } = require('./auth');
  const req = { user: { id: reqUserId }, isAuthenticated: () => true };
  let called = false;
  requireAuth(req, { status: () => ({ json: () => {} }) }, () => { called = true; });
  return { req, called };
}

test('člen domácnosti → dataUserId = vlastník', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  const { req, called } = run(2);
  cleanup(db, tmp);
  assert.ok(called);
  assert.equal(req.dataUserId, 1);
});
test('bez členství → dataUserId = vlastní id', () => {
  const { db, tmp } = freshDb();
  const { req } = run(3);
  cleanup(db, tmp);
  assert.equal(req.dataUserId, 3);
});
test('neautentizovaný → 401, next nevolán', () => {
  const { db, tmp } = freshDb();
  const { requireAuth } = require('./auth');
  let status = 0; let nexted = false;
  requireAuth({ isAuthenticated: () => false }, { status: (c) => { status = c; return { json: () => {} }; } }, () => { nexted = true; });
  cleanup(db, tmp);
  assert.equal(status, 401);
  assert.equal(nexted, false);
});
