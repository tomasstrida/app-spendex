'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { backupObjectKey, selectKeysToPrune } = require('./backup');

test('backupObjectKey: formát backups/data-YYYY-MM-DD-HHmmss.db.gz', () => {
  // 2026-06-03 03:00:05 UTC
  const d = new Date(Date.UTC(2026, 5, 3, 3, 0, 5));
  assert.equal(backupObjectKey(d), 'backups/data-2026-06-03-030005.db.gz');
});

test('backupObjectKey: dvojciferné zero-padding', () => {
  const d = new Date(Date.UTC(2026, 0, 9, 7, 8, 9));
  assert.equal(backupObjectKey(d), 'backups/data-2026-01-09-070809.db.gz');
});

test('selectKeysToPrune: vybere jen objekty starší než retenceDays', () => {
  const now = new Date(Date.UTC(2026, 5, 3, 3, 0, 0));
  const day = 24 * 60 * 60 * 1000;
  const objects = [
    { key: 'backups/a', lastModified: new Date(now - 5 * day) },   // 5 dní – ponechat
    { key: 'backups/b', lastModified: new Date(now - 31 * day) },  // 31 dní – smazat
    { key: 'backups/c', lastModified: new Date(now - 40 * day) },  // 40 dní – smazat
  ];
  const toPrune = selectKeysToPrune(objects, now, 30);
  assert.deepEqual(toPrune, ['backups/b', 'backups/c']);
});

test('selectKeysToPrune: přesně na hranici (30 dní) se NEMaže', () => {
  const now = new Date(Date.UTC(2026, 5, 3, 3, 0, 0));
  const day = 24 * 60 * 60 * 1000;
  const objects = [{ key: 'backups/edge', lastModified: new Date(now - 30 * day) }];
  assert.deepEqual(selectKeysToPrune(objects, now, 30), []);
});
