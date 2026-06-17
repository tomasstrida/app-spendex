'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-allow-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
}

const { isEmailAllowed, isValidEmail, normalizeEmail } = require('./allowlist');

test('isEmailAllowed: e-mail na allowlistu (case-insensitive) je povolen', () => {
  delete process.env.ADMIN_EMAILS;
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO allowed_emails (email) VALUES ('Friend@Example.com')").run();
  assert.equal(isEmailAllowed(db, 'friend@example.com'), true);
  assert.equal(isEmailAllowed(db, 'FRIEND@EXAMPLE.COM'), true);
  cleanup(db, tmp);
});

test('isEmailAllowed: neznámý e-mail je odmítnut', () => {
  delete process.env.ADMIN_EMAILS;
  const { db, tmp } = freshDb();
  assert.equal(isEmailAllowed(db, 'cizi@nikdo.cz'), false);
  cleanup(db, tmp);
});

test('isEmailAllowed: ENV admin je povolen i bez DB záznamu', () => {
  process.env.ADMIN_EMAILS = 'boss@firma.cz, druhy@firma.cz';
  const { db, tmp } = freshDb();
  assert.equal(isEmailAllowed(db, 'boss@firma.cz'), true);
  assert.equal(isEmailAllowed(db, 'DRUHY@firma.cz'), true);
  assert.equal(isEmailAllowed(db, 'jiny@firma.cz'), false);
  delete process.env.ADMIN_EMAILS;
  cleanup(db, tmp);
});

test('isEmailAllowed: stávající admin uživatel je povolen', () => {
  delete process.env.ADMIN_EMAILS;
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (email, is_admin) VALUES ('admin@dom.cz', 1)").run();
  assert.equal(isEmailAllowed(db, 'admin@dom.cz'), true);
  cleanup(db, tmp);
});

test('schema bootstrap: stávající uživatelé se stanou adminy a dostanou se na allowlist', () => {
  delete process.env.ADMIN_EMAILS;
  // Vytvoř DB se schématem, vlož uživatele a znovu spusť initSchema (simulace deploye featury).
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (email) VALUES ('tom@dom.cz')").run();
  db.prepare("INSERT INTO users (email) VALUES ('martin@dom.cz')").run();
  require('../db/schema').initSchema();
  const admins = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').get().c;
  assert.equal(admins, 2);
  const allowed = db.prepare('SELECT COUNT(*) AS c FROM allowed_emails').get().c;
  assert.equal(allowed, 2);
  cleanup(db, tmp);
});

test('isValidEmail / normalizeEmail', () => {
  assert.equal(isValidEmail('a@b.cz'), true);
  assert.equal(isValidEmail('bez-zavinace'), false);
  assert.equal(isValidEmail('a@b'), false);
  assert.equal(normalizeEmail('  A@B.CZ '), 'a@b.cz');
});
