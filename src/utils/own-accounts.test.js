'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');

function freshDb() {
  process.env.DB_PATH = path.join(os.tmpdir(), `spendex-own-${Date.now()}-${Math.random()}.db`);
  for (const m of ['../db/connection', '../db/schema', './own-accounts']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@x'),(2,'b@x')").run();
  return db;
}

test('spojí seed a účty uživatele, bez duplicit a s ořezem mezer', () => {
  const db = freshDb();
  db.prepare("INSERT INTO accounts (user_id, name, account_number, role) VALUES (1,'Hlavní','1679014138/3030','ignored'),(1,'Velké','1679014146/3030','ignored'),(1,'Mezery',' 111 / 3030 ','ignored')").run();
  const own = require('./own-accounts');
  const r = own(db, 1, ['1679014138/3030', '1679014015/3030']);
  assert.deepEqual([...r].sort(), ['111/3030', '1679014015/3030', '1679014138/3030', '1679014146/3030']);
});

test('účty jiného uživatele se nepromítnou; bez seedu vrací jen účty', () => {
  const db = freshDb();
  db.prepare("INSERT INTO accounts (user_id, name, account_number, role) VALUES (2,'Cizí','999/3030','ignored')").run();
  const own = require('./own-accounts');
  assert.deepEqual(own(db, 1), []);
  assert.deepEqual(own(db, 2), ['999/3030']);
});
