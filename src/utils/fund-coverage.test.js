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

test('fundRemaining: součet je za KATEGORII, ne za jednotlivé podpoložky', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Sport',2,60)").run();
  // Čtyři položky se stejným oknem 1-12 — reálný případ Y_Sport. Per položka by se
  // tatáž platba odečetla čtyřikrát; za kategorii se odečte jednou.
  db.prepare(`INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES
    (1,1,70,'Tom cvíčo',31500,1,12),(2,1,70,'Golf členství',6000,1,12),
    (3,1,70,'Golf hry',6000,1,12),(4,1,70,'Martin tréninky',6500,1,12)`).run();
  db.prepare("INSERT INTO transactions (user_id,account_id,category_id,amount,date,description) VALUES (1,60,70,-22000,'2026-03-10','Cvíčo')").run();

  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.plan, 50000, 'plán = součet všech čtyř položek');
  assert.equal(r.spent, 22000, 'čerpání se počítá jednou, ne čtyřikrát');
  assert.equal(r.remaining, 28000);
  cleanup(db, tmp);
});

test('fundRemaining: čerpání za CELÝ rok, ne v okně položky', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Lítačka',2,60)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Tom',3650,4,5),(2,1,70,'Martin',3650,8,9)").run();
  // Tomova lítačka zaplacená v dubnu — do ročního čerpání kategorie vstupuje.
  db.prepare("INSERT INTO transactions (user_id,account_id,category_id,amount,date,description) VALUES (1,60,70,-3650,'2026-04-15','Lítačka Tom')").run();

  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.plan, 7300);
  assert.equal(r.spent, 3650);
  assert.equal(r.remaining, 3650, 'zbývá Martinova lítačka');
  cleanup(db, tmp);
});

test('fundRemaining: platba mimo rok se nezapočítá', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Pojistky',2,60)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Pojistky',12000,1,12)").run();
  db.prepare("INSERT INTO transactions (user_id,account_id,category_id,amount,date,description) VALUES (1,60,70,-5000,'2025-12-20','Loni'),(1,60,70,-3000,'2026-02-10','Letos')").run();

  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.spent, 3000, 'loňská platba do letošního čerpání nepatří');
  assert.equal(r.remaining, 9000);
  cleanup(db, tmp);
});

test('fundRemaining: přečerpaná kategorie nedává záporný zbytek', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Auto',2,60)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Servis',30000,1,12)").run();
  db.prepare("INSERT INTO transactions (user_id,account_id,category_id,amount,date,description) VALUES (1,60,70,-37428,'2026-08-18','Servis RAV')").run();

  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.spent, 37428, 'skutečné čerpání se NEOŘEZÁVÁ — patří do „vyčerpáno z plánu"');
  assert.equal(r.remaining, 0, 'ale zbytek nesmí být záporný');
  assert.equal(r.categories[0].remaining, 0);
  cleanup(db, tmp);
});

test('fundRemaining: kategorie bez fund_account_id do krytí nevstoupí', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Oblečení',2,NULL)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Oblečení',20000,1,12)").run();
  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.remaining, 0);
  assert.equal(r.plan, 0);
  assert.equal(r.categories.length, 0);
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

test('fundRemaining: kategorie nesou rozpad pro zobrazení, seřazený podle zbytku', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Malá',2,60),(71,1,'Y_Velká',2,60)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Malá',2000,1,12),(2,1,71,'Velká',30000,1,12)").run();
  db.prepare("INSERT INTO transactions (user_id,account_id,category_id,amount,date,description) VALUES (1,60,71,-1200,'2026-05-05','Záloha')").run();

  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.categories.length, 2);
  assert.equal(r.categories[0].category_name, 'Y_Velká', 'největší zbytek první');
  assert.equal(r.categories[0].plan, 30000);
  assert.equal(r.categories[0].spent, 1200);
  assert.equal(r.categories[0].remaining, 28800);
  assert.equal(r.categories[1].category_name, 'Y_Malá');
  cleanup(db, tmp);
});
