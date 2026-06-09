'use strict';
/**
 * Retroaktivně propíše obchodníka (`place`) do prázdného `description`
 * u e-mailových kartových plateb (source = 'airbank-email').
 *
 * Důvod: kartové notifikace AirBank nemají řádek „úhrada na účet … číslo",
 * takže starší naimportované tx mají description prázdný a obchodník je jen
 * v `place` → nezabírá textová category_rules (match_patterns matchuje
 * `t.description LIKE`). Od v2.0.79 to parser dělá u nových importů sám;
 * tento skript srovná historii.
 *
 * Env:
 *   DB_PATH   povinné, cesta k SQLite
 *   CONFIRM   '1' = ostrý běh (UPDATE), jinak dry-run (jen výpis)
 */
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH;
const CONFIRM = process.env.CONFIRM === '1';

if (!DB_PATH) {
  console.error('DB_PATH je povinný.');
  process.exit(1);
}

const db = new Database(DB_PATH);

const candidates = db.prepare(`
  SELECT t.id, t.user_id, t.date, t.amount, t.place, c.name AS cat_name
  FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.source = 'airbank-email'
    AND (t.description IS NULL OR TRIM(t.description) = '')
    AND t.place IS NOT NULL AND TRIM(t.place) != ''
  ORDER BY t.date DESC
`).all();

console.log(`Kandidátů (airbank-email, prázdný description, neprázdný place): ${candidates.length}`);
for (const r of candidates) {
  console.log(`  u${r.user_id} | ${r.date} | ${r.amount} Kč | place: "${r.place}" | kat: ${r.cat_name || '— bez kat. —'}`);
}

if (!CONFIRM) {
  console.log('\n🧪 Dry-run – nic se nezměnilo. Pro ostrý běh nastav CONFIRM=1.');
  process.exit(0);
}

if (candidates.length === 0) {
  console.log('Nic k úpravě.');
  process.exit(0);
}

const update = db.prepare('UPDATE transactions SET description = place WHERE id = ?');
const tx = db.transaction(() => {
  for (const r of candidates) update.run(r.id);
});
tx();
console.log(`✅ Aktualizováno: ${candidates.length} tx (description = place)`);
