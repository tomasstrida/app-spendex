# Backup heartbeat monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Logovat úspěšné zálohy do DB (bez success e-mailu) a denním kontrolním cronem upozornit e-mailem, když v DB chybí čerstvá úspěšná záloha — odchytí i scénář, kdy zálohovací cron vůbec neběží.

**Architecture:** Nová tabulka `backup_log` + modul `src/services/backupLog.js` (`recordBackup` / `hasRecentSuccess`, testovatelný v izolaci). `scheduler.runBackupJob` po výsledku zapíše řádek (success bez e-mailu; failure ponechá okamžitý alert + zapíše řádek). Nový `runBackupCheckJob` na druhém cronu (05:00) ověří čerstvost a pošle `sendBackupMissingAlert` při chybějící záloze.

**Tech Stack:** Node.js, better-sqlite3, node-cron, `node:test`, Brevo (email.js).

**Spec:** `docs/superpowers/specs/2026-06-08-backup-heartbeat-design.md`

**Konvence projektu (dodržuj):**
- Testy: `node --test <soubor>` (framework `node:test` + `node:assert/strict`). Izolovaná DB viz vzor v `src/services/pushNotify.test.js` (`freshDb()` / `cleanup()`).
- Migrace/tabulky: nový `CREATE TABLE IF NOT EXISTS` do hlavního `db.exec` bloku v `src/db/schema.js`; nové `CREATE INDEX IF NOT EXISTS` vedle ostatních indexů.
- DB singleton: `require('../db/connection')` (viz `src/services/passport.js`).
- Deploy: commituj a pushni do větve `staging`.
- Žádné `any` (JS), čeština v textech.

---

## File Structure

**Nové:**
- `src/services/backupLog.js` — `recordBackup(db, {status, res, err})` + `hasRecentSuccess(db, maxAgeHours)`
- `src/services/backupLog.test.js` — unit testy modulu

**Úpravy:**
- `src/db/schema.js` — tabulka `backup_log` + index
- `src/services/email.js` — přidat `sendBackupMissingAlert`, odebrat `sendBackupSuccessAlert`
- `src/services/scheduler.js` — log výsledku v `runBackupJob`, nový `runBackupCheckJob`, druhý cron, odebrat success-email blok
- `src/services/scheduler.test.js` — pokud existuje, doplnit; jinak nový (test rozhodovací logiky heartbeat přes injekci)
- `.env.example` — `BACKUP_CHECK_CRON`, `BACKUP_MAX_AGE_HOURS`; odebrat/aktualizovat `BACKUP_SUCCESS_EMAIL`

---

## Task 1: Tabulka backup_log + index

**Files:**
- Modify: `src/db/schema.js` (hlavní `db.exec` blok + sekce indexů)
- Test: `src/db/schema.backup-log.test.js` (Create)

- [ ] **Step 1: Write the failing test**

Create `src/db/schema.backup-log.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-schema-backuplog-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('./connection')];
  delete require.cache[require.resolve('./schema')];
  const db = require('./connection');
  require('./schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + s); } catch { /* ok */ } }
}

test('backup_log tabulka má očekávané sloupce', () => {
  const { db, tmp } = freshDb();
  const cols = db.prepare("PRAGMA table_info(backup_log)").all().map(c => c.name);
  cleanup(db, tmp);
  for (const c of ['id', 'status', 'object_key', 'size_bytes', 'pruned_count', 'error', 'created_at']) {
    assert.ok(cols.includes(c), `chybí sloupec ${c}`);
  }
});

test('backup_log: created_at má default (vloží se i bez explicitní hodnoty)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO backup_log (status) VALUES ('success')").run();
  const row = db.prepare("SELECT created_at FROM backup_log LIMIT 1").get();
  cleanup(db, tmp);
  assert.ok(row.created_at, 'created_at je prázdné');
});
```

Pozn.: soubor je v `src/db/`, takže require cesty jsou `./connection` a `./schema`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/db/schema.backup-log.test.js`
Expected: FAIL — `no such table: backup_log`.

- [ ] **Step 3: Add table + index**

V `src/db/schema.js` přidej do hlavního `db.exec(\`...\`)` bloku (vedle ostatních `CREATE TABLE IF NOT EXISTS`):

```sql
    CREATE TABLE IF NOT EXISTS backup_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      status        TEXT NOT NULL,
      object_key    TEXT,
      size_bytes    INTEGER,
      pruned_count  INTEGER,
      error         TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );
```

A k ostatním `CREATE INDEX IF NOT EXISTS` přidej:

```sql
    CREATE INDEX IF NOT EXISTS idx_backup_log_created ON backup_log(created_at);
```

(Pokud schema.js používá více `db.exec` volání místo jednoho velkého stringu, vlož `CREATE TABLE`/`CREATE INDEX` konzistentně se stávajícím stylem.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/db/schema.backup-log.test.js`
Expected: PASS (2 testy).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.js src/db/schema.backup-log.test.js
git commit -m "feat(backup): tabulka backup_log + index"
```

---

## Task 2: Modul backupLog (recordBackup + hasRecentSuccess)

**Files:**
- Create: `src/services/backupLog.js`
- Test: `src/services/backupLog.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/services/backupLog.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-backuplog-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  delete require.cache[require.resolve('./backupLog')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + s); } catch { /* ok */ } }
}

test('recordBackup success zapíše řádek s detaily', () => {
  const { db, tmp } = freshDb();
  const { recordBackup } = require('./backupLog');
  recordBackup(db, { status: 'success', res: { key: 'backups/data-x.db.gz', sizeBytes: 1234, prunedCount: 2 } });
  const row = db.prepare("SELECT * FROM backup_log").get();
  cleanup(db, tmp);
  assert.equal(row.status, 'success');
  assert.equal(row.object_key, 'backups/data-x.db.gz');
  assert.equal(row.size_bytes, 1234);
  assert.equal(row.pruned_count, 2);
  assert.equal(row.error, null);
});

test('recordBackup failure zapíše status a error', () => {
  const { db, tmp } = freshDb();
  const { recordBackup } = require('./backupLog');
  recordBackup(db, { status: 'failure', err: new Error('R2 down') });
  const row = db.prepare("SELECT * FROM backup_log").get();
  cleanup(db, tmp);
  assert.equal(row.status, 'failure');
  assert.equal(row.error, 'R2 down');
  assert.equal(row.object_key, null);
});

test('hasRecentSuccess: true při čerstvém success', () => {
  const { db, tmp } = freshDb();
  const { recordBackup, hasRecentSuccess } = require('./backupLog');
  recordBackup(db, { status: 'success', res: { key: 'k', sizeBytes: 1, prunedCount: 0 } });
  const ok = hasRecentSuccess(db, 3);
  cleanup(db, tmp);
  assert.equal(ok, true);
});

test('hasRecentSuccess: false když je success starší než okno', () => {
  const { db, tmp } = freshDb();
  const { hasRecentSuccess } = require('./backupLog');
  // vlož starý success ručně (10 h zpět) přes SQLite datetime
  db.prepare("INSERT INTO backup_log (status, object_key, created_at) VALUES ('success', 'k', datetime('now', '-10 hours'))").run();
  const ok = hasRecentSuccess(db, 3);
  cleanup(db, tmp);
  assert.equal(ok, false);
});

test('hasRecentSuccess: false když je jen failure řádek', () => {
  const { db, tmp } = freshDb();
  const { recordBackup, hasRecentSuccess } = require('./backupLog');
  recordBackup(db, { status: 'failure', err: new Error('x') });
  const ok = hasRecentSuccess(db, 3);
  cleanup(db, tmp);
  assert.equal(ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/backupLog.test.js`
Expected: FAIL — `Cannot find module './backupLog'`.

- [ ] **Step 3: Implement** `src/services/backupLog.js`

```javascript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/backupLog.test.js`
Expected: PASS (5 testů).

- [ ] **Step 5: Commit**

```bash
git add src/services/backupLog.js src/services/backupLog.test.js
git commit -m "feat(backup): modul backupLog (recordBackup + hasRecentSuccess)"
```

---

## Task 3: Email — přidat sendBackupMissingAlert

**Files:**
- Modify: `src/services/email.js`

Pozn.: `sendBackupSuccessAlert` zde JEN přidáním `sendBackupMissingAlert` zatím neodstraňujeme — `scheduler.js` ho ještě volá. Odstraní se až v Tasku 4 po úpravě scheduleru (žádný rozbitý mezistav).

- [ ] **Step 1: Přidat `sendBackupMissingAlert`**

Nejprve READ `src/services/email.js` (zvlášť `sendBackupFailureAlert` na ~ř. 58 a `module.exports` na ~ř. 90), ať navážeš na stejný styl (adresát `BACKUP_ALERT_EMAIL` → fallback `tomas.strida@gmail.com`, `sendEmail({to, subject, htmlContent})`).

Přidej hned za `sendBackupFailureAlert`:

```javascript
async function sendBackupMissingAlert(maxAgeHours) {
  const to = process.env.BACKUP_ALERT_EMAIL || 'tomas.strida@gmail.com';
  const when = new Date().toISOString();
  await sendEmail({
    to,
    subject: '⚠️ Spendex: nezaznamenána záloha DB',
    htmlContent: `
      <p>Heartbeat kontrola: za posledních ${maxAgeHours} h nedorazila žádná úspěšná záloha databáze Spendex.</p>
      <p><strong>Čas kontroly:</strong> ${when}</p>
      <p>Zkontroluj, že běží proces a zálohovací cron (Railway logy, R2 přístup).</p>
    `,
  });
}
```

A přidej `sendBackupMissingAlert` do `module.exports` (ostatní exporty ponech beze změny, včetně `sendBackupSuccessAlert` — ten odebereme v Tasku 4).

- [ ] **Step 2: Ověř, že se modul načte**

Run: `node -e "const e=require('./src/services/email.js'); console.log(typeof e.sendBackupMissingAlert)"`
Expected: `function`.

- [ ] **Step 3: Commit**

```bash
git add src/services/email.js
git commit -m "feat(backup): sendBackupMissingAlert"
```

---

## Task 4: Scheduler — log výsledku, heartbeat cron, odebrání success e-mailu

**Files:**
- Modify: `src/services/scheduler.js`
- Test: `src/services/scheduler.test.js` (Create — testuje rozhodovací logiku heartbeat bez reálného cronu)

Aktuální `scheduler.js` (pro orientaci): `runBackupJob` volá `createBackup`, na úspěch při `BACKUP_SUCCESS_EMAIL==='1'` pošle `sendBackupSuccessAlert`, na chybu `sendBackupFailureAlert`. `startScheduler` registruje jeden cron `BACKUP_CRON` (default `0 3 * * *`). `shouldSchedule` kontroluje R2 env.

- [ ] **Step 1: Write the failing test**

Create `src/services/scheduler.test.js`. Testujeme novou exportovanou funkci `checkBackupHeartbeat(db, mailer, maxAgeHours)` (čistá rozhodovací logika, mailer injektovaný), ne cron:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-scheduler-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + s); } catch { /* ok */ } }
}

test('checkBackupHeartbeat: čerstvý success → mailer nevolán', async () => {
  const { db, tmp } = freshDb();
  const { recordBackup } = require('./backupLog');
  recordBackup(db, { status: 'success', res: { key: 'k', sizeBytes: 1, prunedCount: 0 } });
  const { checkBackupHeartbeat } = require('./scheduler');
  let calls = 0;
  await checkBackupHeartbeat(db, async () => { calls++; }, 3);
  cleanup(db, tmp);
  assert.equal(calls, 0);
});

test('checkBackupHeartbeat: žádný čerstvý success → mailer volán s maxAge', async () => {
  const { db, tmp } = freshDb();
  const { checkBackupHeartbeat } = require('./scheduler');
  let received = null;
  await checkBackupHeartbeat(db, async (h) => { received = h; }, 3);
  cleanup(db, tmp);
  assert.equal(received, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/scheduler.test.js`
Expected: FAIL — `checkBackupHeartbeat is not a function`.

- [ ] **Step 3: Upravit `src/services/scheduler.js`**

Nahraď obsah souboru tímto (zachovává `shouldSchedule`, mění `runBackupJob`, přidává `checkBackupHeartbeat` + `runBackupCheckJob`, registruje dva crony):

```javascript
'use strict';
const cron = require('node-cron');
const db = require('../db/connection');
const { createBackup } = require('./backup');
const { createR2Client } = require('./r2Client');
const { recordBackup, hasRecentSuccess } = require('./backupLog');
const { sendBackupFailureAlert, sendBackupMissingAlert } = require('./email');

function shouldSchedule(env = process.env) {
  return Boolean(
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET
  );
}

function maxAgeHours(env = process.env) {
  const n = Number(env.BACKUP_MAX_AGE_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

async function runBackupJob() {
  try {
    const r2 = createR2Client();
    const res = await createBackup({ r2 });
    console.log(`[backup] OK ${res.key} (${res.sizeBytes} B, prune ${res.prunedCount})`);
    try {
      recordBackup(db, { status: 'success', res });
    } catch (logErr) {
      console.error('[backup] zápis backup_log selhal:', logErr);
    }
  } catch (err) {
    console.error('[backup] SELHALO:', err);
    try {
      await sendBackupFailureAlert(err);
    } catch (alertErr) {
      console.error('[backup] alert e-mail selhal:', alertErr);
    }
    try {
      recordBackup(db, { status: 'failure', err });
    } catch (logErr) {
      console.error('[backup] zápis backup_log (failure) selhal:', logErr);
    }
  }
}

/**
 * Čistá rozhodovací logika heartbeat kontroly. Pokud chybí čerstvá úspěšná
 * záloha, zavolá mailer(maxAge). Mailer i db injektovatelné (testy).
 */
async function checkBackupHeartbeat(database, mailer, maxAge) {
  if (hasRecentSuccess(database, maxAge)) {
    console.log('[backup] heartbeat OK (čerstvá záloha v backup_log)');
    return;
  }
  console.warn(`[backup] heartbeat: za posledních ${maxAge} h žádná úspěšná záloha — alert`);
  await mailer(maxAge);
}

async function runBackupCheckJob() {
  try {
    await checkBackupHeartbeat(db, sendBackupMissingAlert, maxAgeHours());
  } catch (err) {
    console.error('[backup] heartbeat kontrola selhala:', err);
  }
}

function startScheduler() {
  if (!shouldSchedule()) {
    console.warn('[backup] R2 ENV nenastaveno — cron záloha NEAKTIVNÍ');
    return;
  }
  const expr = process.env.BACKUP_CRON || '0 3 * * *';
  cron.schedule(expr, runBackupJob, { timezone: 'Europe/Prague' });
  console.log(`[backup] cron aktivní: "${expr}" (Europe/Prague)`);

  const checkExpr = process.env.BACKUP_CHECK_CRON || '0 5 * * *';
  cron.schedule(checkExpr, runBackupCheckJob, { timezone: 'Europe/Prague' });
  console.log(`[backup] heartbeat cron aktivní: "${checkExpr}" (Europe/Prague)`);
}

module.exports = { shouldSchedule, startScheduler, runBackupJob, runBackupCheckJob, checkBackupHeartbeat };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/scheduler.test.js`
Expected: PASS (2 testy).

- [ ] **Step 5: Odebrat nyní nepoužívaný `sendBackupSuccessAlert` z `email.js`**

Scheduler už ho nevolá (nová verze ho neimportuje). Smaž celou funkci `sendBackupSuccessAlert` v `src/services/email.js` a odeber ji z `module.exports`. Výsledný export musí obsahovat: `sendEmail, sendVerificationEmail, sendPasswordResetEmail, sendBackupFailureAlert, sendBackupMissingAlert`.

- [ ] **Step 6: Ověř, že nezůstaly mrtvé reference**

Run: `grep -rn "sendBackupSuccessAlert\|BACKUP_SUCCESS_EMAIL" src/`
Expected: prázdné (vše odstraněno).

- [ ] **Step 7: Commit**

```bash
git add src/services/scheduler.js src/services/scheduler.test.js src/services/email.js
git commit -m "feat(backup): heartbeat cron + log výsledku, bez success e-mailu"
```

---

## Task 5: .env.example a docs

**Files:**
- Modify: `.env.example`
- Modify: `docs/push-setup.md` není relevantní — místo toho zkontroluj, zda existuje backup dokumentace; pokud ano, doplň, jinak vlož krátkou poznámku do `.env.example`.

- [ ] **Step 1: Aktualizovat `.env.example`**

READ `.env.example` sekci „Zálohy DB na Cloudflare R2" (~ř. 30–42). Najdi řádek s `BACKUP_SUCCESS_EMAIL` (pokud tam je) a nahraď celou poznámku tímto blokem (zachovej existující R2 proměnné nad tím beze změny):

```
# E-mail při ÚSPĚŠNÉ záloze byl ZRUŠEN (success se jen loguje do tabulky backup_log).
# Heartbeat kontrola: druhý cron ověří, že v DB je čerstvá úspěšná záloha; když ne → warning e-mail.
# BACKUP_CHECK_CRON=0 5 * * *        # čas heartbeat kontroly (default 05:00, 2 h po záloze)
# BACKUP_MAX_AGE_HOURS=3             # okno "čerstvé zálohy" v hodinách (default 3)
```

Pokud `.env.example` obsahoval `BACKUP_SUCCESS_EMAIL=...`, ten řádek odstraň.

- [ ] **Step 2: Ověř konzistenci celé sady testů**

Run: `node --test src/db/schema.backup-log.test.js src/services/backupLog.test.js src/services/scheduler.test.js`
Expected: všechny PASS.

Také ověř, že se aplikace načte:
Run: `node -e "require('./src/services/scheduler.js'); console.log('scheduler loads ok')"`
Expected: `scheduler loads ok`.

- [ ] **Step 3: Commit a push**

```bash
git add .env.example
git commit -m "docs(backup): env pro heartbeat (BACKUP_CHECK_CRON, BACKUP_MAX_AGE_HOURS)"
git push origin staging
```

---

## Self-Review (provedeno při psaní plánu)

- **Spec coverage:** tabulka backup_log (T1), recordBackup+hasRecentSuccess (T2), sendBackupMissingAlert + odebrání success alertu (T3), runBackupJob log+bez success e-mailu / runBackupCheckJob / druhý cron (T4), env BACKUP_CHECK_CRON/BACKUP_MAX_AGE_HOURS + odebrání BACKUP_SUCCESS_EMAIL (T4+T5), failure alert ponechán (T4), error handling recordBackup v try/catch (T4), testy (T1/T2/T4) — vše pokryto. Známé omezení (in-process) je dokumentační, bez tasku.
- **Type/naming konzistence:** `recordBackup(db, {status, res, err})`, `hasRecentSuccess(db, maxAgeHours)`, `checkBackupHeartbeat(db, mailer, maxAge)`, `sendBackupMissingAlert(maxAgeHours)` — konzistentní napříč T2/T3/T4. `res` má `{key, sizeBytes, prunedCount}` shodně s návratem `createBackup` (ověřeno v `src/services/backup.js`).
- **Bez placeholderů:** každý krok má konkrétní kód/příkaz.
- **Pořadí commitů:** Task 3 dočasně nechá `scheduler.js` odkazovat na odebraný `sendBackupSuccessAlert` — Task 4 to opraví. Implementuj T3 a T4 těsně po sobě; mezi nimi appka nestartuje (jen mezi-commit stav). Pokud vadí, lze T3 a T4 sloučit do jednoho commitu.
