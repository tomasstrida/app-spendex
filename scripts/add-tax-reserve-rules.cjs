'use strict';
/**
 * Založí 2 pravidla kategorizace (category_rules) pro převod OSVČ ↔ Dane-doplatek:
 * obě nohy mají jít do kategorie „Mimo systém" (jinak je L0 zařadí jako Převody
 * interní a ruční přeřazení jedné nohy rozhodí kontrolní saldo).
 *
 *   účet Dane-doplatek  + protiúčet <číslo OSVČ>   → Mimo systém
 *   účet Tom-OSVC       + protiúčet <číslo Dane>   → Mimo systém
 *
 * Pravidla nesou match_counterparty_account I match_account_id, takže (vrstva L3a
 * v apply-rules.js) přebijí L0. Vyžaduje nasazenou verzi >= 4.1.72.
 * Čísla účtů se hledají podle jména účtu, ne pevně. Idempotentní: existující
 * pravidlo se stejným protiúčtem + účtem se přeskočí.
 *
 * Env:
 *   DB_PATH   povinné, cesta k SQLite
 *   CONFIRM   '1' = ostrý běh (INSERT), jinak dry-run (jen výpis)
 */
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH;
const CONFIRM = process.env.CONFIRM === '1';
if (!DB_PATH) { console.error('DB_PATH je povinný.'); process.exit(1); }

const OSVC_NAME = 'Tom-OSVC';
const DANE_NAME = 'Dane-doplatek';
const CATEGORY = 'Mimo systém';

const db = new Database(DB_PATH);
const acc = (name) => db.prepare('SELECT id, user_id, account_number FROM accounts WHERE name = ?').all(name);

const osvcRows = acc(OSVC_NAME);
const daneRows = acc(DANE_NAME);
if (osvcRows.length !== 1 || daneRows.length !== 1) {
  console.error(`Očekávám přesně 1 účet „${OSVC_NAME}" a 1 „${DANE_NAME}", nalezeno ${osvcRows.length}/${daneRows.length}.`);
  process.exit(1);
}
const osvc = osvcRows[0]; const dane = daneRows[0];
if (osvc.user_id !== dane.user_id) { console.error('Účty patří různým uživatelům.'); process.exit(1); }
const userId = osvc.user_id;
const cat = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?').get(userId, CATEGORY);
if (!cat) { console.error(`Kategorie „${CATEGORY}" nenalezena.`); process.exit(1); }

const wanted = [
  { label: `${DANE_NAME} ← ${OSVC_NAME}`, accountId: dane.id, counterparty: osvc.account_number },
  { label: `${OSVC_NAME} → ${DANE_NAME}`, accountId: osvc.id, counterparty: dane.account_number },
];

const exists = db.prepare(
  'SELECT id FROM category_rules WHERE user_id = ? AND match_counterparty_account = ? AND match_account_id = ?'
);
const insert = db.prepare(
  "INSERT INTO category_rules (user_id, category_id, pattern, match_counterparty_account, match_account_id) VALUES (?, ?, '', ?, ?)"
);

console.log(CONFIRM ? '== OSTRÝ BĚH ==' : '== DRY-RUN (nic se nezapisuje) ==');
let created = 0;
for (const w of wanted) {
  const ex = exists.get(userId, w.counterparty, w.accountId);
  if (ex) { console.log(`PŘESKOČENO (už existuje #${ex.id}): ${w.label}`); continue; }
  console.log(`${CONFIRM ? 'VKLÁDÁM' : 'VLOŽIL BYCH'}: ${w.label} | účet id=${w.accountId} + protiúčet ${w.counterparty} → ${CATEGORY}`);
  if (CONFIRM) insert.run(userId, cat.id, w.counterparty, w.accountId);
  created++;
}
console.log(`Hotovo: ${created} ${CONFIRM ? 'vloženo' : 'ke vložení'}.`);
