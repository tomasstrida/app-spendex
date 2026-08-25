'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-budgets-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./budgets']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (5,1,'Sport',1)").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type, system_role) VALUES (7,1,'Nákup předplacených balíčků',4,'prepaid_purchase')").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type, system_role) VALUES (8,1,'Mimořádné příjmy',4,'extra_income')").run();
  db.prepare("INSERT INTO budgets (user_id, category_id, month, amount) VALUES (1,5,'default',2000)").run();
  db.prepare(`
    INSERT INTO prepaid_packages (id, user_id, category_id, name, total_amount, units_total, unit_amount)
    VALUES (1, 1, 5, 'Fitness 10x', 5000, 10, 500)
  `).run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/budgets', require('./budgets'));
  return { db, app };
}

test('budget_spent scita transakce i cerpani balicku v obdobi', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-300,'2026-04-05','Cokoliv')").run();
  db.prepare("INSERT INTO prepaid_draws (user_id, package_id, date, units, amount) VALUES (1,1,'2026-04-10',1,500)").run();
  const { budgets } = await (await fetch(`${base}/api/budgets?period=2026-04`)).json();
  const row = budgets.find(b => b.category_id === 5);
  assert.equal(row.spent, 300, 'spent zustava cistě transakcni');
  assert.equal(row.prepaid_spent, 500);
  assert.equal(row.budget_spent, 800);
  server.close();
});

test('cerpani mimo obdobi se nepocita', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO prepaid_draws (user_id, package_id, date, units, amount) VALUES (1,1,'2026-03-30',1,500)").run();
  const { budgets } = await (await fetch(`${base}/api/budgets?period=2026-04`)).json();
  const row = budgets.find(b => b.category_id === 5);
  assert.equal(row.prepaid_spent, 0);
  assert.equal(row.budget_spent, 0);
  server.close();
});

test('nakup balicku v technicke kategorii nezvysi zadny mesicni budget', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,7,-5000,'2026-04-04','Fitness 10x')").run();
  const { budgets } = await (await fetch(`${base}/api/budgets?period=2026-04`)).json();
  const row = budgets.find(b => b.category_id === 5);
  assert.equal(row.spent, 0);
  assert.equal(row.budget_spent, 0);
  server.close();
});

test('bez cerpani je budget_spent rovno spent', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-450,'2026-04-05','Cokoliv')").run();
  const { budgets } = await (await fetch(`${base}/api/budgets?period=2026-04`)).json();
  const row = budgets.find(b => b.category_id === 5);
  assert.equal(row.prepaid_spent, 0);
  assert.equal(row.budget_spent, row.spent);
  server.close();
});

test('PUT na systemovou kategorii vraci 400 a nezalozi budget', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/budgets`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category_id: 8, period: '2026-04', amount: 1000, scope: 'all' }),
  });
  assert.equal(res.status, 400);
  const row = db.prepare("SELECT * FROM budgets WHERE category_id = 8").get();
  assert.equal(row, undefined, 'systemova kategorie nesmi mit radek v budgets');
  server.close();
});
