'use strict';
// Retroaktivní přepnutí účetních kategorií na type=4.
// Dnes má kategorie „Převody" (interní přesuny mezi vlastními účty) type=1 → přepni na 4.
// Env: DB_PATH (povinné), CONFIRM=1 pro ostrý zápis (jinak dry-run).
// Aditivní: mění jen type a maže mrtvé měsíční budgety té kategorie; NEMAŽE transakce.
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH;
const CONFIRM = process.env.CONFIRM === '1';
if (!DB_PATH) { console.error('Chybí DB_PATH'); process.exit(1); }

// Názvy kategorií, které jsou účetní (rozšiřitelné).
const ACCOUNTING_NAMES = ['Převody'];

const db = new Database(DB_PATH);
const ph = ACCOUNTING_NAMES.map(() => '?').join(',');
const cats = db.prepare(
  `SELECT id, user_id, name, type FROM categories WHERE name IN (${ph}) AND type != 4`
).all(...ACCOUNTING_NAMES);

console.log(`Kandidátů na type=4: ${cats.length}`);
console.log(cats.slice(0, 20));
if (!CONFIRM) { console.log('Dry-run (CONFIRM=1 pro zápis).'); process.exit(0); }

const setType = db.prepare('UPDATE categories SET type = 4 WHERE id = ?');
const delBudgets = db.prepare('DELETE FROM budgets WHERE user_id = ? AND category_id = ?');
const tx = db.transaction(() => {
  for (const c of cats) { setType.run(c.id); delBudgets.run(c.user_id, c.id); }
});
tx();
console.log(`Přepnuto na type=4: ${cats.length}`);
