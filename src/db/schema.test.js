'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('migrace přidá sloupec transactions.ab_category', () => {
  const tmp = path.join(os.tmpdir(), `spendex-schema-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  const { initSchema } = require('../db/schema');
  initSchema();
  const cols = db.prepare("PRAGMA table_info(transactions)").all().map(c => c.name);
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.ok(cols.includes('ab_category'), `transactions nemá sloupec ab_category; má: ${cols.join(',')}`);
});

test('migrace vytvoří tabulku income_sources', () => {
  const tmp = path.join(os.tmpdir(), `spendex-incsrc-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  const { initSchema } = require('../db/schema');
  initSchema();
  const cols = db.prepare("PRAGMA table_info(income_sources)").all().map(c => c.name);
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.deepEqual(
    cols.sort(),
    ['account_id', 'created_at', 'id', 'match_counterparty_account', 'match_pattern', 'person', 'planned_amount', 'sort_order', 'user_id'].sort()
  );
});
