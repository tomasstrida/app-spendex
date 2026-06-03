'use strict';

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

module.exports = { backupObjectKey, selectKeysToPrune };
