'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-lur-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection', '../db/schema']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return db;
}

test('loadUserRules: tvar, mapování kategorie a řazení (amount podmínky první)', () => {
  const db = freshDb();
  const loadUserRules = require('./load-user-rules');
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (10, 1, 'Restaurace a kávičky'), (11, 1, 'Sport')").run();
  // bez amount (vloženo první → nižší id)
  db.prepare("INSERT INTO category_rules (id, user_id, category_id, pattern) VALUES (1, 1, 11, 'MAX FITNESS')").run();
  // s amount podmínkou (vloženo druhé, ale musí být PRVNÍ ve výstupu)
  db.prepare("INSERT INTO category_rules (id, user_id, category_id, pattern, amount_max_abs) VALUES (2, 1, 10, 'SHELL', 200)").run();

  const out = loadUserRules(db, 1);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { pattern: 'SHELL', category: 'Restaurace a kávičky', amount_max_abs: 200 });
  assert.deepEqual(out[1], { pattern: 'MAX FITNESS', category: 'Sport' });
});

test('loadUserRules: pravidlo na neexistující kategorii se nezobrazí (JOIN), izolace usera', () => {
  const db = freshDb();
  const loadUserRules = require('./load-user-rules');
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@x'), (2, 'b@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (10, 1, 'Sport')").run();
  db.prepare("INSERT INTO category_rules (user_id, category_id, pattern) VALUES (1, 10, 'A')").run();
  // user 2 nemá kategorii → vložíme pravidlo s FK off (simulace orphan záznamu) → JOIN ho vyřadí
  db.pragma('foreign_keys = OFF');
  db.prepare("INSERT INTO category_rules (user_id, category_id, pattern) VALUES (2, 999, 'B')").run();
  db.pragma('foreign_keys = ON');

  const out = loadUserRules(db, 2);
  assert.equal(out.length, 0); // user 2 má pravidlo na neexistující kategorii 999 → JOIN ho vyřadí

  const outUser1 = loadUserRules(db, 1);
  assert.equal(outUser1.length, 1); // izolace: uživatel 1 vidí jen své pravidlo
});
