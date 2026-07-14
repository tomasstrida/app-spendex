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

test('migrace: fixed_expenses má amount_min/max + frequency_months a dopočítané rozmezí', () => {
  const tmp = path.join(os.tmpdir(), `spendex-fixed-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  const { initSchema } = require('../db/schema');
  initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount) VALUES (1,'Nájem',38000)").run();
  // znovu-spuštění initSchema musí dopočítat min/max existujícímu řádku
  require('../db/schema').initSchema();
  const row = db.prepare("SELECT amount_min, amount_max, frequency_months FROM fixed_expenses WHERE name='Nájem'").get();
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.equal(row.amount_min, 36100);   // 38000*0.95
  assert.equal(row.amount_max, 39900);   // 38000*1.05
  assert.equal(row.frequency_months, 1);
});

test('migrace: subcategories tabulka + subcategory_id FK sloupce existují', () => {
  const tmp = path.join(os.tmpdir(), `spendex-subcat-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  const { initSchema } = require('../db/schema');
  initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (5,1,'Licence')").run();
  db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'ChatGPT')").run();
  const sub = db.prepare("SELECT id, name FROM subcategories WHERE name='ChatGPT'").get();
  // FK sloupce na transactions a category_rules existují (INSERT nevyhodí chybu)
  db.prepare("INSERT INTO transactions (user_id, amount, date, description, subcategory_id) VALUES (1,-100,'2026-07-01','OPENAI',?)").run(sub.id);
  db.prepare("INSERT INTO category_rules (user_id, category_id, pattern, subcategory_id) VALUES (1,5,'OPENAI',?)").run(sub.id);
  const tx = db.prepare("SELECT subcategory_id FROM transactions WHERE description='OPENAI'").get();
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.equal(tx.subcategory_id, sub.id);
});
