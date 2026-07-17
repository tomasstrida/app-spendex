'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-stats-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./stats']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (5,1,'Práce')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/stats', require('./stats'));
  return { db, app };
}

test('by_subcategory sečte výdaje per subkategorie v období', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const subId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'ChatGPT')").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description) VALUES (1,5,?,-300,'2026-07-03','OPENAI'),(1,5,?,-200,'2026-07-10','OPENAI')").run(subId, subId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  const row = (stats.by_subcategory || []).find(r => r.subcategory_id === subId);
  assert.equal(row.spent, 500);
  server.close();
});

test('accounting: saldo účetní kategorie (type=4) přes VŠECHNY účty vč. ignored', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (7,1,'Převody',4)").run();
  // účet role='ignored' NESMÍ být vyfiltrován (na rozdíl od SPENDING_FILTER)
  const accId = db.prepare("INSERT INTO accounts (user_id, account_number, name, role) VALUES (1,'999','Spořicí','ignored')").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description,account_id) VALUES (1,7,-5000,'2026-07-05','Převod na spoření',NULL),(1,7,5000,'2026-07-05','Převod ze spoření',?)").run(accId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  const row = (stats.accounting || []).find(r => r.id === 7);
  assert.ok(row, 'účetní kategorie musí být v accounting');
  assert.equal(row.saldo, 0, 'saldo obou noh převodu = 0');
  assert.equal(row.tx_count, 2);
  server.close();
});

test('accounting: kategorie type 1/2/3 se v accounting neobjeví', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (8,1,'Jídlo',1),(9,1,'Licence',2)").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,8,-300,'2026-07-05','Rohlik')").run();
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal((stats.accounting || []).length, 0);
  server.close();
});

test('outflow: všechny výdaje z výdajových účtů po kategoriích, bez interních převodů', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  // účty: Společný = spending, Spořicí = ignored (vlastní účet → cíl interního převodu)
  const spendId = db.prepare("INSERT INTO accounts (user_id, account_number, name, role) VALUES (1,'100/3030','Společný','spending')").run().lastInsertRowid;
  db.prepare("INSERT INTO accounts (user_id, account_number, name, role) VALUES (1,'200/3030','Spořicí','ignored')").run();
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (10,1,'Jídlo',1),(11,1,'Oblečení',2)").run();
  // reálné výdaje z výdajového účtu (různé typy kategorií i nezařazené)
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description,account_id,counterparty_account) VALUES \
    (1,10,-300,'2026-07-03','Rohlik',?,'999/0800'), \
    (1,10,-200,'2026-07-04','Albert',?,'888/0800'), \
    (1,11,-1000,'2026-07-05','Zara',?,'777/0800'), \
    (1,NULL,-150,'2026-07-06','Neznámé',?,'666/0800')").run(spendId, spendId, spendId, spendId);
  // interní převod na vlastní Spořicí účet (counterparty = náš účet) → NESMÍ se počítat
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description,account_id,counterparty_account) VALUES (1,NULL,-5000,'2026-07-07','Vklad na spořicí',?,'200/3030')").run(spendId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.ok(stats.outflow, 'outflow musí být v odpovědi');
  assert.equal(stats.outflow.total, 1650, 'součet výdajů bez interního převodu (300+200+1000+150)');
  const jidlo = stats.outflow.by_category.find(c => c.category_id === 10);
  assert.equal(jidlo.sum, 500, 'Jídlo = 300+200');
  const obleceni = stats.outflow.by_category.find(c => c.category_id === 11);
  assert.equal(obleceni.sum, 1000, 'Oblečení (typ 2) se taky počítá — nezávisle na typu');
  const nezarazene = stats.outflow.by_category.find(c => c.category_id == null);
  assert.equal(nezarazene.sum, 150, 'nezařazené (category_id NULL)');
  // seřazeno sestupně dle sum
  assert.deepEqual(stats.outflow.by_category.map(c => c.sum), [1000, 500, 150]);
  server.close();
});

test('outflow: výdaje z účtu jiné role než spending se nezapočítají', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const fixedId = db.prepare("INSERT INTO accounts (user_id, account_number, name, role) VALUES (1,'300/3030','Rezerva','fixed')").run().lastInsertRowid;
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (12,1,'Nájem',1)").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description,account_id,counterparty_account) VALUES (1,12,-9000,'2026-07-03','Nájem',?,'555/0800')").run(fixedId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.outflow.total, 0, 'výdaj z fixed účtu se do outflow nepočítá');
  server.close();
});
