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

test('fixedExpensesForPeriod: vrací JEN definované platby — žádné auto account-řádky z účtů role=fixed', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, role) VALUES (20, 1, 'Harmonicka-najem', 'fixed')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, sort_order, match_pattern) VALUES (1, 'Nájem Stodůlky', 38126, 37000, 39000, 1, 'JANA HRDLIČKOVÁ')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 20, -38126, '2026-04-05', 'JANA HRDLIČKOVÁ')").run();
  // odchozí tx z fixed účtu, kterou žádná definice nepokrývá — dřív by vznikl account-řádek
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 20, -1234, '2026-04-06', 'Něco jiného')").run();

  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);

  assert.equal(rows.filter(r => r.source === 'account').length, 0);
  assert.equal(rows.length, 1);
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

test('fixedExpensesForPeriod: měsíční (freq 1) status podle rozmezí', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, frequency_months, match_pattern) VALUES (1,'Nájem',38000,36000,40000,1,'HRDLIČKOVÁ')").run();
  db.prepare("INSERT INTO transactions (user_id, amount, date, description) VALUES (1,-38000,'2026-04-05','JANA HRDLIČKOVÁ')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  const m = rows.find(r => r.source === 'manual');
  assert.equal(m.actual, 38000);
  assert.equal(m.status, 'ok');
});

test('fixedExpensesForPeriod: kvartální (freq 3) najde platbu z −2 období → ok', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, frequency_months, match_pattern) VALUES (1,'Pojistka',3000,2900,3100,3,'POJISTKA')").run();
  // platba ve únoru, sledované období duben (freq 3 → okno únor–duben)
  db.prepare("INSERT INTO transactions (user_id, amount, date, description) VALUES (1,-3000,'2026-02-10','POJISTKA AUTO')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  const m = rows.find(r => r.source === 'manual');
  assert.equal(m.status, 'ok');
});

test('fixedExpensesForPeriod: kvartální bez platby v okně → missing', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, frequency_months, match_pattern) VALUES (1,'Pojistka',3000,2900,3100,3,'POJISTKA')").run();
  db.prepare("INSERT INTO transactions (user_id, amount, date, description) VALUES (1,-3000,'2025-11-10','POJISTKA AUTO')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  const m = rows.find(r => r.source === 'manual');
  assert.equal(m.status, 'missing');
});

test('fixedExpensesForPeriod: párování přes counterparty_account (priorita nad patternem)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, frequency_months, match_pattern, match_counterparty_account) VALUES (1,'Splátka RAV4',13255,13000,13500,1,'NESEDÍCÍ TEXT','1679014999/0300')").run();
  // popis pattern NEmatchne, ale číslo účtu ano → platba se najde přes účet
  db.prepare("INSERT INTO transactions (user_id, amount, date, description, counterparty_account) VALUES (1,-13255,'2026-04-10','Toyota Financial','1679014999/0300')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  const m = rows.find(r => r.source === 'manual');
  assert.equal(m.actual, 13255);
  assert.equal(m.tx_count, 1);
  assert.equal(m.status, 'ok');
});

test('fixedExpensesForPeriod: platba přes counterparty nepřišla → missing, actual 0', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, frequency_months, match_counterparty_account) VALUES (1,'Splátka',5000,4900,5100,1,'1679014999')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  const m = rows.find(r => r.source === 'manual');
  assert.equal(m.tx_count, 0);
  assert.equal(m.actual, 0);
  assert.equal(m.status, 'missing');
});

test('fixedExpensesForPeriod: account-řádek se nezdvojí s ruční platbou přes číslo účtu', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, role) VALUES (20, 1, 'Harmonicka-najem', 'fixed')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, match_counterparty_account) VALUES (1,'Nájem',38126,37000,39000,'1679014777/0300')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1,20,-38126,'2026-04-05','Platba nájem','1679014777/0300')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  // stejná transakce nesmí být zároveň account-řádek
  assert.equal(rows.filter(r => r.source === 'account').length, 0);
  const m = rows.find(r => r.source === 'manual');
  assert.equal(m.actual, 38126);
});

test('fixedExpensesForPeriod: counterparty match je exact na číslo (ne prefix) — delší číslo se stejným začátkem NEmatchne', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, match_counterparty_account) VALUES (1,'Splátka',5000,4900,5100,'1679014074/0300')").run();
  // jiný účet, jehož číslo jen začíná stejně (raw prefix LIKE by ho chybně chytil)
  db.prepare("INSERT INTO transactions (user_id, amount, date, description, counterparty_account) VALUES (1,-5000,'2026-04-10','Cizí','16790140749/0300')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  const m = rows.find(r => r.source === 'manual');
  assert.equal(m.tx_count, 0);
  assert.equal(m.actual, 0);
  assert.equal(m.status, 'missing');
});

test('fixedExpensesForPeriod: účty s předčíslím 51-… si vzájemně nematchují platby (Buřinka 1 vs Buřinka 2 vs nájem)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, match_counterparty_account) VALUES (1,'Úvěr Buřinka 1',4487,4487,4487,'51-1065424327/8060')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, match_counterparty_account) VALUES (1,'Úvěr Buřinka 2',1868,1868,1868,'51-2019053005/8060')").run();
  db.prepare("INSERT INTO transactions (user_id, amount, date, description, counterparty_account) VALUES (1,-4487,'2026-07-05','Splátka Buřinka 1','51-1065424327/8060')").run();
  db.prepare("INSERT INTO transactions (user_id, amount, date, description, counterparty_account) VALUES (1,-1868,'2026-07-06','Splátka Buřinka 2','51-2019053005/8060')").run();
  // třetí platba na jiný účet se stejným předčíslím (nájem) — nesmí matchnout ani jednomu úvěru
  db.prepare("INSERT INTO transactions (user_id, amount, date, description, counterparty_account) VALUES (1,-38126,'2026-07-01','Najem a sluzby','51-1686550297/0100')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-07');
  cleanup(db, tmp);
  const b1 = rows.find(r => r.name === 'Úvěr Buřinka 1');
  assert.equal(b1.tx_count, 1);
  assert.equal(b1.actual, 4487);
  assert.equal(b1.status, 'ok');
  const b2 = rows.find(r => r.name === 'Úvěr Buřinka 2');
  assert.equal(b2.tx_count, 1);
  assert.equal(b2.actual, 1868);
  assert.equal(b2.status, 'ok');
});

test('fixedExpensesForPeriod: identita účtu je KOMPLETNÍ číslo — matcher bez kódu banky NEmatchne tx s kódem', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  // legacy matcher bez kódu banky — po zavedení kompletních čísel už nematchuje
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, match_counterparty_account) VALUES (1,'PRE-legacy',3500,3400,3600,'1679014066')").run();
  // kompletní matcher matchuje (mezery v tx čísle se ořežou)
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, match_counterparty_account) VALUES (1,'PRE',3500,3400,3600,'1679014066/2010')").run();
  db.prepare("INSERT INTO transactions (user_id, amount, date, description, counterparty_account) VALUES (1,-3500,'2026-04-08','Energie',' 1679014066/2010 ')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  const legacy = rows.find(r => r.name === 'PRE-legacy');
  assert.equal(legacy.tx_count, 0);
  assert.equal(legacy.status, 'missing');
  const full = rows.find(r => r.name === 'PRE');
  assert.equal(full.actual, 3500);
  assert.equal(full.status, 'ok');
});

test('fixedExpensesForPeriod: řádek s valid_to v minulosti se v novějším období nevrací, ve starším ano', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, match_pattern, valid_to) VALUES (1,'NORDIC internet',500,450,550,'NORDIC','2026-07')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const inAugust = fixedExpensesForPeriod(db, 1, '2026-08');
  const inJuly = fixedExpensesForPeriod(db, 1, '2026-07');
  const inMay = fixedExpensesForPeriod(db, 1, '2026-05');
  cleanup(db, tmp);
  assert.equal(inAugust.filter(r => r.source === 'manual').length, 0);
  assert.equal(inJuly.filter(r => r.source === 'manual').length, 1);   // valid_to je včetně
  assert.equal(inMay.filter(r => r.source === 'manual').length, 1);
});

test('fixedExpensesForPeriod: řádek s valid_from v budoucnu se v dřívějším období nevrací', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, match_pattern, valid_from) VALUES (1,'T-Mobile internet',600,550,650,'T-MOBILE','2026-08')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const inJuly = fixedExpensesForPeriod(db, 1, '2026-07');
  const inAugust = fixedExpensesForPeriod(db, 1, '2026-08');
  cleanup(db, tmp);
  assert.equal(inJuly.filter(r => r.source === 'manual').length, 0);
  assert.equal(inAugust.filter(r => r.source === 'manual').length, 1); // valid_from je včetně
});

test('fixedExpensesForPeriod: NULL/NULL okno = platí ve všech obdobích (beze změny chování)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, match_pattern) VALUES (1,'Nájem',38000,36000,40000,'NÁJEM')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  assert.equal(rows.filter(r => r.source === 'manual').length, 1);
});

test('fixedExpensesForPeriod: bez period vrací i ukončené řádky (editační seznam)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, match_pattern, valid_to) VALUES (1,'NORDIC internet',500,'NORDIC','2020-01')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, undefined);
  cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].valid_to, '2020-01');
});

test('fixedExpensesForPeriod: ukončený řádek se nevrací a nevzniká z jeho transakcí žádný jiný řádek', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, role) VALUES (20, 1, 'Fixní účet', 'fixed')").run();
  // ukončený řádek (valid_to 2026-03); transakce z dubna už nikam nepatří
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, match_pattern, valid_to) VALUES (1,'NORDIC internet',500,'NORDIC','2026-03')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 20, -500, '2026-04-05', 'NORDIC TELECOM')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  assert.equal(rows.length, 0);
});
