'use strict';
/**
 * Retroaktivně doplní chybějící údaje u e-mailových transakcí (source =
 * 'airbank-email') přeparsováním uloženého e-mailu z `email_inbox.raw_text`.
 *
 * Doplní JEN prázdná pole (nikdy nepřepisuje neprázdná data):
 *   - counterparty_account (cílový účet) — kde je NULL a e-mail ho obsahuje.
 *     Hlavní důvod: formát „Odchozí úhrada na účet číslo <num>" (bez jména
 *     příjemce) měl do v2.0.205 protiúčet=NULL.
 *   - variable_symbol — kde je NULL a e-mail ho obsahuje (sloupec od v2.0.206).
 *   - note — rozšíří JEN bezpečně: pokud nový note (obě zprávy „plátce · příjemce")
 *     obsahuje stávající note jako podřetězec (tj. jen přidává zprávu pro příjemce,
 *     nic neztrácí). Jinak note nechá být (respektuje případné ruční úpravy).
 *
 * Párování: email_inbox.external_id ↔ transactions.external_id (+ user_id).
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

// E-maily s uloženým raw textem a external_id (jen ty spárovatelné na tx).
const inbox = db.prepare(`
  SELECT user_id, external_id, raw_text
  FROM email_inbox
  WHERE raw_text IS NOT NULL AND TRIM(raw_text) != ''
    AND external_id IS NOT NULL AND TRIM(external_id) != ''
`).all();

const getTx = db.prepare(`
  SELECT id, counterparty_account, variable_symbol, note
  FROM transactions
  WHERE source = 'airbank-email' AND user_id = ? AND external_id = ?
`);

const plans = [];  // { txId, sets: {col: [old, new]} }
for (const row of inbox) {
  const tx = getTx.get(row.user_id, row.external_id);
  if (!tx) continue;
  let parsed;
  try { parsed = parseEmailNotification(row.raw_text); } catch { parsed = null; }
  if (!parsed) continue;

  const sets = {};
  const empty = (v) => v == null || String(v).trim() === '';

  if (empty(tx.counterparty_account) && !empty(parsed.counterparty_account)) {
    sets.counterparty_account = [tx.counterparty_account, parsed.counterparty_account];
  }
  if (empty(tx.variable_symbol) && !empty(parsed.variable_symbol)) {
    sets.variable_symbol = [tx.variable_symbol, parsed.variable_symbol];
  }
  // Bezpečné rozšíření note: nové obsahuje staré jako podřetězec (jen přidává příjemce).
  const oldNote = tx.note == null ? '' : String(tx.note).trim();
  const newNote = parsed.note == null ? '' : String(parsed.note).trim();
  if (newNote && newNote !== oldNote && (oldNote === '' || newNote.includes(oldNote))) {
    sets.note = [oldNote, newNote];
  }

  if (Object.keys(sets).length) plans.push({ txId: tx.id, userId: row.user_id, ext: row.external_id, sets });
}

console.log(`E-mailů s raw textem: ${inbox.length}`);
console.log(`Transakcí k doplnění: ${plans.length}\n`);
for (const p of plans) {
  console.log(`  tx#${p.txId} u${p.userId} ext=${p.ext}`);
  for (const [col, [oldV, newV]] of Object.entries(p.sets)) {
    console.log(`     ${col}: ${JSON.stringify(oldV)} → ${JSON.stringify(newV)}`);
  }
}

if (!CONFIRM) {
  console.log('\n🧪 Dry-run – nic se nezměnilo. Pro ostrý běh nastav CONFIRM=1.');
  process.exit(0);
}

if (plans.length === 0) {
  console.log('Nic k úpravě.');
  process.exit(0);
}

const applyOne = db.transaction((p) => {
  for (const [col, [, newV]] of Object.entries(p.sets)) {
    db.prepare(`UPDATE transactions SET ${col} = ? WHERE id = ?`).run(newV, p.txId);
  }
});
const run = db.transaction(() => { for (const p of plans) applyOne(p); });
run();
console.log(`✅ Aktualizováno: ${plans.length} tx.`);
