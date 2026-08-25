'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-fund-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  delete require.cache[require.resolve('./fund-coverage')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name,account_number,role,is_fund) VALUES (60,1,'Nepravidelné','1679014074/3030','spending',1)").run();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  try { fs.unlinkSync(tmp); } catch { /* ok */ }
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
}

test('fundMovements: čisté pohyby na účtu za období', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO transactions (user_id,account_id,amount,date,description) VALUES (1,60,5000,'2026-08-05','Dotace'),(1,60,-1200,'2026-08-10','Nákup'),(1,60,999,'2026-09-01','Mimo období')").run();
  const { fundMovements } = require('./fund-coverage');
  assert.equal(fundMovements(db, 1, 60, '2026-08-01', '2026-08-31'), 3800);
  cleanup(db, tmp);
});

test('fundAnchor: vrátí nejnovější snapshot', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO transactions (user_id,account_id,amount,date,description,balance_after) VALUES (1,60,-100,'2026-07-01','Starší',9000),(1,60,-200,'2026-08-18','Novější',7158.45)").run();
  const { fundAnchor } = require('./fund-coverage');
  assert.deepEqual(fundAnchor(db, 1, 60), { date: '2026-08-18', balance: 7158.45 });
  cleanup(db, tmp);
});

test('fundAnchor: účet bez snapshotu vrátí null', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO transactions (user_id,account_id,amount,date,description) VALUES (1,60,-100,'2026-07-01','Bez snapshotu')").run();
  const { fundAnchor } = require('./fund-coverage');
  assert.equal(fundAnchor(db, 1, 60), null);
  cleanup(db, tmp);
});

test('fundRemaining: položka s uplynulým oknem se ignoruje', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Lítačka',2,60)").run();
  // Tom: okno 4-5, uplynulo, nevyčerpáno. Martin: okno 8-9, aktivní.
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Lítačka Tom',3650,4,5),(2,1,70,'Lítačka Martin',3650,8,9)").run();
  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.remaining, 3650, 'jen Martinova lítačka');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].name, 'Lítačka Martin');
  cleanup(db, tmp);
});

test('fundRemaining: čerpání se počítá v okně položky, ne za rok', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Lítačka',2,60)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Lítačka Tom',3650,4,5),(2,1,70,'Lítačka Martin',3650,8,9)").run();
  // Tomova lítačka zaplacená v dubnu — spadá do okna 4-5, NE do okna 8-9
  db.prepare("INSERT INTO transactions (user_id,account_id,category_id,amount,date,description) VALUES (1,60,70,-3650,'2026-04-15','Lítačka Tom')").run();
  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.remaining, 3650, 'dubnová platba nesmí snížit Martinovu položku');
  cleanup(db, tmp);
});

test('fundRemaining: přečerpaná položka nedává záporný zbytek', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Beach',2,60)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Beach zima',10200,9,12)").run();
  db.prepare("INSERT INTO transactions (user_id,account_id,category_id,amount,date,description) VALUES (1,60,70,-15000,'2026-09-20','Přeplaceno')").run();
  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.remaining, 0);
  assert.equal(r.items[0].remaining, 0);
  cleanup(db, tmp);
});

test('fundRemaining: kategorie bez fund_account_id do krytí nevstoupí', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Oblečení',2,NULL)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Oblečení',20000,1,12)").run();
  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.remaining, 0);
  assert.equal(r.items.length, 0);
  cleanup(db, tmp);
});

test('fundRemaining: kategorie odkazující na cizí/neexistující účet se nezapočítá', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Duch',2,999)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Duch',5000,1,12)").run();
  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.remaining, 0, 'osiřelý odkaz se chová jako NULL');
  cleanup(db, tmp);
});

test('fundRemaining: cross-year okno (10-1) je v srpnu stále aktivní', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Zima',2,60)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Zimní servis',4000,10,1)").run();
  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.remaining, 4000, 'konec okna je leden PŘÍŠTÍHO roku, ne uplynulý leden');
  cleanup(db, tmp);
});

test('fundRemaining: položky nesou rozpad pro zobrazení', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Beach',2,60)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Beach zima',10200,9,12)").run();
  db.prepare("INSERT INTO transactions (user_id,account_id,category_id,amount,date,description) VALUES (1,60,70,-1200,'2026-09-05','Záloha')").run();
  const { fundRemaining } = require('./fund-coverage');
  const it = fundRemaining(db, 1, 60, '2026-08-26').items[0];
  assert.equal(it.budget_item_id, 1);
  assert.equal(it.category_id, 70);
  assert.equal(it.category_name, 'Y_Beach');
  assert.equal(it.amount, 10200);
  assert.equal(it.spent, 1200);
  assert.equal(it.remaining, 9000);
  assert.equal(it.window_from, '2026-09-01');
  assert.equal(it.window_to, '2026-12-31');
  cleanup(db, tmp);
});
