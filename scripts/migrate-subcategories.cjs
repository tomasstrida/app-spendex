'use strict';
// Retroaktivní doplnění transactions.subcategory_id podle textových pravidel.
// Env: DB_PATH (povinné), CONFIRM=1 pro ostrý zápis (jinak dry-run). USER_ID (volitelné).
// Aditivní: doplní jen NULL subcategory_id, nikdy nemaže.
const path = require('path');
const Database = require('better-sqlite3');
const applyRules = require(path.join(__dirname, '../src/utils/apply-rules'));
const loadUserRules = require(path.join(__dirname, '../src/utils/load-user-rules'));
const seedRules = require(path.join(__dirname, 'seed/rules'));

const DB_PATH = process.env.DB_PATH;
const CONFIRM = process.env.CONFIRM === '1';
if (!DB_PATH) { console.error('Chybí DB_PATH'); process.exit(1); }
const db = new Database(DB_PATH);

const users = process.env.USER_ID ? [{ id: +process.env.USER_ID }] : db.prepare('SELECT id FROM users').all();
let planned = 0;
const updates = [];
for (const u of users) {
  const rules = { ...seedRules, textOverrides: loadUserRules(db, u.id) };
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND subcategory_id IS NULL AND category_id IS NOT NULL').all(u.id);
  const subcatCatId = db.prepare('SELECT category_id FROM subcategories WHERE id = ?');
  for (const t of txs) {
    const account = t.account_id ? db.prepare('SELECT account_number FROM accounts WHERE id = ?').get(t.account_id) : null;
    const { subcategory_id } = applyRules(t, account, rules);
    if (subcategory_id == null) continue;
    // Guard konzistence: subkategorii doplň jen když patří k ULOŽENÉ kategorii transakce.
    // Chrání před cross-category zápisem u ručně přeřazených tx (subcat z jiné rodičovské
    // kategorie by pak rozbila rozpad by_subcategory na Schůzce/Dashboardu).
    const scRow = subcatCatId.get(subcategory_id);
    if (!scRow || scRow.category_id !== t.category_id) continue;
    updates.push({ id: t.id, subcategory_id }); planned++;
  }
}
console.log(`Kandidátů k doplnění subcategory_id: ${planned}`);
console.log(updates.slice(0, 10));
if (!CONFIRM) { console.log('Dry-run (CONFIRM=1 pro zápis).'); process.exit(0); }
const upd = db.prepare('UPDATE transactions SET subcategory_id = ? WHERE id = ? AND subcategory_id IS NULL');
const tx = db.transaction(() => { for (const u of updates) upd.run(u.subcategory_id, u.id); });
tx();
console.log(`Zapsáno: ${updates.length}`);
