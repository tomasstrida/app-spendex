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

test('fáze A: reálná kategorie (typ 3) na ignorovaném účtu se počítá do výdajů', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (20,1,'Drahé věci',3),(21,1,'Mimo systém',1)").run();
  const ignId = db.prepare("INSERT INTO accounts (user_id,account_number,name,role) VALUES (1,'700/3030','zz','ignored')").run().lastInsertRowid;
  const incId = db.prepare("INSERT INTO accounts (user_id,account_number,name,role) VALUES (1,'800/3030','OSVC','income')").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description,counterparty_account) VALUES \
    (1,20,?,-4000,'2026-07-05','Drahá věc z ignored','999/0800'), \
    (1,21,?,-1000,'2026-07-06','Mimo systém z ignored','888/0800'), \
    (1,20,?,-9000,'2026-07-07','Drahá věc z OSVC','777/0800')").run(ignId, ignId, incId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  const drahe = (stats.by_category || []).find(c => c.id === 20);
  assert.equal(drahe.spent, 4000, 'drahá věc z ignored účtu se počítá; z OSVC ne; Mimo systém ne');
  assert.equal(stats.total_spent, 4000, 'total zahrne jen reálnou kategorii z ignored (ne Mimo systém, ne OSVC)');
  server.close();
});

test('fund_topup: outflow bere jen odchozí nohy z NE-fondového účtu, saldo hlídá párovou nohu', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type,system_role) VALUES (40,1,'Nestandardní dobití ročního budgetu',4,'fund_topup')").run();
  const hlavni = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'100/3030','Hlavní','ignored',0)").run().lastInsertRowid;
  const fond   = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'200/3030','Licence','spending',1)").run().lastInsertRowid;
  // obě nohy jednoho převodu: odchozí z Hlavní (počítá se), příchozí na fond (ne)
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description) VALUES (1,40,?,-10500,'2026-07-22','Tomáš Střída'),(1,40,?,10500,'2026-07-22','Tomáš Střída')").run(hlavni, fond);
  // mimo období
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description) VALUES (1,40,?,-999,'2026-06-15','Starý')").run(hlavni);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.fund_topup.category_id, 40);
  assert.equal(stats.fund_topup.name, 'Nestandardní dobití ročního budgetu');
  assert.equal(stats.fund_topup.outflow, 10500);
  assert.equal(stats.fund_topup.tx_count, 1);
  assert.equal(stats.fund_topup.saldo, 0, 'obě nohy označené → saldo 0');
  server.close();
});

test('fund_topup: chybějící párová noha se pozná na saldu', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type,system_role) VALUES (40,1,'Nestandardní dobití',4,'fund_topup')").run();
  const hlavni = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'100/3030','Hlavní','ignored',0)").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description) VALUES (1,40,?,-10500,'2026-07-22','Tomáš Střída')").run(hlavni);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.fund_topup.outflow, 10500);
  assert.equal(stats.fund_topup.saldo, -10500, 'jen jedna noha → saldo != 0');
  server.close();
});

test('fund_topup: bez kategorie fund_topup vrací nuly a category_id null', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.fund_topup.category_id, null);
  assert.equal(stats.fund_topup.outflow, 0);
  server.close();
});

test('annual_off_fund: null dokud není fondový účet, pak roční výdaje mimo fond', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (50,1,'Y_Licence',2)").run();
  const spol = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'300/3030','Společný','spending',0)").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description) VALUES (1,50,?,-2253,'2026-07-15','ANTHROPIC')").run(spol);
  const before = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(before.annual_off_fund, null, 'bez fondového účtu je řádek vypnutý');

  const fond = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'200/3030','Licence','spending',1)").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description) VALUES (1,50,?,-399,'2026-07-04','APPLE.COM')").run(fond);
  const after = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(after.annual_off_fund.spent, 2253, 'jen výdaj z NE-fondového účtu');
  assert.equal(after.annual_off_fund.tx_count, 1);
  server.close();
});

test('annual_off_fund: respektuje SPENDING_FILTER (roční výdaj z OSVČ účtu se nepočítá)', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (50,1,'Y_Licence',2)").run();
  db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'200/3030','Licence','spending',1)").run();
  const osvc = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'400/3030','Tom-OSVC','income',0)").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description) VALUES (1,50,?,-5000,'2026-07-10','Něco z OSVČ')").run(osvc);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.annual_off_fund.spent, 0);
  server.close();
});

test('prepaid_purchase: outflow secte nakupy balicku za obdobi', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type,system_role) VALUES (41,1,'Nákup předplacených balíčků',4,'prepaid_purchase')").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,41,-5000,'2026-07-04','Fitness 10x'),(1,41,-2000,'2026-07-20','Masaze 5x'),(1,41,-1000,'2026-06-30','Minule obdobi')").run();
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.prepaid_purchase.category_id, 41);
  assert.equal(stats.prepaid_purchase.outflow, 7000);
  assert.equal(stats.prepaid_purchase.tx_count, 2);
  server.close();
});

test('prepaid_purchase: technicka kategorie se neobjevi v sekci Ucetni', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type,system_role) VALUES (41,1,'Nákup předplacených balíčků',4,'prepaid_purchase')").run();
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (42,1,'Převody interní',4)").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,41,-5000,'2026-07-04','Fitness 10x'),(1,42,-100,'2026-07-05','Prevod')").run();
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  const ids = (stats.accounting || []).map(a => a.id);
  assert.ok(!ids.includes(41), 'prepaid_purchase nepatri do sekce Ucetni');
  assert.ok(ids.includes(42), 'skutecne prevody v sekci Ucetni zustavaji');
  server.close();
});

test('prepaid_purchase: bez technicke kategorie vraci nuly', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.prepaid_purchase.category_id, null);
  assert.equal(stats.prepaid_purchase.outflow, 0);
  server.close();
});

// ── Spořicí účet: pohyby zaúčtované PŘÍMO na spořicím účtu ──
// Interní převod má v DB obě nohy (odchozí z běžného + příchozí na spořicí), proto
// se pohyby berou z nohy, kde je spořicí protiúčtem. Peníze, které na spořicí přijdou
// zvenku (cizí odesílatel) nebo bez protistrany (úrok), ale druhou nohu nemají —
// bez nich by v přehledu chyběly.
const SAVINGS_ACC = '1679014082/3030';
const MAIN_ACC = '1679014138/3030';

function setupSavings() {
  const { db, app } = setup();
  const savingsId = db.prepare("INSERT INTO accounts (user_id, account_number, name, role) VALUES (1,?,'Spořicí-účet-1','ignored')").run(SAVINGS_ACC).lastInsertRowid;
  const mainId = db.prepare("INSERT INTO accounts (user_id, account_number, name, role) VALUES (1,?,'Hlavní','ignored')").run(MAIN_ACC).lastInsertRowid;
  return { db, app, savingsId, mainId };
}

test('savings: příchozí platba od cizí protistrany přímo na spořicí je vklad', async () => {
  const { db, app, savingsId } = setupSavings();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,100,'2026-08-02','Libor Bísek','1812270019/3030',?)").run(savingsId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-08`)).json();
  assert.equal(stats.savings.deposits, 100);
  assert.equal(stats.savings.withdrawals, 0);
  assert.equal(stats.savings.net, 100);
  const tr = stats.savings.transfers.find(t => t.description === 'Libor Bísek');
  assert.ok(tr, 'převod musí být v rozpisu');
  assert.equal(tr.external, 1, 'řádek je označený jako pohyb bez druhé nohy');
  assert.equal(tr.amount, 100, 'u externího pohybu je amount z pohledu spořicího účtu');
  server.close();
});

test('savings: úrok připsaný na spořicí (bez protistrany) je vklad', async () => {
  const { db, app, savingsId } = setupSavings();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,164.1,'2026-08-31','Kreditní úrok od Air Bank',NULL,?)").run(savingsId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-08`)).json();
  assert.equal(stats.savings.deposits, 164.1);
  assert.equal(stats.savings.transfers.length, 1);
  server.close();
});

test('savings: odchozí platba ze spořicího cizí protistraně je výběr', async () => {
  const { db, app, savingsId } = setupSavings();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,-250,'2026-08-05','Cizi prijemce','2222222222/0800',?)").run(savingsId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-08`)).json();
  assert.equal(stats.savings.withdrawals, 250);
  assert.equal(stats.savings.deposits, 0);
  assert.equal(stats.savings.net, -250);
  server.close();
});

test('savings: interní převod s oběma nohama se nezapočítá dvakrát', async () => {
  const { db, app, savingsId, mainId } = setupSavings();
  const { server, base } = await listen(app);
  // noha 1: odchozí z Hlavního (protiúčet = spořicí), noha 2: příchozí na spořicí (protiúčet = Hlavní)
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,-5000,'2026-08-10','Tomáš Střída',?,?)").run(SAVINGS_ACC, mainId);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,5000,'2026-08-10','Tomáš Střída',?,?)").run(MAIN_ACC, savingsId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-08`)).json();
  assert.equal(stats.savings.deposits, 5000, 'jen jedna noha převodu');
  assert.equal(stats.savings.transfers.length, 1);
  assert.equal(stats.savings.transfers[0].external, 0, 'interní převod není externí pohyb');
  server.close();
});

test('savings: noha na spořicím bez protiúčtu se nezapočítá dvakrát, když pár existuje', async () => {
  const { db, app, savingsId, mainId } = setupSavings();
  const { server, base } = await listen(app);
  // odchozí noha má protiúčet vyplněný, příchozí noha na spořicím ho postrádá
  // (parser ho u některých plateb nevytáhne) — dedup se nesmí opírat jen o protiúčet
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,-5000,'2026-08-10','Tomáš Střída',?,?)").run(SAVINGS_ACC, mainId);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,5000,'2026-08-10','Tomáš Střída',NULL,?)").run(savingsId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-08`)).json();
  assert.equal(stats.savings.deposits, 5000, 'jen jedna noha převodu');
  assert.equal(stats.savings.transfers.length, 1);
  server.close();
});

test('savings: noha na spořicím s vlastním protiúčtem zůstane, když pár v datech není', async () => {
  const { db, app, savingsId } = setupSavings();
  const { server, base } = await listen(app);
  // druhý vlastní účet uživatel nemá naimportovaný → protilehlá noha v DB chybí;
  // pohyb se nesmí zahodit, jinak z přehledu zmizí skutečný vklad
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,3000,'2026-08-12','Tomáš Střída',?,?)").run(MAIN_ACC, savingsId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-08`)).json();
  assert.equal(stats.savings.deposits, 3000);
  assert.equal(stats.savings.transfers.length, 1);
  server.close();
});

test('savings: dva stejné převody ve stejný den spárují obě nohy 1:1', async () => {
  const { db, app, savingsId, mainId } = setupSavings();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,-1000,'2026-08-14','Tomáš Střída',?,?),(1,-1000,'2026-08-14','Tomáš Střída',?,?)").run(SAVINGS_ACC, mainId, SAVINGS_ACC, mainId);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,1000,'2026-08-14','Tomáš Střída',?,?),(1,1000,'2026-08-14','Tomáš Střída',?,?)").run(MAIN_ACC, savingsId, MAIN_ACC, savingsId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-08`)).json();
  assert.equal(stats.savings.deposits, 2000, 'oba převody právě jednou');
  assert.equal(stats.savings.transfers.length, 2);
  server.close();
});

test('savings: bez založeného spořicího účtu funguje aspoň větev přes protiúčet', async () => {
  const { db, app } = setup();          // žádný účet v accounts
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account) VALUES (1,-5000,'2026-08-10','Tomáš Střída','1679014082/3030')").run();
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-08`)).json();
  assert.equal(stats.savings.deposits, 5000);
  assert.equal(stats.savings.transfers.length, 1);
  server.close();
});

test('savings: číslo účtu s mezerami se rozpozná jako vlastní účet', async () => {
  const { db, app, savingsId, mainId } = setupSavings();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,-2000,'2026-08-16','Tomáš Střída',?,?)").run(' 1679014082/3030 ', mainId);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,2000,'2026-08-16','Tomáš Střída',?,?)").run(' 1679014138/3030 ', savingsId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-08`)).json();
  assert.equal(stats.savings.deposits, 2000, 'jen jedna noha');
  assert.equal(stats.savings.transfers.length, 1);
  server.close();
});

test('savings: nohy převodu s posunutým datem se spárují (nezdvojí se)', async () => {
  const { db, app, savingsId, mainId } = setupSavings();
  const { server, base } = await listen(app);
  // banka zaúčtuje strany v jiný den; bez tolerance by se převod počítal dvakrát
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,-5000,'2026-08-10','Tomáš Střída',?,?)").run(SAVINGS_ACC, mainId);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,5000,'2026-08-11','Tomáš Střída',NULL,?)").run(savingsId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-08`)).json();
  assert.equal(stats.savings.deposits, 5000);
  assert.equal(stats.savings.transfers.length, 1);
  server.close();
});

test('savings: vzdálený pohyb stejné částky se NEspáruje (mimo okno)', async () => {
  const { db, app, savingsId, mainId } = setupSavings();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,-5000,'2026-08-05','Tomáš Střída',?,?)").run(SAVINGS_ACC, mainId);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,5000,'2026-08-25','Nezavisly vklad',NULL,?)").run(savingsId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-08`)).json();
  assert.equal(stats.savings.deposits, 10000, 'dva nezávislé vklady');
  assert.equal(stats.savings.transfers.length, 2);
  server.close();
});

test('savings: shodné datum má při párování přednost před posunutým', async () => {
  const { db, app, savingsId, mainId } = setupSavings();
  const { server, base } = await listen(app);
  // dvě referenční nohy stejné částky (11. a 12.) a dvě nohy na spořicím (12. a 14.):
  // greedy párování musí obě spotřebovat, jinak jeden převod propadne jako externí
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,-1000,'2026-08-11','A',?,?),(1,-1000,'2026-08-12','B',?,?)").run(SAVINGS_ACC, mainId, SAVINGS_ACC, mainId);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,1000,'2026-08-12','A',NULL,?),(1,1000,'2026-08-14','B',NULL,?)").run(savingsId, savingsId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-08`)).json();
  assert.equal(stats.savings.deposits, 2000, 'oba převody právě jednou');
  assert.equal(stats.savings.transfers.length, 2);
  server.close();
});

// ── GET /api/stats/budget-history ─────────────────────────────────────────
// Dlouhodobé vyhodnocení: utraceno po obdobích, jedna série na kategorii.

test('budget-history: rozdělí výdaje do období podle billing_day', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("UPDATE settings SET billing_day = 15 WHERE user_id = 1").run();
  db.prepare("INSERT INTO settings (user_id, billing_day) SELECT 1, 15 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE user_id = 1)").run();
  db.prepare("INSERT INTO categories (id,user_id,name,type,color) VALUES (30,1,'Potraviny',1,'#ff0000')").run();
  // 2026-06-20 → období 2026-06; 2026-07-10 → pořád období 2026-06 (billing_day 15)
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES \
    (1,30,-100,'2026-06-20','a'),(1,30,-200,'2026-07-10','b'),(1,30,-50,'2026-07-20','c')").run();
  const r = await (await fetch(`${base}/api/stats/budget-history?from=2026-06&to=2026-07`)).json();
  assert.deepEqual(r.periods.map(p => p.key), ['2026-06', '2026-07']);
  assert.equal(r.billing_day, 15);
  const s = r.series.find(x => x.category_id === 30);
  assert.deepEqual(s.values, [300, 50]);
  assert.equal(s.total, 350);
  assert.equal(s.color, '#ff0000');
  server.close();
});

test('budget-history: refund se v rámci kategorie odečte', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (31,1,'Oblečení',1)").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES \
    (1,31,-1000,'2026-07-05','nákup'),(1,31,400,'2026-07-20','vratka')").run();
  const r = await (await fetch(`${base}/api/stats/budget-history?from=2026-07&to=2026-07`)).json();
  assert.deepEqual(r.series.find(x => x.category_id === 31).values, [600]);
  server.close();
});

test('budget-history: účetní kategorie (type=4) a kategorie bez pohybu se nevrací', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (32,1,'Převody interní',4),(33,1,'Nic',1)").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,32,-5000,'2026-07-05','převod')").run();
  const r = await (await fetch(`${base}/api/stats/budget-history?from=2026-07&to=2026-07`)).json();
  assert.equal(r.series.find(x => x.category_id === 32), undefined, 'type=4 do výdajových sérií nepatří');
  assert.equal(r.series.find(x => x.category_id === 33), undefined, 'kategorie bez pohybu se vynechá');
  server.close();
});

test('budget-history: čerpání předplaceného balíčku se počítá do kategorie', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (34,1,'Masáže',1)").run();
  const pkg = db.prepare("INSERT INTO prepaid_packages (user_id,category_id,name,total_amount,units_total,unit_amount) VALUES (1,34,'10 vstupů',5000,10,500)").run().lastInsertRowid;
  db.prepare("INSERT INTO prepaid_draws (user_id,package_id,date,units,amount) VALUES (1,?,'2026-07-04',1,500),(1,?,'2026-08-04',1,500)").run(pkg, pkg);
  const r = await (await fetch(`${base}/api/stats/budget-history?from=2026-07&to=2026-08`)).json();
  assert.deepEqual(r.series.find(x => x.category_id === 34).values, [500, 500]);
  server.close();
});

test('budget-history: fáze A — výdaj z OSVČ účtu se nezapočítá', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (35,1,'Jídlo',1)").run();
  const inc = db.prepare("INSERT INTO accounts (user_id,account_number,name,role) VALUES (1,'800/3030','OSVC','income')").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description) VALUES (1,35,?,-900,'2026-07-05','z OSVC'),(1,35,NULL,-100,'2026-07-06','z běžného')").run(inc);
  const r = await (await fetch(`${base}/api/stats/budget-history?from=2026-07&to=2026-07`)).json();
  assert.deepEqual(r.series.find(x => x.category_id === 35).values, [100]);
  server.close();
});

test('budget-history: série seřazené podle součtu sestupně', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (36,1,'Malá',1),(37,1,'Velká',1)").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,36,-100,'2026-07-05','a'),(1,37,-9000,'2026-07-05','b')").run();
  const r = await (await fetch(`${base}/api/stats/budget-history?from=2026-07&to=2026-07`)).json();
  assert.deepEqual(r.series.map(s => s.category_id), [37, 36]);
  server.close();
});

test('budget-history: bez parametrů vrátí posledních 12 období', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const r = await (await fetch(`${base}/api/stats/budget-history`)).json();
  assert.equal(r.periods.length, 12);
  assert.equal(r.periods[11].key, r.to);
  assert.equal(r.periods[0].key, r.from);
  server.close();
});

test('budget-history: validace vstupů', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  assert.equal((await fetch(`${base}/api/stats/budget-history?from=2026-13&to=2026-07`)).status, 400);
  assert.equal((await fetch(`${base}/api/stats/budget-history?from=cerven&to=2026-07`)).status, 400);
  assert.equal((await fetch(`${base}/api/stats/budget-history?from=2026-08&to=2026-07`)).status, 400);
  assert.equal((await fetch(`${base}/api/stats/budget-history?from=2000-01&to=2026-07`)).status, 400);
  server.close();
});

test('budget-history: limits berou default rozpočet a přepsání pro konkrétní období', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (50,1,'Potraviny',1)").run();
  db.prepare("INSERT INTO budgets (user_id,category_id,month,amount) VALUES (1,50,'default',8000),(1,50,'2026-07',12000)").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,50,-100,'2026-06-05','a')").run();
  const r = await (await fetch(`${base}/api/stats/budget-history?from=2026-06&to=2026-08`)).json();
  assert.deepEqual(r.series.find(s => s.category_id === 50).limits, [8000, 12000, 8000]);
  server.close();
});

test('budget-history: kategorie bez měsíčního rozpočtu má limits null', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (51,1,'Oblečení',2)").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,51,-500,'2026-07-05','a')").run();
  const r = await (await fetch(`${base}/api/stats/budget-history?from=2026-07&to=2026-07`)).json();
  assert.equal(r.series.find(s => s.category_id === 51).limits, null);
  server.close();
});

test('budget-history: přepsání bez defaultu nechá ostatní období bez limitu', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (52,1,'Sport',1)").run();
  db.prepare("INSERT INTO budgets (user_id,category_id,month,amount) VALUES (1,52,'2026-07',3000)").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,52,-500,'2026-07-05','a')").run();
  const r = await (await fetch(`${base}/api/stats/budget-history?from=2026-06&to=2026-07`)).json();
  assert.deepEqual(r.series.find(s => s.category_id === 52).limits, [null, 3000]);
  server.close();
});

test('budget-history: rozpočet cizího uživatele se nepromítne', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO users (id, email) VALUES (2,'x@x')").run();
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (53,1,'Zábava',1)").run();
  db.prepare("INSERT INTO budgets (user_id,category_id,month,amount) VALUES (2,53,'default',9999)").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,53,-500,'2026-07-05','a')").run();
  const r = await (await fetch(`${base}/api/stats/budget-history?from=2026-07&to=2026-07`)).json();
  assert.equal(r.series.find(s => s.category_id === 53).limits, null);
  server.close();
});
