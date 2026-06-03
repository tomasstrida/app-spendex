'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const Database = require('better-sqlite3');

const _retentionEnv = Number(process.env.BACKUP_RETENTION_DAYS);
const DEFAULT_RETENTION_DAYS = Number.isFinite(_retentionEnv) && _retentionEnv >= 0 ? _retentionEnv : 30;

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Klíč objektu pro zálohu. Datum bereme v UTC kvůli determinismu. */
function backupObjectKey(date) {
  const y = date.getUTCFullYear();
  const mo = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const h = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  const s = pad(date.getUTCSeconds());
  return `backups/data-${y}-${mo}-${d}-${h}${mi}${s}.db.gz`;
}

/** Vrátí klíče objektů starších než retentionDays vůči `now`. */
function selectKeysToPrune(objects, now, retentionDays) {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return objects
    .filter((o) => o.lastModified.getTime() < cutoff)
    .map((o) => o.key);
}

/** Smaže zálohy starší než retentionDays. Vrací počet smazaných. */
async function pruneOldBackups(r2, now, retentionDays) {
  const objects = await r2.list('backups/');
  const keys = selectKeysToPrune(objects, now, retentionDays);
  await r2.delete(keys);
  return keys.length;
}

/** Vrátí seznam záloh seřazený sestupně dle data (nejnovější první). */
async function listBackups(r2) {
  const objects = await r2.list('backups/');
  return objects.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

/**
 * Vytvoří konzistentní snapshot data.db, zkomprimuje a nahraje na R2, pak prořeže staré.
 * deps: { r2, dbPath, tmpDir, now, retentionDays }
 */
async function createBackup({
  r2,
  dbPath = process.env.DB_PATH || path.join(__dirname, '../../data.db'),
  tmpDir = os.tmpdir(),
  now = new Date(),
  retentionDays = DEFAULT_RETENTION_DAYS,
}) {
  const snapshotPath = path.join(tmpDir, `snapshot-${now.getTime()}.db`);
  try {
    // Konzistentní snapshot i ve WAL módu (NE prostá kopie souboru).
    const src = new Database(dbPath, { readonly: true });
    try {
      await src.backup(snapshotPath);
    } finally {
      src.close();
    }

    const gz = zlib.gzipSync(fs.readFileSync(snapshotPath));
    const key = backupObjectKey(now);
    await r2.put(key, gz);

    const prunedCount = await pruneOldBackups(r2, now, retentionDays);
    return { key, sizeBytes: gz.length, prunedCount };
  } finally {
    fs.rmSync(snapshotPath, { force: true });
  }
}

module.exports = {
  backupObjectKey,
  selectKeysToPrune,
  pruneOldBackups,
  listBackups,
  createBackup,
};
