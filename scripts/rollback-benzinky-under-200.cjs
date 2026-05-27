'use strict';
/**
 * Rollback skript pro migraci benzinek < 200 Kč z 2026-05-28.
 * Vrací tx zpět do původních kategorií podle hardcoded mapy.
 * Bezpečnostní pojistka: vrátí jen ty, které jsou nyní v „Restaurace a kávičky".
 *
 * Env: DB_PATH povinné, USER_ID default 1, CONFIRM '1' pro ostrý běh.
 */
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH;
const USER_ID = Number(process.env.USER_ID || 1);
const CONFIRM = process.env.CONFIRM === '1';
// TO_PHM_ALL=1 přepíše všechny cílové kategorie na „Auto Moto - PHM"
// (lokálně user mezitím tx přesouval z Jídlo do PHM, takže prod-mapa nesedí).
const TO_PHM_ALL = process.env.TO_PHM_ALL === '1';

if (!DB_PATH) { console.error('DB_PATH je povinný.'); process.exit(1); }

// (date, descriptionPrefix, amount) → původní kategorie. Z dry-run výpisu před
// migrací. Match je přes description LIKE 'prefix%' + přesná shoda date+amount,
// ať skript zafunguje i kdyby původní description měl trailing whitespace apod.
const ROLLBACK_MAP = [
  // Prod: 4 tx z „Jídlo a běžné nákupy"
  ['2026-05-12', 'CS EUROOIL',           -60,    'Jídlo a běžné nákupy'],
  ['2026-04-28', 'ORLEN CS 0217',        -113.8, 'Jídlo a běžné nákupy'],
  ['2026-04-24', 'MOL 688 Praha 4',      -79,    'Jídlo a běžné nákupy'],
  ['2026-04-20', 'SHELL 8100',           -90,    'Jídlo a běžné nákupy'],
  // Prod + lokál: 21 tx z „Auto Moto - PHM"
  ['2026-05-14', 'OMV Česká republika', -165,   'Auto Moto - PHM'],
  ['2026-04-19', 'OMV 2124',             -39,    'Auto Moto - PHM'],
  ['2026-04-12', 'OMV Česká republika', -60.15, 'Auto Moto - PHM'],
  ['2026-04-12', 'MOL 630 Humpolec',     -71.1,  'Auto Moto - PHM'],
  ['2026-03-27', 'MOL 707 Strasnov',     -71.1,  'Auto Moto - PHM'],
  ['2026-03-27', 'MOL 653 Liberec',      -79,    'Auto Moto - PHM'],
  ['2026-03-27', 'MOL 653 Liberec',      -17,    'Auto Moto - PHM'],
  ['2026-03-23', 'MOL 686 Praha 4',      -83.8,  'Auto Moto - PHM'],
  ['2026-03-17', 'MOL 386 Pruhonice',    -65,    'Auto Moto - PHM'],
  ['2026-03-12', 'OMV 2124',             -39,    'Auto Moto - PHM'],
  ['2026-03-10', 'SHELL 8100',           -90,    'Auto Moto - PHM'],
  ['2026-03-06', 'ORLEN CS 0226',        -79,    'Auto Moto - PHM'],
  ['2026-03-01', 'ORLEN CS 0236',        -104,   'Auto Moto - PHM'],
  ['2026-02-25', 'OMV 2206',             -131.3, 'Auto Moto - PHM'],
  ['2026-02-21', 'MOL 658 Mikulov',      -71.1,  'Auto Moto - PHM'],
  ['2026-02-20', 'MOL 056 Vel.Mezir.',   -79,    'Auto Moto - PHM'],
  ['2026-02-03', 'MOL 652 Libere',       -39.5,  'Auto Moto - PHM'],
  // Jen prod: 4 starší tx (před lokálním obdobím)
  ['2026-01-31', 'ORLEN CS 0340',        -81.8,  'Auto Moto - PHM'],
  ['2026-01-20', 'MOL 406 Stechovice',   -168,   'Auto Moto - PHM'],
  ['2026-01-18', 'MOL 056 Vel.Mezir.',   -55.3,  'Auto Moto - PHM'],
  ['2026-01-18', 'MOL 608 Brno',         -120.3, 'Auto Moto - PHM'],
];

const db = new Database(DB_PATH);

const restCat = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?')
  .get(USER_ID, 'Restaurace a kávičky');
if (!restCat) { console.error('Restaurace a kávičky neexistuje.'); process.exit(1); }

const catId = {};
for (const r of db.prepare('SELECT id, name FROM categories WHERE user_id = ?').all(USER_ID)) {
  catId[r.name] = r.id;
}

const findStmt = db.prepare(`
  SELECT id, date, description, amount, category_id
  FROM transactions
  WHERE user_id = ?
    AND date = ?
    AND amount = ?
    AND description LIKE ? || '%'
    AND category_id = ?
`);

const updates = [];
for (const [date, descPrefix, amount, originalCatFromMap] of ROLLBACK_MAP) {
  const originalCat = TO_PHM_ALL ? 'Auto Moto - PHM' : originalCatFromMap;
  const targetCatId = catId[originalCat];
  if (!targetCatId) { console.warn(`SKIP: kategorie „${originalCat}" neexistuje.`); continue; }
  const rows = findStmt.all(USER_ID, date, amount, descPrefix, restCat.id);
  if (rows.length === 0) {
    console.log(`  (nenalezeno v Restauraci) ${date} | ${amount} | ${descPrefix}`);
    continue;
  }
  for (const r of rows) {
    updates.push({ id: r.id, date: r.date, description: r.description, amount: r.amount, to: originalCat, toId: targetCatId });
  }
}

console.log(`Bude vráceno: ${updates.length} tx do původních kategorií`);
for (const u of updates) {
  console.log(`  ${u.date} | ${u.amount} Kč | ${u.description} → ${u.to}`);
}

if (!CONFIRM) {
  console.log('\n🧪 Dry-run – nic se nezměnilo. Pro ostrý běh nastav CONFIRM=1.');
  process.exit(0);
}

if (updates.length === 0) { console.log('Nic k vrácení.'); process.exit(0); }

const upd = db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?');
const tx = db.transaction(() => {
  for (const u of updates) upd.run(u.toId, u.id);
});
tx();
console.log(`✅ Vráceno: ${updates.length} tx do původních kategorií`);
