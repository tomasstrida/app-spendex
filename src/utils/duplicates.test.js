'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-dup-${Date.now()}-${Math.random()}.db`);
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
function ins(db, row) {
  db.prepare(`INSERT INTO transactions
    (user_id, amount, currency, date, description, external_id, account_id, source, tx_time, note)
    VALUES (@user_id,@amount,'CZK',@date,@description,@external_id,@account_id,'airbank',@tx_time,@note)`)
    .run({ tx_time: null, note: null, ...row });
}

test('probable: stejný rawRef + stejný účet (2×) → skupina; různé účty (interní převod) → NE', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'Hlavní')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (11,1,'Společný')").run();
  ins(db,{user_id:1,amount:-100,date:'2026-04-01',description:'X',external_id:'999-1679014138',account_id:10});
  ins(db,{user_id:1,amount:-100,date:'2026-04-01',description:'X',external_id:'999',account_id:10});
  ins(db,{user_id:1,amount:-50,date:'2026-04-02',description:'Převod',external_id:'777-acc10',account_id:10});
  ins(db,{user_id:1,amount:50,date:'2026-04-02',description:'Převod',external_id:'777-acc11',account_id:11});

  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);

  assert.equal(r.probable.length, 1);
  assert.equal(r.probable[0].rows.length, 2);
  const ids = r.probable[0].rows.map(x => x.external_id).sort();
  assert.deepEqual(ids, ['999', '999-1679014138']);
});

test('possible: stejné date+description+amount+account (2×) → skupina; jiná částka → NE', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'Hlavní')").run();
  ins(db,{user_id:1,amount:-200,date:'2026-04-05',description:'Kafe',external_id:'a',account_id:10,tx_time:'2026-04-05 08:00:00'});
  ins(db,{user_id:1,amount:-200,date:'2026-04-05',description:'Kafe',external_id:'b',account_id:10,tx_time:'2026-04-05 08:00:00'});
  ins(db,{user_id:1,amount:-201,date:'2026-04-05',description:'Kafe',external_id:'c',account_id:10,tx_time:'2026-04-05 08:00:00'});

  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);

  assert.equal(r.possible.length, 1);
  assert.equal(r.possible[0].rows.length, 2);
  assert.equal(r.possible[0].rows.every(x => x.amount === -200), true);
});

test('izolace per user: cizí uživatel se nemíchá', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO users (id, email) VALUES (2,'c@d.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (20,2,'H')").run();
  ins(db,{user_id:1,amount:-1,date:'2026-04-01',description:'X',external_id:'5-10',account_id:10});
  ins(db,{user_id:2,amount:-1,date:'2026-04-01',description:'X',external_id:'5-20',account_id:20});
  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);
  assert.equal(r.probable.length, 0);
  assert.equal(r.possible.length, 0);
});

test('wouldEmptyDuplicateGroup: celá 2členná skupina v ids → true; 1 ze 2 → false; samostatný → false', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  ins(db,{user_id:1,amount:-9,date:'2026-04-01',description:'Dup',external_id:'p',account_id:10,tx_time:'2026-04-01 07:00:00'});
  ins(db,{user_id:1,amount:-9,date:'2026-04-01',description:'Dup',external_id:'q',account_id:10,tx_time:'2026-04-01 07:00:00'});
  ins(db,{user_id:1,amount:-3,date:'2026-04-02',description:'Solo',external_id:'r',account_id:10});
  const { wouldEmptyDuplicateGroup } = require('./duplicates');
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [1, 2]), true);
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [1]), false);
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [3]), false);
  cleanup(db, tmp);
});

test('rawRef: null/prázdné → null; bez pomlčky → celé; s pomlčkou → před poslední; vedoucí pomlčka → celé', () => {
  const { rawRef } = require('./duplicates');
  assert.equal(rawRef(null), null);
  assert.equal(rawRef(undefined), null);
  assert.equal(rawRef(''), null);
  assert.equal(rawRef('999'), '999');
  assert.equal(rawRef('156868134552-1679014138'), '156868134552');
  assert.equal(rawRef('-abc'), '-abc'); // lastIndexOf('-')===0 → guard i>0 → celé
});

test('skupina 3 kopií (re-import disaster): probable i possible mají 3 řádky', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  ins(db,{user_id:1,amount:-600,date:'2026-02-22',description:'Nepravidelné',external_id:'r1-10',account_id:10,tx_time:'2026-02-22 09:00:00'});
  ins(db,{user_id:1,amount:-600,date:'2026-02-22',description:'Nepravidelné',external_id:'r1',account_id:10,tx_time:'2026-02-22 09:00:00'});
  ins(db,{user_id:1,amount:-600,date:'2026-02-22',description:'Nepravidelné',external_id:'r1-10-x',account_id:10,tx_time:'2026-02-22 09:00:00'});
  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);
  // rawRef: 'r1-10'→'r1-10'?, pozn.: lastIndexOf('-') na 'r1-10' = index 2 → 'r1'; 'r1'→'r1'; 'r1-10-x'→'r1-10'
  // possible (date+desc+amount+account) musí mít 1 skupinu se 3 řádky
  assert.equal(r.possible.length, 1);
  assert.equal(r.possible[0].rows.length, 3);
});

test('wouldEmptyDuplicateGroup: skupina 3 — všechny 3 v ids → true; 2 ze 3 → false', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  ins(db,{user_id:1,amount:-7,date:'2026-03-01',description:'Trip',external_id:'a',account_id:10,tx_time:'2026-03-01 06:00:00'}); // id 1
  ins(db,{user_id:1,amount:-7,date:'2026-03-01',description:'Trip',external_id:'b',account_id:10,tx_time:'2026-03-01 06:00:00'}); // id 2
  ins(db,{user_id:1,amount:-7,date:'2026-03-01',description:'Trip',external_id:'c',account_id:10,tx_time:'2026-03-01 06:00:00'}); // id 3
  const { wouldEmptyDuplicateGroup } = require('./duplicates');
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [1, 2, 3]), true);
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [1, 2]), false);
  cleanup(db, tmp);
});

test('řádky duplicit mají ref (rawRef z external_id) a tx_time', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  db.prepare(`INSERT INTO transactions
    (user_id, amount, currency, date, description, external_id, account_id, source, tx_time, note)
    VALUES (1,-100,'CZK','2026-04-01','X','12345-1679014138',10,'airbank','01/04/2026 10:11:12','pozn A')`).run();
  db.prepare(`INSERT INTO transactions
    (user_id, amount, currency, date, description, external_id, account_id, source, tx_time, note)
    VALUES (1,-100,'CZK','2026-04-01','X','12345',10,'airbank','01/04/2026 10:11:12','pozn B')`).run();

  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);

  assert.equal(r.possible.length, 1);
  const rows = r.possible[0].rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(x => x.ref).sort(), ['12345', '12345']);
  assert.equal(rows.every(x => x.tx_time === '01/04/2026 10:11:12'), true);
  assert.deepEqual(rows.map(x => x.note).sort(), ['pozn A', 'pozn B']);
});

test('Možné: různý tx_time → NENÍ duplicita', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  ins(db,{user_id:1,amount:-50,date:'2026-05-01',description:'Oběd',external_id:'x1',account_id:10,tx_time:'2026-05-01 11:00:00'});
  ins(db,{user_id:1,amount:-50,date:'2026-05-01',description:'Oběd',external_id:'x2',account_id:10,tx_time:'2026-05-01 18:30:00'});
  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);
  assert.equal(r.possible.length, 0);
});

test('Možné: oba tx_time NULL → NENÍ duplicita (NULL = unikát)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  ins(db,{user_id:1,amount:-50,date:'2026-05-01',description:'Oběd',external_id:'y1',account_id:10});
  ins(db,{user_id:1,amount:-50,date:'2026-05-01',description:'Oběd',external_id:'y2',account_id:10});
  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);
  assert.equal(r.possible.length, 0);
});

test('note se propaguje do řádků (possible)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  ins(db,{user_id:1,amount:-12,date:'2026-05-02',description:'Z',external_id:'n1',account_id:10,tx_time:'2026-05-02 09:00:00',note:'pozn 1'});
  ins(db,{user_id:1,amount:-12,date:'2026-05-02',description:'Z',external_id:'n2',account_id:10,tx_time:'2026-05-02 09:00:00',note:'pozn 2'});
  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);
  assert.equal(r.possible.length, 1);
  assert.deepEqual(r.possible[0].rows.map(x => x.note).sort(), ['pozn 1', 'pozn 2']);
});

test('wouldEmptyDuplicateGroup: NULL-tx_time pár není chráněná skupina → false', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  ins(db,{user_id:1,amount:-5,date:'2026-05-03',description:'NoTime',external_id:'z1',account_id:10});
  ins(db,{user_id:1,amount:-5,date:'2026-05-03',description:'NoTime',external_id:'z2',account_id:10});
  ins(db,{user_id:1,amount:-5,date:'2026-05-04',description:'Timed',external_id:'z3',account_id:10,tx_time:'2026-05-04 10:00:00'});
  ins(db,{user_id:1,amount:-5,date:'2026-05-04',description:'Timed',external_id:'z4',account_id:10,tx_time:'2026-05-04 10:00:00'});
  const { wouldEmptyDuplicateGroup } = require('./duplicates');
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [1, 2]), false);
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [3, 4]), true);
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [3]), false);
  cleanup(db, tmp);
});

test('Možné: jeden tx_time NULL + druhý vyplněný (jinak shodné) → NENÍ duplicita', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  ins(db,{user_id:1,amount:-33,date:'2026-05-05',description:'Mix',external_id:'m1',account_id:10,tx_time:'2026-05-05 12:00:00'});
  ins(db,{user_id:1,amount:-33,date:'2026-05-05',description:'Mix',external_id:'m2',account_id:10}); // tx_time NULL
  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);
  assert.equal(r.possible.length, 0);
});
