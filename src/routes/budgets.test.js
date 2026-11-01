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

// ── valid_to: ukončení měsíčního budgetu od období ───────────────────────────
const postJson = (base, p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const putJson = (base, p, body) => fetch(`${base}${p}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ids = async (base, period) => (await (await fetch(`${base}/api/budgets?period=${period}`)).json()).budgets.map(b => b.category_id);

test('POST /end: budget platí do předchozího období, od zadaného zmizí; historie zůstává', async () => {
  const { app, db } = setup(); const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-100,'2026-07-10','x')").run();
  const r = await postJson(base, '/api/budgets/end', { category_id: 5, period: '2026-08' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).valid_to, '2026-07');
  assert.deepEqual(await ids(base, '2026-07'), [5]);   // poslední platné období
  assert.deepEqual(await ids(base, '2026-08'), []);
  assert.deepEqual(await ids(base, '2027-01'), []);
  assert.deepEqual(await ids(base, '2026-03'), [5]);   // historie nedotčena
  server.close();
});

test('POST /end přes přelom roku (2027-01 → valid_to 2026-12) a smaže přepsání od období', async () => {
  const { app, db } = setup(); const { server, base } = await listen(app);
  db.prepare("INSERT INTO budgets (user_id, category_id, month, amount) VALUES (1,5,'2026-11',900)").run();
  db.prepare("INSERT INTO budgets (user_id, category_id, month, amount) VALUES (1,5,'2027-02',900)").run();
  const r = await postJson(base, '/api/budgets/end', { category_id: 5, period: '2027-01' });
  assert.equal((await r.json()).valid_to, '2026-12');
  const months = db.prepare("SELECT month FROM budgets WHERE category_id = 5 AND month != 'default'").all().map(x => x.month);
  assert.deepEqual(months, ['2026-11']);   // přepsání před hranicí zůstává
  server.close();
});

test('POST /end: validace a vlastnictví', async () => {
  const { app } = setup(); const { server, base } = await listen(app);
  assert.equal((await postJson(base, '/api/budgets/end', { category_id: 5, period: '2026-13' })).status, 400);
  assert.equal((await postJson(base, '/api/budgets/end', { period: '2026-08' })).status, 400);
  assert.equal((await postJson(base, '/api/budgets/end', { category_id: 999, period: '2026-08' })).status, 404);
  assert.equal((await postJson(base, '/api/budgets/end', { category_id: 7, period: '2026-08' })).status, 404); // bez budgetu
  server.close();
});

test('PUT v období po ukončení budget oživí; úprava v platném období ne', async () => {
  const { app, db } = setup(); const { server, base } = await listen(app);
  await postJson(base, '/api/budgets/end', { category_id: 5, period: '2026-08' });
  await putJson(base, '/api/budgets', { category_id: 5, period: '2026-05', amount: 2500, scope: 'all' });
  assert.equal(db.prepare("SELECT valid_to FROM budgets WHERE category_id = 5 AND month = 'default'").get().valid_to, '2026-07');
  await putJson(base, '/api/budgets', { category_id: 5, period: '2026-09', amount: 2500, scope: 'all' });
  assert.equal(db.prepare("SELECT valid_to FROM budgets WHERE category_id = 5 AND month = 'default'").get().valid_to, null);
  assert.deepEqual(await ids(base, '2026-09'), [5]);
  server.close();
});
