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
  delete require.cache[require.resolve('./income')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  try { fs.unlinkSync(tmp); } catch { /* ok */ }
  try { fs.unlinkSync(tmp + '-wal'); } catch { /* ok */ }
  try { fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
}
function seedUser(db) {
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
}

test('auto: incoming z externího protiúčtu (nepatří uživateli) → příjem', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 10, 21000, '2026-04-10', 'Nájem byt', '9876543210')").run();

  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, null);
  assert.equal(rows[0].actual, 21000);
  assert.equal(rows[0].person, '9876543210');
});

test('auto: incoming z vlastního spending účtu (interní transfer) → NENÍ příjem', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (11, 1, 'Společný', '1679014023', 'spending')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 10, 5000, '2026-04-10', 'Transfer', '1679014023')").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 0);
});

test('auto: incoming z vlastního ignored účtu (Spořicí) → NENÍ příjem', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (12, 1, 'Spořicí', '1679014082', 'ignored')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 10, 3000, '2026-04-10', 'Z spořáku', '1679014082')").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 0);
});

test('auto: incoming z vlastního income účtu (OSVČ) → příjem', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (13, 1, 'OSVC', '1679014031', 'income')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 10, 162000, '2026-04-05', 'Tom strida', '1679014031')").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actual, 162000);
  assert.equal(rows[0].id, null);
  assert.equal(rows[0].person, '1679014031');
});

test('alias: income_source s match_counterparty_account → přejmenuje a dá status', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (13, 1, 'OSVC', '1679014031', 'income')").run();
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, match_counterparty_account, sort_order) VALUES (1, 'Tom', 162000, NULL, '1679014031', 1)").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 10, 162000, '2026-04-05', 'Tom strida', '1679014031')").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[0].person, 'Tom');
  assert.equal(rows[0].planned_amount, 162000);
  assert.equal(rows[0].actual, 162000);
  assert.equal(rows[0].status, 'ok');
});

test('alias: match_pattern (legacy) – matchne podle description', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, sort_order) VALUES (1, 'Martin', 20000, 'Bisek', 2)").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 10, 19500, '2026-04-15', 'Bisek vyplata', '5555555555')").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[0].person, 'Martin');
  assert.equal(rows[0].actual, 19500);
});

test('alias: ruční zdroj bez auto-shody → actual 0, status missing', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, sort_order) VALUES (1, 'Sudo', 21000, 'Sudo', 3)").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[0].actual, 0);
  assert.equal(rows[0].status, 'missing');
});

test('izolace mezi uživateli', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'u1@b.cz')").run();
  db.prepare("INSERT INTO users (id, email) VALUES (2, 'u2@b.cz')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (20, 2, 'U2H', '2222222222', 'ignored')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (2, 20, 99999, '2026-04-10', 'foreign', '9876543210')").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 0);
});

test('alias s account_id matchne JEN tx na daný účet (OSVČ→Hlavní, ne OSVČ→Spořicí)', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (11, 1, 'Spořicí', '1679014082', 'ignored')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (12, 1, 'OSVC', '1679014031', 'income')").run();
  // 2 incoming from OSVC: one to Hlavní (162k), one to Spořicí (50k).
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 10, 162000, '2026-04-05', 'Tom - OSVC', '1679014031')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 11, 50000, '2026-04-06', 'Tom - OSVC', '1679014031')").run();
  // Alias s constraintem na cílový účet Hlavní (id=10).
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, match_counterparty_account, account_id, sort_order) VALUES (1, 'Tom', 162000, NULL, '1679014031', 10, 1)").run();

  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  // 2 řádky: aliased Tom (jen 162k z Hlavního) + auto-only pro Spořicí (50k).
  const aliasRow = rows.find(r => r.person === 'Tom');
  const autoSpor = rows.find(r => r.id == null && r.account_id === 11);
  assert.ok(aliasRow, 'alias Tom musí existovat');
  assert.equal(aliasRow.actual, 162000);
  assert.equal(aliasRow.tx_count, 1);
  assert.equal(aliasRow.status, 'ok');
  assert.ok(autoSpor, 'OSVČ→Spořicí musí být auto-only (neaplikovaný alias)');
  assert.equal(autoSpor.actual, 50000);
});

test('alias bez account_id (null) matchne libovolnou destinaci — backward compat', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (11, 1, 'OSVC', '1679014031', 'income')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 10, 100000, '2026-04-05', 'Tom', '1679014031')").run();
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_counterparty_account, sort_order) VALUES (1, 'Tom', 100000, '1679014031', 1)").run();

  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  // 1 řádek: aliased Tom, account_id alias je null, takže matchne.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].person, 'Tom');
  assert.equal(rows[0].actual, 100000);
});

test('normCounterparty: kompletní číslo účtu = předčíslí + číslo + kód banky, ořezávají se jen mezery', () => {
  const { normCounterparty } = require('./income');
  // kompletní číslo se zachová celé
  assert.equal(normCounterparty('1679014999/0300'), '1679014999/0300');
  assert.equal(normCounterparty(' 1679014999/0300 '), '1679014999/0300');
  assert.equal(normCounterparty('51-1065424327/8060'), '51-1065424327/8060');
  assert.equal(normCounterparty('19-2235210247/0800'), '19-2235210247/0800');
  // účty lišící se předčíslím nebo kódem banky nesplývají
  assert.notEqual(normCounterparty('51-1065424327/8060'), normCounterparty('51-2019053005/8060'));
  assert.notEqual(normCounterparty('1679014066/3030'), normCounterparty('1679014066/2010'));
  // číslo bez kódu banky zůstane bez kódu (a exact match ho pak nespáruje s plným)
  assert.equal(normCounterparty('1679014999'), '1679014999');
  // nečíselný vstup
  assert.equal(normCounterparty('ABC'), null);
  assert.equal(normCounterparty(null), null);
});
