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
