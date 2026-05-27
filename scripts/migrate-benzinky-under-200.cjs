'use strict';
/**
 * Retroaktivně přesune transakce, které matchují benzinkový pattern
 * a ABS(amount) < 200, do kategorie „Restaurace a kávičky".
 *
 * Env:
 *   DB_PATH   povinné, cesta k SQLite
 *   USER_ID   volitelné, default 1
 *   CONFIRM   '1' = ostrý běh (UPDATE), jinak dry-run (jen výpis)
 */
const Database = require('better-sqlite3');

const PATTERNS = ['SHELL', 'OMV', 'MOL ', 'BENZINA', 'EUROOIL', 'ORLEN', 'CIRCLE K'];
const TARGET_CATEGORY = 'Restaurace a kávičky';

const DB_PATH = process.env.DB_PATH;
const USER_ID = Number(process.env.USER_ID || 1);
const CONFIRM = process.env.CONFIRM === '1';

if (!DB_PATH) {
  console.error('DB_PATH je povinný.');
  process.exit(1);
}

const db = new Database(DB_PATH);

const target = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?').get(USER_ID, TARGET_CATEGORY);
if (!target) {
  console.error(`Kategorie „${TARGET_CATEGORY}" pro user_id=${USER_ID} neexistuje.`);
  process.exit(1);
}

const upPatterns = PATTERNS.map(p => p.toUpperCase());
const ors = upPatterns.map(() => 'UPPER(t.description) LIKE ?').join(' OR ');
const likeParams = upPatterns.map(p => `%${p}%`);

const candidates = db.prepare(`
  SELECT t.id, t.date, t.description, t.amount, t.category_id, c.name AS cat_name
  FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.user_id = ?
    AND ABS(t.amount) < 200
    AND (${ors})
    AND (t.category_id IS NULL OR t.category_id != ?)
  ORDER BY t.date DESC
`).all(USER_ID, ...likeParams, target.id);

console.log(`Kandidátů (ABS<200, benzinkový pattern, mimo „${TARGET_CATEGORY}"): ${candidates.length}`);
for (const r of candidates) {
  console.log(`  ${r.date} | ${r.amount} Kč | ${r.description} | nyní: ${r.cat_name || '— bez kat. —'}`);
}

if (!CONFIRM) {
  console.log('\n🧪 Dry-run – nic se nezměnilo. Pro ostrý běh nastav CONFIRM=1.');
  process.exit(0);
}

if (candidates.length === 0) {
  console.log('Nic k přesunu.');
  process.exit(0);
}

const update = db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?');
const tx = db.transaction(() => {
  for (const r of candidates) update.run(target.id, r.id);
});
tx();
console.log(`✅ Přesunuto: ${candidates.length} tx → „${TARGET_CATEGORY}"`);
