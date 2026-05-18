'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-inc-${Date.now()}-${Math.random()}.db`);
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

test('incomeSourcesForPeriod: sečte jen amount>0 z účtu role=income v období', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, role) VALUES (10, 1, 'Hlavní', 'income')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, role) VALUES (11, 1, 'Společný', 'spending')").run();
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, sort_order) VALUES (1, 'Tom', 140000, 'Tom - OSVC', 1)").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 10, 145000, '2026-04-10', 'Tom - OSVC platba')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 10, -5000, '2026-04-11', 'Tom - OSVC vratka')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 11, 9999, '2026-04-12', 'Tom - OSVC')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 10, 99999, '2026-02-01', 'Tom - OSVC')").run();

  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].person, 'Tom');
  assert.equal(rows[0].actual, 145000);
  assert.equal(rows[0].tx_count, 1);
  assert.equal(rows[0].status, 'ok');
});

test('incomeSourcesForPeriod: zdroj bez match_pattern → actual 0, status null', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, sort_order) VALUES (1, 'Martin', 20000, NULL, 2)").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows[0].actual, 0);
  assert.equal(rows[0].tx_count, 0);
  assert.equal(rows[0].status, null);
});

test('incomeSourcesForPeriod: izolace mezi uživateli – transakce user 2 nesmí uniknout do výsledku user 1', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'user1@b.cz')").run();
  db.prepare("INSERT INTO users (id, email) VALUES (2, 'user2@b.cz')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, role) VALUES (20, 1, 'User1 income', 'income')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, role) VALUES (21, 2, 'User2 income', 'income')").run();
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, sort_order) VALUES (1, 'Tom', 140000, 'Tom - OSVC', 1)").run();
  // Transakce patří user 2, account user 2 – nesmí se projevit ve výsledku user 1
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (2, 21, 145000, '2026-04-10', 'Tom - OSVC platba')").run();

  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].person, 'Tom');
  assert.equal(rows[0].actual, 0);
  assert.equal(rows[0].tx_count, 0);
});

test('incomeSourcesForPeriod: více zdrojů – sumy nejsou křížem kontaminovány, řazení dle sort_order', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, role) VALUES (30, 1, 'Příjmový účet', 'income')").run();
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, sort_order) VALUES (1, 'Tom', 140000, 'Tom - OSVC', 1)").run();
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, sort_order) VALUES (1, 'Martin', 20000, 'Bísek Libor', 2)").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 30, 145000, '2026-04-10', 'Tom - OSVC platba')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 30, 19000, '2026-04-15', 'Bísek Libor výplata')").run();

  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].person, 'Tom');
  assert.equal(rows[0].actual, 145000);
  assert.equal(rows[1].person, 'Martin');
  assert.equal(rows[1].actual, 19000);
});
