'use strict';
/**
 * Retroaktivně propíše zprávu (`note`) do prázdného `description`
 * u e-mailových transakcí (source = 'airbank-email'), kde je prázdný
 * i `place`.
 *
 * Důvod: převody bez jména protistrany (žádný řádek „úhrada na účet … číslo")
 * mají popisný údaj jen ve `note` = „Zpráva pro příjemce". Starší naimportované
 * tx tak mají prázdný `description` → v Popisu i review frontě je „—", nezabírá
 * vyhledávání ani textová category_rules (match_patterns matchuje `t.description`).
 * Od v2.0.128 to parser dělá u nových importů sám; tento skript srovná historii.
 *
 * Cílí jen na řádky, kde je `description` i `place` prázdný — respektuje pořadí
 * fallbacku z parseru (`description = place || note`); případy s neprázdným
 * `place` řeší migrate-email-place-to-description.cjs.
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
  SELECT t.id, t.user_id, t.date, t.amount, t.note, c.name AS cat_name
  FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
  WHERE t.source = 'airbank-email'
    AND (t.description IS NULL OR TRIM(t.description) = '')
    AND (t.place IS NULL OR TRIM(t.place) = '')
    AND t.note IS NOT NULL AND TRIM(t.note) != ''
  ORDER BY t.date DESC
`).all();

console.log(`Kandidátů (airbank-email, prázdný description i place, neprázdný note): ${candidates.length}`);
for (const r of candidates) {
  console.log(`  u${r.user_id} | ${r.date} | ${r.amount} Kč | note: "${r.note}" | kat: ${r.cat_name || '— bez kat. —'}`);
}

if (!CONFIRM) {
  console.log('\n🧪 Dry-run – nic se nezměnilo. Pro ostrý běh nastav CONFIRM=1.');
  process.exit(0);
}

if (candidates.length === 0) {
  console.log('Nic k úpravě.');
  process.exit(0);
}

const update = db.prepare('UPDATE transactions SET description = note WHERE id = ?');
const tx = db.transaction(() => {
  for (const r of candidates) update.run(r.id);
});
tx();
console.log(`✅ Aktualizováno: ${candidates.length} tx (description = note)`);
