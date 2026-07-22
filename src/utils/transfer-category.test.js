'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const transferCategoryName = require('./transfer-category');

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE categories (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, type INTEGER DEFAULT 1)`);
  return d;
}

test('vrátí název kategorie interních převodů (type=4), i když je přejmenovaná', () => {
  const d = db();
  d.prepare("INSERT INTO categories (user_id, name, type) VALUES (1, 'Převody interní', 4)").run();
  d.prepare("INSERT INTO categories (user_id, name, type) VALUES (1, 'Sport', 1)").run();
  assert.equal(transferCategoryName(d, 1), 'Převody interní');
});

test('marker je type, ne název — kategorie jménem „Převody" s type=1 se nebere', () => {
  const d = db();
  d.prepare("INSERT INTO categories (user_id, name, type) VALUES (1, 'Převody', 1)").run();
  assert.equal(transferCategoryName(d, 1), null);
});

test('žádná type=4 kategorie → null', () => {
  const d = db();
  d.prepare("INSERT INTO categories (user_id, name, type) VALUES (1, 'Ostatní', 1)").run();
  assert.equal(transferCategoryName(d, 1), null);
});

test('izolace mezi uživateli — vezme jen type=4 daného uživatele', () => {
  const d = db();
  d.prepare("INSERT INTO categories (user_id, name, type) VALUES (2, 'Převody', 4)").run();
  assert.equal(transferCategoryName(d, 1), null);
});
