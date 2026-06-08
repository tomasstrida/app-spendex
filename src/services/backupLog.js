'use strict';

/**
 * Zapíše výsledek zálohy do backup_log.
 * @param {import('better-sqlite3').Database} db
 * @param {{status:'success'|'failure', res?:{key:string,sizeBytes:number,prunedCount:number}, err?:Error}} input
 */
function recordBackup(db, { status, res, err }) {
  db.prepare(
    `INSERT INTO backup_log (status, object_key, size_bytes, pruned_count, error)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    status,
    res ? res.key : null,
    res ? res.sizeBytes : null,
    res ? res.prunedCount : null,
    err ? (err.message || String(err)) : null
  );
}

/**
 * Existuje úspěšná záloha za posledních maxAgeHours hodin?
 * Časovou matiku dělá SQLite (created_at i 'now' jsou UTC).
 * @param {import('better-sqlite3').Database} db
 * @param {number} maxAgeHours
 * @returns {boolean}
 */
function hasRecentSuccess(db, maxAgeHours) {
  const hours = Number.isFinite(Number(maxAgeHours)) && Number(maxAgeHours) > 0 ? Number(maxAgeHours) : 3;
  const row = db.prepare(
    `SELECT 1 FROM backup_log
     WHERE status = 'success' AND created_at >= datetime('now', ?)
     LIMIT 1`
  ).get(`-${hours} hours`);
  return Boolean(row);
}

module.exports = { recordBackup, hasRecentSuccess };
