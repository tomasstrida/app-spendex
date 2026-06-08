# AirBank API cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Odstranit mrtvý kód po staré AirBank OAuth auto-pull integraci: tabulku `airbank_tokens` (s aktivním DROPem na stávajících DB) a env placeholdery `AIRBANK_CLIENT_*`.

**Architecture:** Odebrat `CREATE TABLE airbank_tokens` z `schema.js` a přidat `DROP TABLE IF EXISTS airbank_tokens` do pole migrací (smaže tabulku i ze stávajících prod/staging DB). Vyčistit `.env.example`. Žádné živé flow se nedotýká.

**Tech Stack:** better-sqlite3, `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-08-airbank-api-cleanup-design.md`

**Ověřeno:** `airbank_tokens` + `AIRBANK_CLIENT_*` + `access_token`/`refresh_token` se vyskytují VÝHRADNĚ v `schema.js`/`.env.example` (grep). Žádné READ/WRITE/OAuth jinde.

---

## Task 1: Odstranit airbank_tokens tabulku + DROP migrace + test

**Files:**
- Modify: `src/db/schema.js` (CREATE blok ~ř. 57–66; pole migrací končící `];` ~ř. 280)
- Test: `src/db/schema.airbank-cleanup.test.js` (Create)

- [ ] **Step 1: Write the failing test**

Create `src/db/schema.airbank-cleanup.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-airbank-cleanup-${Date.now()}-${Math.random()}.db`);
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

test('airbank_tokens tabulka po initSchema NEEXISTUJE (čerstvá DB)', () => {
  const { db, tmp } = freshDb();
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='airbank_tokens'").get();
  cleanup(db, tmp);
  assert.equal(row, undefined);
});

test('DROP migrace smaže existující airbank_tokens (simulace staré DB)', () => {
  const { db, tmp } = freshDb();
  // Simuluj starou DB: ručně vytvoř tabulku a znovu spusť migrace.
  db.prepare("CREATE TABLE IF NOT EXISTS airbank_tokens (id INTEGER PRIMARY KEY, access_token TEXT)").run();
  db.prepare("INSERT INTO airbank_tokens (access_token) VALUES ('stale-secret')").run();
  // Znovu aplikuj schema (idempotentní migrace včetně DROP).
  delete require.cache[require.resolve('./schema')];
  require('./schema').initSchema();
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='airbank_tokens'").get();
  cleanup(db, tmp);
  assert.equal(row, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/db/schema.airbank-cleanup.test.js`
Expected: FAIL — první test selže, protože `airbank_tokens` se zatím vytváří (`CREATE TABLE` je v schema.js).

- [ ] **Step 3: Odebrat CREATE TABLE airbank_tokens**

V `src/db/schema.js` smaž celý blok (ř. 57–66 + okolní prázdný řádek):

```sql
    CREATE TABLE IF NOT EXISTS airbank_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER,
      account_id TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
```

- [ ] **Step 4: Přidat DROP do pole migrací**

V `src/db/schema.js` do pole migrací (poslední položka před uzavírajícím `];` ~ř. 280, hned za `'ALTER TABLE income_sources ADD COLUMN account_id ...'`) přidej:

```javascript
    'DROP TABLE IF EXISTS airbank_tokens',
```

Pozn.: migrace běží ve try/catch loopu po hlavním `db.exec` bloku — DROP tak doběhne i na stávajících DB, kde tabulka existuje. Na čerstvé DB (kde už ji nevytváříme) je `IF EXISTS` no-op.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test src/db/schema.airbank-cleanup.test.js`
Expected: PASS (2 testy).

- [ ] **Step 6: Ověř, že nezůstaly mrtvé reference a celá sada je zelená**

Run: `grep -rn "airbank_tokens" src/ | grep -v "schema.airbank-cleanup.test.js"`
Expected: jediný výskyt — `DROP TABLE IF EXISTS airbank_tokens` v schema.js (žádný CREATE, žádné jiné).

Run: `node --test 'src/**/*.test.js' 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: 0 fail (sada zůstává zelená; přibyly 2 nové testy).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.js src/db/schema.airbank-cleanup.test.js
git commit -m "refactor(cleanup): odstranit mrtvou airbank_tokens tabulku (+ DROP migrace)"
```

---

## Task 2: Vyčistit .env.example

**Files:**
- Modify: `.env.example` (~ř. 21–23)

- [ ] **Step 1: Odebrat AirBank API env**

V `.env.example` smaž tyto tři řádky (a případný osamělý prázdný řádek po nich, ať nevzniknou dvě prázdné za sebou):

```
# Air Bank API
AIRBANK_CLIENT_ID=
AIRBANK_CLIENT_SECRET=
```

- [ ] **Step 2: Ověř, že reference zmizely**

Run: `grep -n "AIRBANK_CLIENT\|Air Bank API" .env.example`
Expected: prázdný výstup.

- [ ] **Step 3: Commit a push**

```bash
git add .env.example
git commit -m "chore(cleanup): odebrat mrtvé AIRBANK_CLIENT env z .env.example"
git push origin staging
```

---

## Task 3: Railway env (ruční, mimo kód)

- [ ] **Step 1: Smazat AIRBANK_CLIENT_ID/SECRET z prod i staging**

```bash
railway variables delete -s app-spendex -e production AIRBANK_CLIENT_ID
railway variables delete -s app-spendex -e production AIRBANK_CLIENT_SECRET
railway variables delete -s app-spendex -e staging AIRBANK_CLIENT_ID
railway variables delete -s app-spendex -e staging AIRBANK_CLIENT_SECRET
```

(Pokud proměnná v daném prostředí není, CLI to ohlásí — neškodné. Před mazáním lze ověřit `railway variables list -s app-spendex -e <env> | grep AIRBANK`.)

---

## Self-Review (provedeno při psaní plánu)

- **Spec coverage:** odstranění CREATE (T1/Step3), DROP migrace (T1/Step4), test neexistence + DROP na staré DB (T1/Step1), .env.example (T2), Railway env (T3) — vše pokryto.
- **Placeholder scan:** žádné; každý krok má konkrétní kód/příkaz.
- **Konzistence:** název tabulky `airbank_tokens` shodný napříč; DROP přidán JEN do migrací, CREATE odebrán z hlavního bloku — žádný konflikt (na čerstvé DB se nevytvoří, takže DROP no-op).
- **Riziko:** DROP je destruktivní vůči `airbank_tokens`, ale tabulka je ověřeně mrtvá (žádné READ/WRITE) a obsahuje max. zbylé OAuth tokeny, jejichž smazání je záměr. Žádná jiná tabulka/flow se nedotýká.
