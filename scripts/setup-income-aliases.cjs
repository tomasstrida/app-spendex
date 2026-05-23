#!/usr/bin/env node
/**
 * Idempotentně nastaví income_source aliasy pro auto-detekci příjmů (Phase 2).
 *
 * Aktualizuje (nebo vytvoří) zdroje:
 *   - Tom        → match_counterparty_account = 1679014138, planned 162 000
 *   - Sudo nájem → match_counterparty_account = 2111779001, planned 21 000
 * Martin se NEDOTKNE (uživatel preferuje stávající match_pattern).
 *
 * Spuštění lokálně:
 *   node scripts/setup-income-aliases.cjs
 *
 * Spuštění na PROD (Railway):
 *   railway run --service <name> node scripts/setup-income-aliases.cjs
 *   nebo přes SSH:
 *   railway ssh "cd /app && node scripts/setup-income-aliases.cjs"
 *
 * ENV:
 *   DB_PATH  – cesta k DB souboru (default ./data.db)
 *   USER_ID  – ID uživatele (default 1)
 */
'use strict';

const path = require('path');
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');
const db = require('better-sqlite3')(dbPath);
const USER_ID = parseInt(process.env.USER_ID || '1', 10);

function upsertSource(person, planned, matchPattern, matchCounterparty, sortOrder) {
  const upd = db.prepare(`
    UPDATE income_sources
    SET planned_amount = ?, match_pattern = ?, match_counterparty_account = ?, sort_order = ?
    WHERE user_id = ? AND person = ?
  `).run(planned, matchPattern, matchCounterparty, sortOrder, USER_ID, person);

  if (upd.changes === 0) {
    db.prepare(`
      INSERT INTO income_sources
        (user_id, person, planned_amount, match_pattern, match_counterparty_account, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(USER_ID, person, planned, matchPattern, matchCounterparty, sortOrder);
    console.log(`+ INSERT ${person}`);
  } else {
    console.log(`~ UPDATE ${person} (${upd.changes} řádek)`);
  }
}

console.log(`DB: ${dbPath} · user_id: ${USER_ID}\n`);

upsertSource('Tom',        162000, null, '1679014138', 1);
upsertSource('Sudo nájem', 21000,  null, '2111779001', 3);

const rows = db.prepare(`
  SELECT id, person, planned_amount, match_pattern, match_counterparty_account, sort_order
  FROM income_sources WHERE user_id = ?
  ORDER BY sort_order, id
`).all(USER_ID);

console.log('\nVýsledný stav income_sources:');
console.table(rows);
console.log('\nHotovo. Script je idempotentní — spuštění opakovaně dorovná na cílový stav.');
