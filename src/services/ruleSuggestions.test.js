'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-rs-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection', '../db/schema']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (10, 1, 'Y_Uctovani')").run();
  return db;
}

test('upsertRuleSuggestions: vytvoří nový pending návrh', () => {
  const db = freshDb();
  const { upsertRuleSuggestions, listPendingSuggestions } = require('./ruleSuggestions');
  const ids = upsertRuleSuggestions(db, 1, [
    { counterparty_account: '705-77628031/0710', category_id: 10, subcategory_id: null, coverage_count: 3, purity: 1 },
  ]);
  assert.equal(ids.length, 1);
  const list = listPendingSuggestions(db, 1);
  assert.equal(list.length, 1);
  assert.equal(list[0].category_name, 'Y_Uctovani');
  assert.equal(list[0].coverage_count, 3);
});

test('upsertRuleSuggestions: opakovaný scan aktualizuje existující pending řádek (ne duplicitu)', () => {
  const db = freshDb();
  const { upsertRuleSuggestions, listPendingSuggestions } = require('./ruleSuggestions');
  upsertRuleSuggestions(db, 1, [
    { counterparty_account: '705-77628031/0710', category_id: 10, subcategory_id: null, coverage_count: 3, purity: 1 },
  ]);
  upsertRuleSuggestions(db, 1, [
    { counterparty_account: '705-77628031/0710', category_id: 10, subcategory_id: null, coverage_count: 4, purity: 1 },
  ]);
  const list = listPendingSuggestions(db, 1);
  assert.equal(list.length, 1);
  assert.equal(list[0].coverage_count, 4);
});

test('upsertRuleSuggestions: dismissed/approved protiúčet se přeskočí (žádné re-navrhování)', () => {
  const db = freshDb();
  const { upsertRuleSuggestions, listPendingSuggestions } = require('./ruleSuggestions');
  const [id] = upsertRuleSuggestions(db, 1, [
    { counterparty_account: '705-77628031/0710', category_id: 10, subcategory_id: null, coverage_count: 3, purity: 1 },
  ]);
  db.prepare("UPDATE rule_suggestions SET status = 'dismissed' WHERE id = ?").run(id);
  const ids2 = upsertRuleSuggestions(db, 1, [
    { counterparty_account: '705-77628031/0710', category_id: 10, subcategory_id: null, coverage_count: 5, purity: 1 },
  ]);
  assert.equal(ids2.length, 0);
  assert.equal(listPendingSuggestions(db, 1).length, 0);
});

test('getSuggestion: vrátí řádek jen pro vlastníka', () => {
  const db = freshDb();
  const { upsertRuleSuggestions, getSuggestion } = require('./ruleSuggestions');
  const [id] = upsertRuleSuggestions(db, 1, [
    { counterparty_account: '705-77628031/0710', category_id: 10, subcategory_id: null, coverage_count: 3, purity: 1 },
  ]);
  assert.ok(getSuggestion(db, 1, id));
  assert.equal(getSuggestion(db, 999, id), undefined);
});
