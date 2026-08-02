'use strict';
/**
 * Retroaktivně doplní `tx_type` u e-mailových převodů (source = 'airbank-email').
 *
 * E-mailová notifikace typ úhrady neuvádí, takže do v4.0.60 zůstával prázdný —
 * na rozdíl od CSV, kde ho banka posílá („Odchozí úhrada" / „Příchozí úhrada").
 * Skript doplní stejné názvosloví podle směru částky.
 *
 * Pravidla (záměrně konzervativní):
 *   - jen `source = 'airbank-email'` — CSV data od banky se nepřepisují,
 *   - jen řádky s prázdným `tx_type` — ruční ani dřívější hodnoty se nemažou,
 *   - jen řádky s vyplněným `counterparty_account` — platby bez protiúčtu
 *     (inkaso, splátka půjčky, poplatek) převody nejsou a e-mail je neodliší.
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

const rows = db.prepare(`
  SELECT id, user_id, date, amount, description, counterparty_account
  FROM transactions
  WHERE source = 'airbank-email'
    AND (tx_type IS NULL OR TRIM(tx_type) = '')
    AND counterparty_account IS NOT NULL AND TRIM(counterparty_account) != ''
  ORDER BY date, id
`).all();

const planned = rows.map(r => ({
  ...r,
  tx_type: r.amount < 0 ? 'Odchozí úhrada' : 'Příchozí úhrada',
}));

console.log(`${CONFIRM ? 'OSTRÝ BĚH' : 'DRY-RUN'} — kandidátů: ${planned.length}`);
const counts = planned.reduce((a, p) => ({ ...a, [p.tx_type]: (a[p.tx_type] || 0) + 1 }), {});
console.log('rozpad:', JSON.stringify(counts));
for (const p of planned.slice(0, 10)) {
  console.log(`  #${p.id} ${p.date} ${p.amount} ${p.description || '(bez popisu)'} → ${p.tx_type}`);
}
if (planned.length > 10) console.log(`  … a dalších ${planned.length - 10}`);

if (!CONFIRM) {
  console.log('\nDry-run. Ostrý běh: CONFIRM=1');
  process.exit(0);
}

const upd = db.prepare('UPDATE transactions SET tx_type = ? WHERE id = ? AND user_id = ?');
const run = db.transaction(list => {
  for (const p of list) upd.run(p.tx_type, p.id, p.user_id);
});
run(planned);
console.log(`\nHotovo — aktualizováno ${planned.length} transakcí.`);
