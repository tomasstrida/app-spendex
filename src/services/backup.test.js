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

const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createBackup } = require('./backup');

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spendex-bak-'));
  const dbPath = path.join(dir, 'data.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  db.prepare('INSERT INTO t (v) VALUES (?)').run('ahoj');
  db.close();
  return { dir, dbPath };
}

function makeFakeR2() {
  const store = new Map();
  return {
    bucket: 'test',
    puts: [],
    deleted: [],
    listResult: [],
    async put(key, body) { this.puts.push({ key, body }); store.set(key, body); },
    async list() { return this.listResult; },
    async delete(keys) { this.deleted.push(...keys); },
    async get(key) { return store.get(key); },
  };
}

test('createBackup: nahraje gzipovaný konzistentní snapshot DB', async () => {
  const { dir, dbPath } = makeTempDb();
  try {
    const r2 = makeFakeR2();
    const now = new Date(Date.UTC(2026, 5, 3, 3, 0, 5));

    const res = await createBackup({ r2, dbPath, tmpDir: dir, now });

    assert.equal(res.key, 'backups/data-2026-06-03-030005.db.gz');
    assert.equal(r2.puts.length, 1);

    // Nahraný obsah musí jít rozbalit zpět na validní SQLite s našimi daty.
    const uploaded = r2.puts[0].body;
    const restoredPath = path.join(dir, 'restored.db');
    fs.writeFileSync(restoredPath, zlib.gunzipSync(uploaded));
    const rdb = new Database(restoredPath);
    const row = rdb.prepare('SELECT v FROM t WHERE id = 1').get();
    rdb.close();
    assert.equal(row.v, 'ahoj');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createBackup: po uploadu smaže staré zálohy přes prune', async () => {
  const { dir, dbPath } = makeTempDb();
  try {
    const r2 = makeFakeR2();
    const now = new Date(Date.UTC(2026, 5, 3, 3, 0, 5));
    const day = 24 * 60 * 60 * 1000;
    r2.listResult = [
      { key: 'backups/old', lastModified: new Date(now - 40 * day), sizeBytes: 1 },
      { key: 'backups/fresh', lastModified: new Date(now - 2 * day), sizeBytes: 1 },
    ];

    const res = await createBackup({ r2, dbPath, tmpDir: dir, now, retentionDays: 30 });

    assert.deepEqual(r2.deleted, ['backups/old']);
    assert.equal(res.prunedCount, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
