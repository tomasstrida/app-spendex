'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-einbox-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('./connection')];
  delete require.cache[require.resolve('./schema')];
  const db = require('./connection');
  require('./schema').initSchema();
  return { db, tmp };
}

test('email_inbox tabulka existuje a má očekávané sloupce', () => {
  const { db, tmp } = freshDb();
  const cols = db.prepare("PRAGMA table_info(email_inbox)").all().map(c => c.name);
  db.close();
  try { fs.unlinkSync(tmp); } catch { /* ok */ }
  for (const c of ['id', 'user_id', 'received_at', 'raw_text', 'parsed_json',
                   'external_id', 'suggested_category_id', 'status', 'created_at']) {
    assert.ok(cols.includes(c), `chybí sloupec ${c}`);
  }
});
