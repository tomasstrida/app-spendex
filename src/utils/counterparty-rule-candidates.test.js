'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-crc-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection', '../db/schema']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return db;
}

function seedBase(db) {
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (10, 1, 'Y_Uctovani'), (11, 1, 'Ostatni')").run();
  db.prepare("INSERT INTO accounts (id, user_id, account_number, name) VALUES (1, 1, '1679014031/3030', 'Tom-OSVC')").run();
}

test('najde kandidáta s coverage>=3 a purity>=90%', () => {
  const db = seedAndReturn();
  function seedAndReturn() { const d = freshDb(); seedBase(d); return d; }
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
                VALUES (1, 10, -5000, '2026-0${i + 1}-15', 'DPH', '705-77628031/0710')`).run();
  }
  const out = findCounterpartyRuleCandidates(db, 1);
  assert.equal(out.length, 1);
  assert.equal(out[0].counterparty_account, '705-77628031/0710');
  assert.equal(out[0].category_id, 10);
  assert.equal(out[0].coverage_count, 3);
  assert.equal(out[0].purity, 1);
});

test('coverage < 3 se nenabízí', () => {
  const db = freshDb(); seedBase(db);
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  for (let i = 0; i < 2; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
                VALUES (1, 10, -5000, '2026-0${i + 1}-15', 'DPH', '705-77628031/0710')`).run();
  }
  assert.equal(findCounterpartyRuleCandidates(db, 1).length, 0);
});

test('purity < 90% (nekonzistentní kategorizace) se nenabízí — zz-Hromadné akce scénář', () => {
  const db = freshDb(); seedBase(db);
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
              VALUES (1, 10, -100, '2026-01-01', 'A', 'ZZ/0100'), (1, 10, -100, '2026-02-01', 'B', 'ZZ/0100'),
                     (1, 11, -100, '2026-03-01', 'C', 'ZZ/0100')`).run();
  assert.equal(findCounterpartyRuleCandidates(db, 1).length, 0); // purity 2/3 = 66% < 90%
});

test('vlastní účet (L0 převod) se vynechá', () => {
  const db = freshDb(); seedBase(db);
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
                VALUES (1, 10, -100, '2026-0${i + 1}-01', 'X', '1679014031/3030')`).run();
  }
  assert.equal(findCounterpartyRuleCandidates(db, 1).length, 0);
});

test('protiúčet s existujícím pravidlem se vynechá', () => {
  const db = freshDb(); seedBase(db);
  db.prepare(`INSERT INTO category_rules (user_id, category_id, pattern, match_counterparty_account)
              VALUES (1, 10, '', '705-77628031/0710')`).run();
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
                VALUES (1, 10, -100, '2026-0${i + 1}-01', 'DPH', '705-77628031/0710')`).run();
  }
  assert.equal(findCounterpartyRuleCandidates(db, 1).length, 0);
});

test('protiúčet s dismissed návrhem se nenabízí znovu', () => {
  const db = freshDb(); seedBase(db);
  db.prepare(`INSERT INTO rule_suggestions (user_id, counterparty_account, category_id, coverage_count, purity, status)
              VALUES (1, '705-77628031/0710', 10, 3, 1.0, 'dismissed')`).run();
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
                VALUES (1, 10, -100, '2026-0${i + 1}-01', 'DPH', '705-77628031/0710')`).run();
  }
  assert.equal(findCounterpartyRuleCandidates(db, 1).length, 0);
});

test('onlyCounterpartyAccount omezí scan na jeden protiúčet', () => {
  const db = freshDb(); seedBase(db);
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
                VALUES (1, 10, -100, '2026-0${i + 1}-01', 'A', 'AAA/0100'), (1, 10, -100, '2026-0${i + 1}-02', 'B', 'BBB/0100')`).run();
  }
  const out = findCounterpartyRuleCandidates(db, 1, { onlyCounterpartyAccount: 'AAA/0100' });
  assert.equal(out.length, 1);
  assert.equal(out[0].counterparty_account, 'AAA/0100');
});

test('dominantní subcategory_id se dopočítá z transakcí v topCat', () => {
  const db = freshDb(); seedBase(db);
  db.prepare("INSERT INTO subcategories (id, user_id, category_id, name) VALUES (1, 1, 10, 'Sub A')").run();
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description, counterparty_account)
                VALUES (1, 10, 1, -100, '2026-0${i + 1}-01', 'DPH', '705-77628031/0710')`).run();
  }
  const out = findCounterpartyRuleCandidates(db, 1);
  assert.equal(out[0].subcategory_id, 1);
});
