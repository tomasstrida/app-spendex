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
    (user_id, amount, currency, date, description, external_id, account_id, source)
    VALUES (@user_id,@amount,'CZK',@date,@description,@external_id,@account_id,'airbank')`).run(row);
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
  ins(db,{user_id:1,amount:-200,date:'2026-04-05',description:'Kafe',external_id:'a',account_id:10});
  ins(db,{user_id:1,amount:-200,date:'2026-04-05',description:'Kafe',external_id:'b',account_id:10});
  ins(db,{user_id:1,amount:-201,date:'2026-04-05',description:'Kafe',external_id:'c',account_id:10});

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
  ins(db,{user_id:1,amount:-9,date:'2026-04-01',description:'Dup',external_id:'p',account_id:10});
  ins(db,{user_id:1,amount:-9,date:'2026-04-01',description:'Dup',external_id:'q',account_id:10});
  ins(db,{user_id:1,amount:-3,date:'2026-04-02',description:'Solo',external_id:'r',account_id:10});
  const { wouldEmptyDuplicateGroup } = require('./duplicates');
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [1, 2]), true);
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [1]), false);
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [3]), false);
  cleanup(db, tmp);
});
