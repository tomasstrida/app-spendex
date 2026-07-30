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

test('migrace: fixed_expenses má match_counterparty_account', () => {
  const tmp = path.join(os.tmpdir(), `spendex-fixed-mca-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  const { initSchema } = require('../db/schema');
  initSchema();
  const cols = db.prepare("PRAGMA table_info(fixed_expenses)").all().map(c => c.name);
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.ok(cols.includes('match_counterparty_account'), 'chybí sloupec match_counterparty_account');
});

test('migrace: categories.system_role + accounts.is_fund existují', () => {
  const tmp = path.join(os.tmpdir(), `spendex-sysrole-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  const catCols = db.prepare('PRAGMA table_info(categories)').all().map(c => c.name);
  const accCols = db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name);
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.ok(catCols.includes('system_role'), `categories nemá system_role; má: ${catCols.join(',')}`);
  assert.ok(accCols.includes('is_fund'), `accounts nemá is_fund; má: ${accCols.join(',')}`);
});

test('bootstrap: kategorie fund_topup vznikne jen uživateli, který už kategorie má, a je idempotentní', () => {
  const tmp = path.join(os.tmpdir(), `spendex-topup-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  // user 1 = data owner s kategoriemi, user 2 = člen domácnosti bez vlastních kategorií
  db.prepare("INSERT INTO users (id, email) VALUES (1,'owner@x'),(2,'member@x')").run();
  db.prepare("INSERT INTO categories (user_id, name, type) VALUES (1,'Jídlo',1)").run();
  require('../db/schema').initSchema();
  require('../db/schema').initSchema();   // druhý běh nesmí duplikovat
  const rows = db.prepare("SELECT user_id, name, type FROM categories WHERE system_role = 'fund_topup'").all();
  const defaultIsFund = db.prepare('PRAGMA table_info(accounts)').all().find(c => c.name === 'is_fund');
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.equal(rows.length, 1, 'právě jedna kategorie fund_topup (jen pro user 1)');
  assert.equal(rows[0].user_id, 1);
  assert.equal(rows[0].name, 'Nestandardní dobití ročního budgetu');
  assert.equal(rows[0].type, 4);
  assert.equal(defaultIsFund.dflt_value, '0');
});

test('bootstrap: ručně založenou kategorii se stejným názvem povýší místo duplikátu', () => {
  const tmp = path.join(os.tmpdir(), `spendex-topup2-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'owner@x')").run();
  // uživatel si ji založil sám jako měsíční (unique index na user_id+name)
  const catId = db.prepare("INSERT INTO categories (user_id, name, type) VALUES (1,'Nestandardní dobití ročního budgetu',1)").run().lastInsertRowid;
  // měsíční budget existující kategorie – po povýšení na type=4 je to mrtvý záznam,
  // stejně jako u PATCH /api/categories (src/routes/categories.js:112-114) musí zmizet
  db.prepare("INSERT INTO budgets (user_id, category_id, month, amount) VALUES (1,?,'default',5000)").run(catId);
  require('../db/schema').initSchema();
  const rows = db.prepare("SELECT type, system_role FROM categories WHERE name = 'Nestandardní dobití ročního budgetu'").all();
  const budgetRows = db.prepare('SELECT * FROM budgets WHERE category_id = ?').all(catId);
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.equal(rows.length, 1, 'žádný duplikát');
  assert.equal(rows[0].type, 4);
  assert.equal(rows[0].system_role, 'fund_topup');
  assert.equal(budgetRows.length, 0, 'mrtvý budget po povýšení kategorie na type=4 musí být smazaný');
});

test('prepaid: tabulky prepaid_packages a prepaid_draws existují se správnými sloupci', () => {
  const tmp = path.join(os.tmpdir(), `spendex-prepaid-cols-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  const { initSchema } = require('../db/schema');
  initSchema();
  const pkgCols = db.prepare('PRAGMA table_info(prepaid_packages)').all().map(c => c.name);
  const drawCols = db.prepare('PRAGMA table_info(prepaid_draws)').all().map(c => c.name);
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  for (const col of ['id', 'user_id', 'transaction_id', 'category_id', 'original_category_id', 'name',
                     'total_amount', 'units_total', 'unit_amount', 'valid_until', 'status', 'note',
                     'created_at', 'closed_at']) {
    assert.ok(pkgCols.includes(col), `prepaid_packages postrádá sloupec ${col}`);
  }
  for (const col of ['id', 'user_id', 'package_id', 'date', 'units', 'amount', 'note', 'created_at']) {
    assert.ok(drawCols.includes(col), `prepaid_draws postrádá sloupec ${col}`);
  }
});

test('prepaid: bootstrap kategorie prepaid_purchase vznikne jen uživateli s kategoriemi a je idempotentní', () => {
  const tmp = path.join(os.tmpdir(), `spendex-prepaid-bootstrap-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@x'),(2,'b@x')").run();
  db.prepare("INSERT INTO categories (user_id, name) VALUES (1,'Jídlo')").run();
  require('../db/schema').initSchema();
  require('../db/schema').initSchema();
  const rows = db.prepare("SELECT user_id, name, type FROM categories WHERE system_role = 'prepaid_purchase'").all();
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.equal(rows.length, 1, 'právě jedna kategorie prepaid_purchase (jen pro user 1)');
  assert.equal(rows[0].user_id, 1);
  assert.equal(rows[0].type, 4);
  assert.equal(rows[0].name, 'Nákup předplacených balíčků');
});

test('prepaid: stejnojmenná uživatelská kategorie se povýší, nevznikne duplicita', () => {
  const tmp = path.join(os.tmpdir(), `spendex-prepaid-promote-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@x')").run();
  const id = db.prepare("INSERT INTO categories (user_id, name, type) VALUES (1,'Nákup předplacených balíčků',1)").run().lastInsertRowid;
  db.prepare("INSERT INTO budgets (user_id, category_id, month, amount) VALUES (1,?, 'default', 500)").run(id);
  require('../db/schema').initSchema();
  const rows = db.prepare("SELECT id, type, system_role FROM categories WHERE user_id = 1 AND name = 'Nákup předplacených balíčků'").all();
  const budgets = db.prepare('SELECT COUNT(*) AS n FROM budgets WHERE category_id = ?').get(id);
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id, 'povýší se existující řádek, nevzniká nový');
  assert.equal(rows[0].type, 4);
  assert.equal(rows[0].system_role, 'prepaid_purchase');
  assert.equal(budgets.n, 0, 'mrtvý měsíční budget se smaže');
});
