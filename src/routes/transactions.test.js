'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-transactions-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./transactions']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (5,1,'Licence')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/transactions', require('./transactions'));
  return { db, app };
}

test('PATCH nastaví subcategory_id a GET vrátí subcategory_name', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const subId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'ChatGPT')").run().lastInsertRowid;
  const txId = db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-500,'2026-07-01','OPENAI')").run().lastInsertRowid;
  const res = await fetch(`${base}/api/transactions/${txId}`, { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ subcategory_id: subId }) });
  assert.equal(res.status, 200);
  const list = await (await fetch(`${base}/api/transactions`)).json();
  const rows = list.transactions || list;
  const tx = rows.find(t => t.id === txId);
  assert.equal(tx.subcategory_name, 'ChatGPT');
  assert.equal(tx.subcategory_id, subId);
  server.close();
});

test('PATCH: vynechání subcategory_id zachová dřívější hodnotu (partial update)', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const subId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'ChatGPT')").run().lastInsertRowid;
  const txId = db.prepare("INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description) VALUES (1,5,?,-500,'2026-07-01','OPENAI')").run(subId).lastInsertRowid;
  const res = await fetch(`${base}/api/transactions/${txId}`, { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ note: 'test' }) });
  assert.equal(res.status, 200);
  const patched = await res.json();
  assert.equal(patched.subcategory_id, subId);
  server.close();
});

test('PATCH: subcategory_id=null vymaže subkategorii', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const subId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'ChatGPT')").run().lastInsertRowid;
  const txId = db.prepare("INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description) VALUES (1,5,?,-500,'2026-07-01','OPENAI')").run(subId).lastInsertRowid;
  const res = await fetch(`${base}/api/transactions/${txId}`, { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ subcategory_id: null }) });
  assert.equal(res.status, 200);
  const patched = await res.json();
  assert.equal(patched.subcategory_id, null);
  server.close();
});

test('GET: transakce bez subcategory_id vrátí subcategory_name = null', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-100,'2026-07-02','JINA')").run();
  const list = await (await fetch(`${base}/api/transactions`)).json();
  const rows = list.transactions || list;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].subcategory_name, null);
  server.close();
});

test('PATCH: subcategory_id jiného usera odmítnut (400), tx zůstane beze změny', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO users (id, email) VALUES (2,'other@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (6,2,'Cizí')").run();
  const foreignSubId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (2,6,'Cizí sub')").run().lastInsertRowid;
  const txId = db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-500,'2026-07-01','OPENAI')").run().lastInsertRowid;
  const res = await fetch(`${base}/api/transactions/${txId}`, { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ subcategory_id: foreignSubId }) });
  assert.equal(res.status, 400);
  const stored = db.prepare('SELECT subcategory_id FROM transactions WHERE id = ?').get(txId);
  assert.equal(stored.subcategory_id, null);
  server.close();
});

test('PATCH: vlastní subkategorie pod jinou kategorií než tx odmítnuta (400)', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const otherCatId = db.prepare("INSERT INTO categories (user_id, name) VALUES (1,'Jídlo')").run().lastInsertRowid;
  const subId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,?, 'Restaurace')").run(otherCatId).lastInsertRowid;
  const txId = db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-500,'2026-07-01','OPENAI')").run().lastInsertRowid;
  const res = await fetch(`${base}/api/transactions/${txId}`, { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ subcategory_id: subId }) });
  assert.equal(res.status, 400);
  const stored = db.prepare('SELECT subcategory_id FROM transactions WHERE id = ?').get(txId);
  assert.equal(stored.subcategory_id, null);
  server.close();
});

test('PATCH: validní subkategorie správné kategorie projde (happy path)', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const subId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'ChatGPT')").run().lastInsertRowid;
  const txId = db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-500,'2026-07-01','OPENAI')").run().lastInsertRowid;
  const res = await fetch(`${base}/api/transactions/${txId}`, { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ subcategory_id: subId }) });
  assert.equal(res.status, 200);
  const patched = await res.json();
  assert.equal(patched.subcategory_id, subId);
  server.close();
});

test('GET: cizí subkategorie se stejným id (jiný user) se nepromítne (defense-in-depth JOIN)', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO users (id, email) VALUES (2,'other@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (6,2,'Cizí')").run();
  const foreignSubId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (2,6,'Cizí sub')").run().lastInsertRowid;
  // tx patřící userovi 1, ale s subcategory_id ukazujícím na subkategorii cizího usera (simulace nekonzistence)
  db.prepare("INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description) VALUES (1,5,?,-100,'2026-07-03','X')").run(foreignSubId);
  const list = await (await fetch(`${base}/api/transactions`)).json();
  const rows = list.transactions || list;
  const tx = rows.find(t => t.description === 'X');
  assert.equal(tx.subcategory_name, null);
  server.close();
});

test('PATCH: tx s nekonzistentním subcategory_id (cizí user) editace jiného pole projde (200), subcategory_id beze změny', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO users (id, email) VALUES (2,'other@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (6,2,'Cizí')").run();
  const foreignSubId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (2,6,'Cizí sub')").run().lastInsertRowid;
  // Simulace prod bugu: tx patří userovi 1, ale subcategory_id ukazuje na subkategorii cizího usera.
  // Request PATCHuje JEN note, bez subcategory_id/category_id v body → validace se nesmí spustit.
  const txId = db.prepare("INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description) VALUES (1,5,?,-100,'2026-07-03','X')").run(foreignSubId).lastInsertRowid;
  const res = await fetch(`${base}/api/transactions/${txId}`, { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ note: 'x' }) });
  assert.equal(res.status, 200);
  const patched = await res.json();
  assert.equal(patched.note, 'x');
  assert.equal(patched.subcategory_id, foreignSubId);
  server.close();
});

test('GET: subcategory_id filtruje jen transakce dané subkategorie', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const subA = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'ChatGPT')").run().lastInsertRowid;
  const subB = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'Netflix')").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description) VALUES (1,5,?,-500,'2026-07-01','OPENAI')").run(subA);
  db.prepare("INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description) VALUES (1,5,?,-200,'2026-07-02','NETFLIX')").run(subB);
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-100,'2026-07-03','JINA')").run();
  const list = await (await fetch(`${base}/api/transactions?subcategory_id=${subA}`)).json();
  const rows = list.transactions || list;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].description, 'OPENAI');
  server.close();
});

test('GET /export vrátí CSV s hlavičkou, BOM a respektuje filtr', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-500,'2026-07-01','OPENAI'),(1,5,-200,'2026-07-02','NETFLIX'),(1,5,-100,'2026-06-15','STARE')").run();
  const res = await fetch(`${base}/api/transactions/export?from=2026-07-01&to=2026-07-31`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  // arrayBuffer, ne text() — fetch().text() podle WHATWG spec strippuje úvodní BOM
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([buf[0], buf[1], buf[2]], [0xEF, 0xBB, 0xBF], 'CSV musí začínat UTF-8 BOM');
  const body = buf.toString('utf8');
  assert.match(body, /Datum;Čas;Popis/);        // hlavička
  assert.ok(body.includes('OPENAI') && body.includes('NETFLIX'), 'obě červencové tx');
  assert.ok(!body.includes('STARE'), 'červnová tx je mimo filtr from/to');
  server.close();
});

test('GET /export: středník/uvozovky v hodnotě se escapují', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-500,'2026-07-01','A ; B \"C\"')").run();
  const res = await fetch(`${base}/api/transactions/export?from=2026-07-01&to=2026-07-31`);
  const body = await res.text();
  assert.ok(body.includes('"A ; B ""C"""'), 'hodnota se středníkem/uvozovkami je obalená a uvozovky zdvojené');
  server.close();
});

test('off_fund=1 vyloučí transakce z fondového účtu', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const fond = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'200/3030','Licence','spending',1)").run().lastInsertRowid;
  const spol = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'300/3030','Společný','spending',0)").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description) VALUES (1,5,?,-399,'2026-07-04','APPLE z fondu'),(1,5,?,-2253,'2026-07-15','ANTHROPIC ze Společného')").run(fond, spol);
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,5,-100,'2026-07-16','Bez účtu')").run();

  const res = await (await fetch(`${base}/api/transactions?off_fund=1`)).json();
  const rows = res.transactions || res;
  const descs = rows.map(r => r.description).sort();
  server.close();
  assert.deepEqual(descs, ['ANTHROPIC ze Společného', 'Bez účtu'], 'tx z fondového účtu vypadne, tx bez účtu zůstane');
});

test('tx_ids=1,2 vrátí přesně zadané transakce (a nic víc)', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const a = db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,5,-100,'2026-07-01','A')").run().lastInsertRowid;
  const b = db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,5,-200,'2026-07-02','B')").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,5,-300,'2026-07-03','C')").run();
  const res = await (await fetch(`${base}/api/transactions?tx_ids=${a},${b}`)).json();
  const rows = res.transactions || res;
  server.close();
  assert.deepEqual(rows.map(r => r.description).sort(), ['A', 'B']);
});

test('tx_ids ignoruje nečíselné hodnoty a prázdný seznam nefiltruje', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const a = db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,5,-100,'2026-07-01','A')").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,5,-200,'2026-07-02','B')").run();
  const dirty = await (await fetch(`${base}/api/transactions?tx_ids=${a},abc,,`)).json();
  const empty = await (await fetch(`${base}/api/transactions?tx_ids=`)).json();
  server.close();
  assert.deepEqual((dirty.transactions || dirty).map(r => r.description), ['A']);
  assert.equal((empty.transactions || empty).length, 2, 'prázdný tx_ids se ignoruje');
});

test('tx_ids nesmí prolomit izolaci uživatele', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO users (id,email) VALUES (2,'x@y')").run();
  db.prepare("INSERT INTO categories (id,user_id,name) VALUES (9,2,'Cizí')").run();
  const foreign = db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (2,9,-500,'2026-07-01','CIZÍ')").run().lastInsertRowid;
  const res = await (await fetch(`${base}/api/transactions?tx_ids=${foreign}`)).json();
  server.close();
  assert.equal((res.transactions || res).length, 0, 'cizí transakce se nesmí vrátit');
});

// ── Předplacené balíčky: zdrojová platba nesmí jít přeřadit zpátky ──────────
// Balíček přesune transakci do technické kategorie a čerpání se počítá zvlášť
// (prepaid_spent v /api/budgets). Kdyby šlo kategorii vrátit ručně, částka by
// se sečetla s čerpáním podruhé (viz nález review).

test('PATCH odmítne změnu category_id u transakce patřící k předplacenému balíčku', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const purchaseCatId = db.prepare(
    "INSERT INTO categories (user_id, name, type, system_role) VALUES (1,'Nákup předplacených balíčků',4,'prepaid_purchase')"
  ).run().lastInsertRowid;
  const txId = db.prepare(
    "INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,?,-5000,'2026-07-01','Fitness 10x')"
  ).run(purchaseCatId).lastInsertRowid;
  db.prepare(`
    INSERT INTO prepaid_packages
      (user_id, transaction_id, category_id, original_category_id, name, total_amount, units_total, unit_amount)
    VALUES (1, ?, 5, 5, 'Fitness 10x', 5000, 10, 500)
  `).run(txId);

  const res = await fetch(`${base}/api/transactions/${txId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category_id: 5 }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /balíčk/i);
  const stored = db.prepare('SELECT category_id FROM transactions WHERE id = ?').get(txId);
  assert.equal(stored.category_id, purchaseCatId, 'kategorie zůstala beze změny');
  server.close();
});

test('PATCH odmítne i vynulování category_id (category_id: null) u transakce s balíčkem', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const purchaseCatId = db.prepare(
    "INSERT INTO categories (user_id, name, type, system_role) VALUES (1,'Nákup předplacených balíčků',4,'prepaid_purchase')"
  ).run().lastInsertRowid;
  const txId = db.prepare(
    "INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,?,-5000,'2026-07-01','Fitness 10x')"
  ).run(purchaseCatId).lastInsertRowid;
  db.prepare(`
    INSERT INTO prepaid_packages
      (user_id, transaction_id, category_id, original_category_id, name, total_amount, units_total, unit_amount)
    VALUES (1, ?, 5, 5, 'Fitness 10x', 5000, 10, 500)
  `).run(txId);

  const res = await fetch(`${base}/api/transactions/${txId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category_id: null }),
  });
  assert.equal(res.status, 400);
  const stored = db.prepare('SELECT category_id FROM transactions WHERE id = ?').get(txId);
  assert.equal(stored.category_id, purchaseCatId);
  server.close();
});

test('PATCH povolí editaci jiných polí u transakce s balíčkem, když category_id v požadavku zůstává stejné', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const purchaseCatId = db.prepare(
    "INSERT INTO categories (user_id, name, type, system_role) VALUES (1,'Nákup předplacených balíčků',4,'prepaid_purchase')"
  ).run().lastInsertRowid;
  const txId = db.prepare(
    "INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,?,-5000,'2026-07-01','Fitness 10x')"
  ).run(purchaseCatId).lastInsertRowid;
  db.prepare(`
    INSERT INTO prepaid_packages
      (user_id, transaction_id, category_id, original_category_id, name, total_amount, units_total, unit_amount)
    VALUES (1, ?, 5, 5, 'Fitness 10x', 5000, 10, 500)
  `).run(txId);

  const res = await fetch(`${base}/api/transactions/${txId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note: 'zaplaceno kartou' }),
  });
  assert.equal(res.status, 200, 'bez skutečné změny kategorie PATCH projde');
  const patched = await res.json();
  assert.equal(patched.note, 'zaplaceno kartou');
  server.close();
});

test('GET a PATCH vrací prepaid_package_id u transakce patřící k balíčku, jinak null', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const purchaseCatId = db.prepare(
    "INSERT INTO categories (user_id, name, type, system_role) VALUES (1,'Nákup předplacených balíčků',4,'prepaid_purchase')"
  ).run().lastInsertRowid;
  const txId = db.prepare(
    "INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,?,-5000,'2026-07-01','Fitness 10x')"
  ).run(purchaseCatId).lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-100,'2026-07-02','Jiná')").run();
  const pkgId = db.prepare(`
    INSERT INTO prepaid_packages
      (user_id, transaction_id, category_id, original_category_id, name, total_amount, units_total, unit_amount)
    VALUES (1, ?, 5, 5, 'Fitness 10x', 5000, 10, 500)
  `).run(txId).lastInsertRowid;

  const list = await (await fetch(`${base}/api/transactions`)).json();
  const rows = list.transactions || list;
  const withPkg = rows.find(r => r.id === txId);
  const withoutPkg = rows.find(r => r.id !== txId);
  assert.equal(withPkg.prepaid_package_id, pkgId);
  assert.equal(withoutPkg.prepaid_package_id, null);

  const patched = await (await fetch(`${base}/api/transactions/${txId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note: 'x' }),
  })).json();
  assert.equal(patched.prepaid_package_id, pkgId, 'odznak přežije PATCH, který kategorii nemění');
  server.close();
});

test('fulltext hleda i v nazvu subkategorie (vc. diakritiky a velikosti pismen)', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const subId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'Předplatné YouTube')").run().lastInsertRowid;
  const hit = db.prepare("INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description) VALUES (1,5,?,-269,'2026-06-30','APPLE.COM/BILL')").run(subId).lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-100,'2026-06-30','APPLE.COM/BILL')").run();

  const found = await (await fetch(`${base}/api/transactions?q=youtube`)).json();
  const rows = found.transactions || found;
  assert.equal(rows.length, 1, 'najde jen transakci se subkategorii YouTube');
  assert.equal(rows[0].id, Number(hit));

  const accent = await (await fetch(`${base}/api/transactions?q=predplatne`)).json();
  assert.equal((accent.transactions || accent).length, 1, 'hleda bez ohledu na diakritiku');
  server.close();
});

test('filtr apple_account vrati jen transakce daneho uctu', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (400,1,5,-269,'2026-03-01','APPLE.COM/BILL'),
                     (401,1,5,-500,'2026-03-02','APPLE.COM/BILL'),
                     (402,1,5,-100,'2026-03-03','APPLE.COM/BILL')`).run();
  db.prepare(`INSERT INTO apple_receipts (user_id, raw_text, status, transaction_id, apple_account)
              VALUES (1,'raw','matched',400,'prvni@icloud.com'),
                     (1,'raw','matched',401,'druhy@icloud.com')`).run();

  const a = await (await fetch(`${base}/api/transactions?apple_account=prvni@icloud.com`)).json();
  const rowsA = a.transactions || a;
  assert.equal(rowsA.length, 1);
  assert.equal(rowsA[0].id, 400);

  const none = await (await fetch(`${base}/api/transactions?apple_account=none`)).json();
  const rowsNone = none.transactions || none;
  assert.equal(rowsNone.length, 1, 'jen transakce bez faktury');
  assert.equal(rowsNone[0].id, 402);
  server.close();
});

test('filtr apple_account je case-insensitive a ignoruje neparovane faktury', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (410,1,5,-269,'2026-03-01','APPLE.COM/BILL'),
                     (411,1,5,-300,'2026-03-02','APPLE.COM/BILL')`).run();
  db.prepare(`INSERT INTO apple_receipts (user_id, raw_text, status, transaction_id, apple_account)
              VALUES (1,'raw','matched',410,'prvni@icloud.com'),
                     (1,'raw','pending',411,'prvni@icloud.com')`).run();

  const r = await (await fetch(`${base}/api/transactions?apple_account=PRVNI@ICLOUD.COM`)).json();
  const rows = r.transactions || r;
  assert.equal(rows.length, 1, 'neparovana faktura se nepocita');
  assert.equal(rows[0].id, 410);

  const none = await (await fetch(`${base}/api/transactions?apple_account=none`)).json();
  assert.equal((none.transactions || none).length, 1, 'tx s pending fakturou patri do "bez faktury"');
  server.close();
});

// Faktury ulozene pred zavedenim apple_account (nebo takove, ze kterych se ucet
// nepodarilo rozpoznat) maji status='matched' ale apple_account IS NULL — ta
// hranicni podminka je duvod, proc se spec upravoval (rozpad se jinak po nasazeni
// vubec nezobrazi), takze ji musi chranit test proti regresi.
test('transakce se sparovanou fakturou bez rozpoznaneho uctu patri do apple_account=none', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (420,1,5,-269,'2026-03-01','APPLE.COM/BILL'),
                     (421,1,5,-500,'2026-03-02','APPLE.COM/BILL')`).run();
  db.prepare(`INSERT INTO apple_receipts (user_id, raw_text, status, transaction_id, apple_account)
              VALUES (1,'raw','matched',420,NULL),
                     (1,'raw','matched',421,'prvni@icloud.com')`).run();

  const none = await (await fetch(`${base}/api/transactions?apple_account=none`)).json();
  const rowsNone = none.transactions || none;
  assert.equal(rowsNone.length, 1, 'matched faktura bez uctu spada do "bez faktury"');
  assert.equal(rowsNone[0].id, 420);
  server.close();
});
