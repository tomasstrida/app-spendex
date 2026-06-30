'use strict';
/**
 * Retroaktivně doplní obchodníka a typ u e-mailových transakcí, které vznikly
 * z notifikace „Snížení/Zvýšení částky blokace" (korekce karetní blokace) a mají
 * dnes prázdný `description` i `place`.
 *
 * Důvod: do v2.0.128 parser neuměl vytáhnout merchanta z řádku
 * „Snížení částky blokace, <MERCHANT>, <místo>, 000" → tyto korekce se zaúčtovaly
 * jako záhadný kladný pohyb bez popisu (vypadají jako příjem). Od v2.0.129 to parser
 * dělá u nových importů sám; tento skript srovná historii.
 *
 * Postup: spáruje tx s odpovídajícím email_inbox přes external_id, raw_text
 * znovu prožene aktuálním parserem a převezme `place` / `description` / `tx_type`.
 * Cílí jen na řádky s prázdným `description` i `place`, kde nový parser vrátí
 * tx_type = 'Korekce blokace'. Znaménko ani částku NEMĚNÍ. Idempotentní.
 *
 * Env:
 *   DB_PATH   povinné, cesta k SQLite
 *   CONFIRM   '1' = ostrý běh (UPDATE), jinak dry-run (jen výpis)
 */
const Database = require('better-sqlite3');
const { parseEmailNotification } = require('../src/utils/emailParser');

const DB_PATH = process.env.DB_PATH;
const CONFIRM = process.env.CONFIRM === '1';

if (!DB_PATH) {
  console.error('DB_PATH je povinný.');
  process.exit(1);
}

const db = new Database(DB_PATH);

// Kandidáti: e-mailové tx s prázdným popisem i place, ke kterým existuje inbox
// záznam (raw_text) se shodným external_id, jehož tělo je o korekci blokace.
const candidates = db.prepare(`
  SELECT t.id, t.user_id, t.date, t.amount, t.external_id, i.raw_text
  FROM transactions t
  JOIN email_inbox i ON i.user_id = t.user_id AND i.external_id = t.external_id
  WHERE t.source = 'airbank-email'
    AND (t.description IS NULL OR TRIM(t.description) = '')
    AND (t.place IS NULL OR TRIM(t.place) = '')
    AND i.raw_text LIKE '%ástky blokace%'
  ORDER BY t.date DESC
`).all();

const updates = [];
for (const r of candidates) {
  const parsed = parseEmailNotification(r.raw_text);
  if (!parsed || parsed.tx_type !== 'Korekce blokace' || !parsed.place) continue;
  updates.push({ id: r.id, user_id: r.user_id, date: r.date, amount: r.amount, place: parsed.place });
}

console.log(`Kandidátů (airbank-email, prázdný description i place, tělo o blokaci): ${candidates.length}`);
console.log(`Z toho parser nově rozpozná jako korekci blokace: ${updates.length}\n`);
for (const u of updates) {
  console.log(`  u${u.user_id} | ${u.date} | +${u.amount} Kč → popis/place: "${u.place}", typ: "Korekce blokace"`);
}

if (!CONFIRM) {
  console.log('\n🧪 Dry-run – nic se nezměnilo. Pro ostrý běh nastav CONFIRM=1.');
  process.exit(0);
}

if (updates.length === 0) {
  console.log('Nic k úpravě.');
  process.exit(0);
}

const stmt = db.prepare(
  "UPDATE transactions SET description = ?, place = ?, tx_type = 'Korekce blokace' WHERE id = ?"
);
const run = db.transaction(() => {
  for (const u of updates) stmt.run(u.place, u.place, u.id);
});
run();
console.log(`✅ Aktualizováno: ${updates.length} tx (description + place + tx_type)`);
