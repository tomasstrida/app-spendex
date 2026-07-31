'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const express = require('express');

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-bi-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection', '../db/schema', './budget-items']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (5,1,'Y_Licence',2)").run();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1 }; req.dataUserId = 1; req.isAuthenticated = () => true; next(); });
  app.use('/api/budget-items', require('./budget-items'));
  return { db, app };
}
async function listen(app) {
  const s = await new Promise(r => { const x = app.listen(0, () => r(x)); });
  return { server: s, base: `http://127.0.0.1:${s.address().port}` };
}

test('category_subcategory_year_spent: roční rozpad po subkategoriích v rámci roku', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const chatgpt = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'ChatGPT')").run().lastInsertRowid;
  const claude = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'Claude')").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description) VALUES (1,5,?,-300,'2026-02-03','OPENAI'),(1,5,?,-200,'2026-07-10','OPENAI'),(1,5,?,-500,'2026-05-01','CLAUDE')").run(chatgpt, chatgpt, claude);
  // tx mimo rok se nezapočítá
  db.prepare("INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description) VALUES (1,5,?,-999,'2025-12-31','OPENAI')").run(chatgpt);
  const data = await (await fetch(`${base}/api/budget-items?year=2026`)).json();
  const bySub = data.category_subcategory_year_spent;
  assert.ok(bySub, 'category_subcategory_year_spent chybí');
  const rows = bySub['5'] || bySub[5];
  assert.ok(Array.isArray(rows), 'rozpad pro kategorii 5 chybí');
  const cg = rows.find(r => r.subcategory_id === chatgpt);
  const cl = rows.find(r => r.subcategory_id === claude);
  assert.equal(cg.name, 'ChatGPT');
  assert.equal(cg.spent, 500); // 300 + 200, bez tx z 2025
  assert.equal(cl.spent, 500);
  // řazení sestupně dle spent (shodné → nezáleží), jen ať jsou obě
  assert.equal(rows.length, 2);
  server.close();
});

test('rozpad podle Apple uctu scita jen sparovane faktury rocnich kategorii', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (60,1,'Y_Licence_Apple',2)").run();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (300,1,60,-269,'2026-03-01','APPLE.COM/BILL'),
                     (301,1,60,-100,'2026-04-01','APPLE.COM/BILL'),
                     (302,1,60,-500,'2026-05-01','APPLE.COM/BILL'),
                     (303,1,60,-50,'2026-06-01','APPLE.COM/BILL')`).run();
  db.prepare(`INSERT INTO apple_receipts (user_id, raw_text, status, transaction_id, apple_account)
              VALUES (1,'raw','matched',300,'prvni@icloud.com'),
                     (1,'raw','matched',301,'prvni@icloud.com'),
                     (1,'raw','matched',302,'druhy@icloud.com'),
                     (1,'raw','pending',303,'treti@icloud.com')`).run();

  const d = await (await fetch(`${base}/api/budget-items?year=2026`)).json();
  const rows = d.category_apple_account_year_spent[60];
  assert.equal(rows.length, 2, 'jen dva ucty se sparovanou fakturou');
  // sestupne dle spent (viz interface spec i ORDER BY spent DESC v briefu)
  assert.equal(rows[0].apple_account, 'druhy@icloud.com');
  assert.equal(rows[0].spent, 500);
  assert.equal(rows[1].apple_account, 'prvni@icloud.com');
  assert.equal(rows[1].spent, 369, '269 + 100');
  server.close();
});

test('category_apple_unmatched_year_spent: Apple platby bez sparovane faktury se znamym uctem', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (63,1,'Y_Licence_Unmatched',2)").run();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (320,1,63,-269,'2026-03-01','APPLE.COM/BILL'),
                     (321,1,63,-100,'2026-04-01','APPLE.COM/BILL'),
                     (322,1,63,-500,'2026-05-01','APPLE.COM/BILL'),
                     (323,1,63,-999,'2026-06-01','ADOBE CREATIVE')`).run();
  // 320: sparovano se znamym uctem -> NEPATRI do unmatched
  // 321: sparovano, ale apple_account NULL (stary radek pred migraci) -> PATRI
  // 322: bez faktury vubec -> PATRI
  // 323: neni Apple platba (Adobe) -> nepatri, i kdyz nema fakturu
  db.prepare(`INSERT INTO apple_receipts (user_id, raw_text, status, transaction_id, apple_account)
              VALUES (1,'raw','matched',320,'prvni@icloud.com'),
                     (1,'raw','matched',321,NULL)`).run();

  const d = await (await fetch(`${base}/api/budget-items?year=2026`)).json();
  assert.equal(d.category_apple_unmatched_year_spent[63], 600, '100 (ucet neznamy) + 500 (bez faktury vubec)');
  server.close();
});

test('rozpad podle Apple uctu nezahrne mesicni kategorie ani faktury bez uctu', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (61,1,'Mesicni',1),(62,1,'Rocni',2)").run();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (310,1,61,-200,'2026-03-01','APPLE.COM/BILL'),
                     (311,1,62,-300,'2026-03-01','APPLE.COM/BILL')`).run();
  db.prepare(`INSERT INTO apple_receipts (user_id, raw_text, status, transaction_id, apple_account)
              VALUES (1,'raw','matched',310,'prvni@icloud.com'),
                     (1,'raw','matched',311,NULL)`).run();

  const d = await (await fetch(`${base}/api/budget-items?year=2026`)).json();
  assert.equal(d.category_apple_account_year_spent[61], undefined, 'mesicni kategorie tam nepatri');
  assert.equal(d.category_apple_account_year_spent[62], undefined, 'faktura bez uctu se nepocita');
  server.close();
});
