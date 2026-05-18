'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-fx-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
}

test('fixedExpensesForPeriod: transakce pokrytá ručním match_pattern se NEobjeví jako account-řádek', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, role) VALUES (20, 1, 'Harmonicka-najem', 'fixed')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, sort_order, match_pattern) VALUES (1, 'Nájem Stodůlky', 38126, 1, 'JANA HRDLIČKOVÁ')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 20, -38126, '2026-04-05', 'JANA HRDLIČKOVÁ')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 20, -1234, '2026-04-06', 'Něco jiného')").run();

  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);

  const accountRows = rows.filter(r => r.source === 'account');
  assert.equal(accountRows.length, 1);
  assert.equal(accountRows[0].name, 'Něco jiného');
  const manual = rows.find(r => r.source === 'manual');
  assert.equal(manual.name, 'Nájem Stodůlky');
  assert.equal(manual.actual, 38126);
  assert.equal(manual.status, 'ok');
});

test('fixedExpensesForPeriod: bez period vrátí jen manuální položky', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, sort_order, match_pattern) VALUES (1, 'Telefon', 590, 1, NULL)").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, undefined);
  cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'manual');
});
