#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const Database = require('better-sqlite3');
const { listBackups } = require('../src/services/backup');
const { createR2Client } = require('../src/services/r2Client');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data.db');

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

(async () => {
  const key = process.argv[2];
  const confirm = process.env.CONFIRM === '1';
  const r2 = createR2Client();

  // Bez klíče → vypiš dostupné zálohy.
  if (!key) {
    const list = await listBackups(r2);
    if (!list.length) {
      console.log('Žádné zálohy v R2.');
      return;
    }
    console.log('Dostupné zálohy (nejnovější první):');
    for (const b of list) {
      console.log(`  ${b.key}\t${b.lastModified.toISOString()}\t${b.sizeBytes} B`);
    }
    console.log('\nObnova: node scripts/restore-backup.cjs <klíč>            (dry-run)');
    console.log('Ostrá:  CONFIRM=1 node scripts/restore-backup.cjs <klíč>');
    return;
  }

  // Stáhni a rozbal do temp.
  console.log(`Stahuji ${key} …`);
  const gz = await r2.get(key);
  const raw = zlib.gunzipSync(gz);
  const tmpPath = path.join(require('node:os').tmpdir(), `restore-${ts()}.db`);
  fs.writeFileSync(tmpPath, raw);

  // Ověř integritu + spočítej řádky pro přehled.
  const rdb = new Database(tmpPath, { readonly: true });
  const tables = rdb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map((r) => r.name);
  const txCount = tables.includes('transactions')
    ? rdb.prepare('SELECT COUNT(*) c FROM transactions').get().c
    : null;
  rdb.close();

  if (!confirm) {
    console.log('\n=== DRY-RUN (nic se nepřepíše) ===');
    console.log(`Zdroj:        ${key}`);
    console.log(`Velikost:     ${raw.length} B (rozbaleno)`);
    console.log(`Tabulek:      ${tables.length} (${tables.join(', ')})`);
    if (txCount !== null) console.log(`Transakcí:    ${txCount}`);
    console.log(`Cíl (DB_PATH): ${DB_PATH}`);
    console.log('\nPro ostrou obnovu spusť znovu s CONFIRM=1.');
    fs.rmSync(tmpPath, { force: true });
    return;
  }

  // Ostrá obnova: bezpečnostní kopie stávající DB, pak přepiš.
  if (fs.existsSync(DB_PATH)) {
    const backupPath = `${DB_PATH}.before-restore-${ts()}`;
    fs.copyFileSync(DB_PATH, backupPath);
    console.log(`Bezpečnostní kopie stávající DB: ${backupPath}`);
  }
  fs.copyFileSync(tmpPath, DB_PATH);
  fs.rmSync(tmpPath, { force: true });
  console.log(`Obnoveno z ${key} do ${DB_PATH}.`);
  console.log('Restartuj aplikaci, aby se znovu otevřela DB.');
})().catch((err) => {
  console.error('Obnova selhala:', err);
  process.exit(1);
});
