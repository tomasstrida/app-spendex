# Sloupec původní AirBank kategorie – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uložit původní AirBank kategorii ke každé importované transakci a zobrazit ji jako skrývatelný sloupec „AirBank kat." v tabulce transakcí.

**Architecture:** Nový nullable sloupec `transactions.ab_category` (idempotentní migrace). Plní se v obou import cestách (`scripts/rebuild.cjs`, `src/routes/import.js`). Stávající prod data doplní nedestruktivní backfill skript párující dle `external_id`. Frontend přidá sloupec do existujícího column pickeru.

**Tech Stack:** Node.js v22 (`better-sqlite3`, vestavěný `node:test`), React/Vite frontend, SQLite. Žádné nové závislosti.

**Spec:** `docs/superpowers/specs/2026-05-17-ab-category-column-design.md`

**Kontext pro implementátora:**
- Plain CommonJS backend, no TS/build. Frontend React + Vite (`client/`). Test runner: `node --test`.
- Single user, `user_id = 1`. Branch `staging` — commit, NEPUSHOVAT (push až na konci/na pokyn).
- Pre-commit hook auto-bumpne verzi + stage VERSION/package.json — normální, nech být.
- Commit zprávy: česky, conventional prefix, trailing `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` přes HEREDOC.
- Prod běží na Railway, DB `/data/data.db` (env `DB_PATH`), přístup přes `railway ssh --service app-spendex --environment production "..."`. Railway ssh NEpřenáší stdin → soubory base64 v argv po 16k chunkách. `sqlite3` CLI v kontejneru NENÍ — vše přes `node`+`better-sqlite3` z `/app`. DB ve WAL módu.
- CSV adresář lokálně: `/Users/tomas/AI/projekt-finance/Airbank-export-komplet-ucty` (10 souborů).
- `external_id` v DB je `<ref>-<účet>` (per účet), shodně musí počítat backfill.
- **Skrývání sloupců už existuje** (`ALL_COLS`, picker, localStorage) — neimplementovat znovu.

## File Structure

| Soubor | Změna | Odpovědnost |
|---|---|---|
| `src/db/schema.js` | modify | přidat ALTER migraci `ab_category` |
| `scripts/rebuild.cjs` | modify | persist `ab_category` v INSERT |
| `src/routes/import.js` | modify | persist `ab_category` v INSERT |
| `scripts/backfill-ab-category.cjs` | create | jednorázový nedestruktivní backfill dle external_id |
| `client/src/pages/TransactionsPage.jsx` | modify | sloupec v ALL_COLS + render + šířka + bump LS_KEY |
| `src/db/schema.test.js` | create | test že migrace přidá sloupec |

---

## Task 1: Migrace schématu + persistence v import cestách

**Files:**
- Modify: `src/db/schema.js`
- Modify: `scripts/rebuild.cjs`
- Modify: `src/routes/import.js`
- Test: `src/db/schema.test.js` (create)

- [ ] **Step 1: Napiš failující test `src/db/schema.test.js`**

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('migrace přidá sloupec transactions.ab_category', () => {
  const tmp = path.join(os.tmpdir(), `spendex-schema-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  const { initSchema } = require('../db/schema');
  initSchema();
  const cols = db.prepare("PRAGMA table_info(transactions)").all().map(c => c.name);
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.ok(cols.includes('ab_category'), `transactions nemá sloupec ab_category; má: ${cols.join(',')}`);
});
```

- [ ] **Step 2: Spusť test, ověř FAIL**

Run: `cd /Users/tomas/app-spendex && node --test src/db/schema.test.js`
Expected: FAIL — assertion „transactions nemá sloupec ab_category". Paste output.

- [ ] **Step 3: Přidej migraci do `src/db/schema.js`**

Najdi tento řádek v poli `migrations`:
```javascript
    'ALTER TABLE transactions ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL',
```
Vlož BEZPROSTŘEDNĚ ZA něj nový řádek:
```javascript
    'ALTER TABLE transactions ADD COLUMN ab_category TEXT',
```

- [ ] **Step 4: Spusť test, ověř PASS**

Run: `cd /Users/tomas/app-spendex && node --test src/db/schema.test.js`
Expected: PASS (1 test). Paste output.

- [ ] **Step 5: Persist v `scripts/rebuild.cjs` — INSERT statement**

Najdi přesně:
```javascript
  const insTx = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (user_id, category_id, amount, currency, date, description, note, source,
       external_id, tx_time, tx_type, counterparty_account, entered_by, place, account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank', ?, ?, ?, ?, ?, ?, ?)
  `);
```
Nahraď za:
```javascript
  const insTx = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (user_id, category_id, amount, currency, date, description, note, source,
       external_id, tx_time, tx_type, counterparty_account, entered_by, place, account_id, ab_category)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank', ?, ?, ?, ?, ?, ?, ?, ?)
  `);
```

- [ ] **Step 6: Persist v `scripts/rebuild.cjs` — run() volání**

Najdi přesně:
```javascript
      const res = insTx.run(USER_ID, cId, t.amount, t.currency, t.date,
        t.description, t.note || '', extId, t.tx_time || null, t.tx_type || null,
        t.counterparty_account || null, t.entered_by || null, t.place || null, accId);
```
Nahraď za:
```javascript
      const res = insTx.run(USER_ID, cId, t.amount, t.currency, t.date,
        t.description, t.note || '', extId, t.tx_time || null, t.tx_type || null,
        t.counterparty_account || null, t.entered_by || null, t.place || null, accId,
        t.ab_category || null);
```

- [ ] **Step 7: Persist v `src/routes/import.js` — INSERT statement**

Najdi přesně:
```javascript
  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (user_id, category_id, amount, currency, date, description, note, source, external_id,
       tx_time, tx_type, counterparty_account, entered_by, place, account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank', ?, ?, ?, ?, ?, ?, ?)
  `);
```
Nahraď za:
```javascript
  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (user_id, category_id, amount, currency, date, description, note, source, external_id,
       tx_time, tx_type, counterparty_account, entered_by, place, account_id, ab_category)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank', ?, ?, ?, ?, ?, ?, ?, ?)
  `);
```

- [ ] **Step 8: Persist v `src/routes/import.js` — insert.run() volání**

Najdi přesně:
```javascript
      const result = insert.run(
        req.user.id, categoryId, t.amount, t.currency, t.date,
        t.description, t.note || '', t.external_id || null,
        t.tx_time || null, t.tx_type || null,
        t.counterparty_account || null, t.entered_by || null, t.place || null,
        resolvedAccountId,
      );
```
Nahraď za:
```javascript
      const result = insert.run(
        req.user.id, categoryId, t.amount, t.currency, t.date,
        t.description, t.note || '', t.external_id || null,
        t.tx_time || null, t.tx_type || null,
        t.counterparty_account || null, t.entered_by || null, t.place || null,
        resolvedAccountId, t.ab_category || null,
      );
```

- [ ] **Step 9: Syntax check obou skriptů**

Run: `cd /Users/tomas/app-spendex && node -c scripts/rebuild.cjs && node -c src/routes/import.js && echo OK`
Expected: `OK`.

- [ ] **Step 10: Re-run full test suite (regrese)**

Run: `cd /Users/tomas/app-spendex && node --test src/db/schema.test.js scripts/seed/seed.test.js scripts/lib/apply-rules.test.js`
Expected: vše pass (1 + 6 + 10). Paste counts.

- [ ] **Step 11: Commit**

```bash
git add src/db/schema.js src/db/schema.test.js scripts/rebuild.cjs src/routes/import.js
git commit -m "$(cat <<'EOF'
feat: persist ab_category na transakci (migrace + obě import cesty)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
Pak `git log --oneline -1` a `git status --short`.

---

## Task 2: Backfill skript pro stávající data

**Files:**
- Create: `scripts/backfill-ab-category.cjs`

- [ ] **Step 1: Vytvoř `scripts/backfill-ab-category.cjs`**

```javascript
'use strict';
/**
 * Jednorázový nedestruktivní backfill transactions.ab_category dle external_id.
 * Env: DB_PATH (povinné), CSV_DIR (povinné), CONFIRM ('1' = COMMIT; jinak dry-run + ROLLBACK).
 * Páruje stejně jako rebuild.cjs: external_id = `<ref>-<účet>`. UPDATE jen řádků
 * s ab_category IS NULL (idempotentní).
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { parseAirBankCSV } = require('../src/utils/csvParser');

const DB_PATH = process.env.DB_PATH;
const CSV_DIR = process.env.CSV_DIR;
const CONFIRM = process.env.CONFIRM === '1';
const USER_ID = 1;

if (!DB_PATH || !CSV_DIR) {
  console.error('DB_PATH a CSV_DIR jsou povinné.');
  process.exit(1);
}

const db = new Database(DB_PATH);

const csvFiles = {};
for (const f of fs.readdirSync(CSV_DIR)) {
  const m = f.match(/airbank_(\d+)/);
  if (m && f.endsWith('.csv')) csvFiles[m[1]] = path.join(CSV_DIR, f);
}

const report = { csv_total: 0, csv_no_ref: 0, updated: 0, no_match: 0 };

db.exec('BEGIN');
try {
  const upd = db.prepare(
    'UPDATE transactions SET ab_category = ? WHERE user_id = ? AND external_id = ? AND ab_category IS NULL'
  );
  for (const [accountNumber, file] of Object.entries(csvFiles)) {
    const txs = parseAirBankCSV(fs.readFileSync(file, 'utf-8'));
    for (const t of txs) {
      report.csv_total++;
      if (!t.external_id) { report.csv_no_ref++; continue; }
      const extId = `${t.external_id}-${accountNumber}`;
      const res = upd.run(t.ab_category || null, USER_ID, extId);
      if (res.changes > 0) report.updated += res.changes;
      else report.no_match++;
    }
  }

  report.remaining_null = db.prepare(
    'SELECT COUNT(*) n FROM transactions WHERE user_id = ? AND ab_category IS NULL'
  ).get(USER_ID).n;

  if (CONFIRM) { db.exec('COMMIT'); console.log('✅ COMMIT (ostrý běh)'); }
  else { db.exec('ROLLBACK'); console.log('🧪 ROLLBACK (dry-run; pro ostrý běh nastav CONFIRM=1)'); }
} catch (e) {
  try { db.exec('ROLLBACK'); } catch { /* žádná aktivní transakce */ }
  console.error('❌ CHYBA, ROLLBACK:', e.message);
  try { db.close(); } catch { /* už zavřeno */ }
  process.exit(1);
}

db.close();
console.log(JSON.stringify(report, null, 2));
```

- [ ] **Step 2: Syntax check**

Run: `cd /Users/tomas/app-spendex && node -c scripts/backfill-ab-category.cjs && echo OK`
Expected: `OK`.

- [ ] **Step 3: Připrav lokální testovací DB se stavem „po rebuildu, ale ab_category NULL"**

```bash
cd /Users/tomas/app-spendex
rm -f /tmp/bf-test.db /tmp/bf-test.db-wal /tmp/bf-test.db-shm
DB_PATH=/tmp/bf-test.db node -e "require('./src/db/schema').initSchema(); console.log('schema OK')"
DB_PATH=/tmp/bf-test.db node -e "require('better-sqlite3')('/tmp/bf-test.db').prepare('INSERT INTO users (id,email) VALUES (1,?)').run('t@e.cz'); console.log('user OK')"
DB_PATH=/tmp/bf-test.db CSV_DIR=/Users/tomas/AI/projekt-finance/Airbank-export-komplet-ucty CONFIRM=1 node scripts/rebuild.cjs | tail -3
node -e "const d=require('better-sqlite3')('/tmp/bf-test.db'); d.prepare('UPDATE transactions SET ab_category=NULL WHERE user_id=1').run(); console.log('nulled ab_category, rows tx:', d.prepare('SELECT COUNT(*) n FROM transactions WHERE user_id=1').get().n);"
```
Expected: rebuild proběhne (COMMIT), poté `nulled ab_category, rows tx: 1012`.

- [ ] **Step 4: Dry-run backfillu na testovací DB**

Run:
```bash
cd /Users/tomas/app-spendex && DB_PATH=/tmp/bf-test.db CSV_DIR=/Users/tomas/AI/projekt-finance/Airbank-export-komplet-ucty node scripts/backfill-ab-category.cjs
```
Expected: `🧪 ROLLBACK (dry-run...)` + JSON kde `csv_total` = 1012, `updated` ≈ 1012, `csv_no_ref` = 0, `no_match` malé/0. (Protože ROLLBACK, `remaining_null` bude stále 1012 — to je OK, měří se před rollbackem.)

- [ ] **Step 5: Ověř že CONFIRM skutečně doplní**

Run:
```bash
cd /Users/tomas/app-spendex && DB_PATH=/tmp/bf-test.db CSV_DIR=/Users/tomas/AI/projekt-finance/Airbank-export-komplet-ucty CONFIRM=1 node scripts/backfill-ab-category.cjs
node -e "const d=require('better-sqlite3')('/tmp/bf-test.db',{readonly:true}); console.log('null po backfillu:', d.prepare('SELECT COUNT(*) n FROM transactions WHERE user_id=1 AND ab_category IS NULL').get().n, '| ukázka:', JSON.stringify(d.prepare('SELECT ab_category, COUNT(*) c FROM transactions WHERE user_id=1 GROUP BY ab_category ORDER BY c DESC LIMIT 5').all()));"
```
Expected: `✅ COMMIT`, poté `null po backfillu: 0` (nebo jen počet bez external_id) a ukázka AB kategorií (Příchozí úhrada, Zábava, Doprava…).

- [ ] **Step 6: Úklid testovací DB**

```bash
rm -f /tmp/bf-test.db /tmp/bf-test.db-wal /tmp/bf-test.db-shm
```

- [ ] **Step 7: Commit**

```bash
git add scripts/backfill-ab-category.cjs
git commit -m "$(cat <<'EOF'
feat: backfill skript pro ab_category dle external_id (nedestruktivní, dry-run default)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
Pak `git log --oneline -1`.

---

## Task 3: Frontend – sloupec v tabulce transakcí

**Files:**
- Modify: `client/src/pages/TransactionsPage.jsx`

- [ ] **Step 1: Přidej sloupec do `ALL_COLS`**

Najdi přesně:
```javascript
  { key: 'category_name',        label: 'Kategorie',       default: true },
```
Nahraď za (přidá nový řádek hned za něj):
```javascript
  { key: 'category_name',        label: 'Kategorie',       default: true },
  { key: 'ab_category',          label: 'AirBank kat.',    default: true },
```

- [ ] **Step 2: Bump localStorage klíče**

Najdi přesně:
```javascript
const LS_KEY = 'spendex_tx_cols';
```
Nahraď za:
```javascript
const LS_KEY = 'spendex_tx_cols_v2';
```

- [ ] **Step 3: Přidej šířku sloupce v `colsToGrid`**

Najdi přesně:
```javascript
    if (c.key === 'category_name') return '140px';
```
Nahraď za:
```javascript
    if (c.key === 'category_name') return '140px';
    if (c.key === 'ab_category') return '130px';
```

- [ ] **Step 4: Přidej render buňky v `renderCell`**

Najdi přesně:
```javascript
    case 'entered_by':
      return <span style={{ fontSize: 13 }}>{tx.entered_by || '—'}</span>;
```
Nahraď za (vlož nový case PŘED `entered_by`):
```javascript
    case 'ab_category':
      return <span className="text-muted" style={{ fontSize: 12 }}>{tx.ab_category || '—'}</span>;
    case 'entered_by':
      return <span style={{ fontSize: 13 }}>{tx.entered_by || '—'}</span>;
```

- [ ] **Step 5: Build ověření (kompiluje se)**

Run: `cd /Users/tomas/app-spendex/client && npm run build 2>&1 | tail -5`
Expected: build projde bez chyby (vznikne `dist/`). Pokud chybí node_modules, nejdřív `npm install` v `client/`.

- [ ] **Step 6: Manuální ověření v prohlížeči (povinné u UI změn)**

```bash
cd /Users/tomas/app-spendex && node src/index.js &   # backend na :3000 (lokální data.db)
cd /Users/tomas/app-spendex/client && npm run dev      # vite dev server
```
V prohlížeči otevři transakce. Ověř:
- Sloupec „AirBank kat." je viditelný defaultně, hned za „Kategorie".
- Column picker (ikona Columns3) ho nabízí a umí skrýt/zobrazit; volba přežije reload (localStorage `spendex_tx_cols_v2`).
- Lokální DB nemusí mít ab_category naplněné → buňky ukazují „—"; to je OK (prod se naplní backfillem). Hlavní je, že sloupec existuje, je na správném místě a picker funguje.

Zastav procesy po ověření (`kill %1` apod.). Pokud nelze UI otestovat (chybí lokální data/účet), napiš to explicitně do reportu místo tvrzení o úspěchu.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/TransactionsPage.jsx
git commit -m "$(cat <<'EOF'
feat: sloupec AirBank kat. v tabulce transakcí (skrývatelný, default viditelný)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
Pak `git log --oneline -1`.

---

## Task 4: Prod rollout (GATE před zápisem)

**Files:** žádné (operační)

- [ ] **Step 1: Re-link Railway (pokud potřeba) + aplikuj migraci na prod**

```bash
railway link --project Spendex --environment production 2>&1 | tail -1
railway ssh --service app-spendex --environment production "cd /app && node -e \"
  const db=require('better-sqlite3')('/data/data.db');
  try { db.exec('ALTER TABLE transactions ADD COLUMN ab_category TEXT'); console.log('ALTER OK'); }
  catch(e){ console.log('ALTER skip:', e.message); }
  console.log('has col:', db.prepare('PRAGMA table_info(transactions)').all().some(c=>c.name==='ab_category'));
\"" 2>&1 | tail -3
```
Expected: `ALTER OK` (nebo `ALTER skip: duplicate column name` pokud již existuje) a `has col: true`.

- [ ] **Step 2: Nahraj backfill skript + csvParser + CSV na prod (base64 chunky)**

```bash
cd /Users/tomas/app-spendex
rm -rf /tmp/bf-stage /tmp/bf_* /tmp/bf-bundle.tar.gz
mkdir -p /tmp/bf-stage/scripts /tmp/bf-stage/src/utils /tmp/bf-stage/csv
cp scripts/backfill-ab-category.cjs /tmp/bf-stage/scripts/
cp src/utils/csvParser.js /tmp/bf-stage/src/utils/
cp /Users/tomas/AI/projekt-finance/Airbank-export-komplet-ucty/*.csv /tmp/bf-stage/csv/
tar -czf /tmp/bf-bundle.tar.gz -C /tmp/bf-stage .
cd /tmp && base64 -i /tmp/bf-bundle.tar.gz | split -b 16k - /tmp/bf_
railway ssh --service app-spendex --environment production "rm -f /tmp/bf.b64; echo cleared" 2>&1 | tail -1
for c in /tmp/bf_*; do CH=$(cat "$c"); railway ssh --service app-spendex --environment production "echo '$CH' >> /tmp/bf.b64 && wc -c < /tmp/bf.b64" 2>&1 | tail -1; done
```
Expected: každý chunk potvrdí rostoucí velikost.

- [ ] **Step 3: Rozbal na prod**

```bash
md5 -q /tmp/bf-bundle.tar.gz
railway ssh --service app-spendex --environment production "
  cd /tmp && base64 -d bf.b64 > bf.tgz && md5sum bf.tgz | cut -d' ' -f1 &&
  rm -rf /tmp/bfx /tmp/bfcsv && mkdir -p /tmp/bfx /tmp/bfcsv &&
  tar -xzf bf.tgz -C /tmp/bfx 2>/dev/null &&
  cp /tmp/bfx/scripts/backfill-ab-category.cjs /app/scripts/ &&
  cp /tmp/bfx/src/utils/csvParser.js /app/src/utils/csvParser.js &&
  cp /tmp/bfx/csv/*.csv /tmp/bfcsv/ &&
  echo 'csv:' \$(ls /tmp/bfcsv/*.csv | wc -l)
" 2>&1 | tail -3
```
Expected: lokální md5 == prod md5sum; `csv: 10`.

- [ ] **Step 4: Prod dry-run backfillu**

```bash
railway ssh --service app-spendex --environment production "cd /app && DB_PATH=/data/data.db CSV_DIR=/tmp/bfcsv node scripts/backfill-ab-category.cjs" 2>&1 | tail -10
```
Expected: `🧪 ROLLBACK` + JSON: `csv_total` 1012, `updated` ≈ 1012, `csv_no_ref` 0, `no_match` malé. `remaining_null` ~1012 (před rollbackem, OK).

- [ ] **Step 5: GATE — vyžádej výslovné schválení uživatele**

Předlož dry-run report. Zeptej se: „Backfill dry-run sedí (doplní ≈1012). Spustit ostře na prod (CONFIRM=1)?" Bez výslovného „ano/jeď" NEPOKRAČUJ na Step 6. (Nedestruktivní UPDATE, ale je to zápis do prod — vyžaduje potvrzení.)

- [ ] **Step 6: Ostrý běh backfillu (po schválení)**

```bash
railway ssh --service app-spendex --environment production "cd /app && DB_PATH=/data/data.db CSV_DIR=/tmp/bfcsv CONFIRM=1 node scripts/backfill-ab-category.cjs" 2>&1 | tail -10
```
Expected: `✅ COMMIT` + JSON, `remaining_null` = 0 (nebo malý počet bez external_id).

- [ ] **Step 7: Nezávislá post-verifikace**

```bash
railway ssh --service app-spendex --environment production "cd /app && node -e \"
const d=require('better-sqlite3')('/data/data.db',{readonly:true});
const nul=d.prepare('SELECT COUNT(*) n FROM transactions WHERE user_id=1 AND ab_category IS NULL').get().n;
const tot=d.prepare('SELECT COUNT(*) n FROM transactions WHERE user_id=1').get().n;
const top=d.prepare('SELECT ab_category, COUNT(*) c FROM transactions WHERE user_id=1 AND ab_category IS NOT NULL GROUP BY ab_category ORDER BY c DESC LIMIT 6').all();
console.log('tx:',tot,'| ab_category NULL:',nul,'| top:',JSON.stringify(top));
\"" 2>&1 | tail -2
```
Expected: `tx: 1012`, `ab_category NULL: 0` (nebo malé), `top` ukáže reálné AB kategorie.

- [ ] **Step 8: Úklid prod helperů**

```bash
railway ssh --service app-spendex --environment production "rm -rf /tmp/bf.b64 /tmp/bf.tgz /tmp/bfx /tmp/bfcsv /app/scripts/backfill-ab-category.cjs; echo cleaned" 2>&1 | tail -1
rm -rf /tmp/bf-stage /tmp/bf_* /tmp/bf-bundle.tar.gz
```
Pozn.: `/app/src/utils/csvParser.js` přepsán identickou verzí (beze změny obsahu) — netřeba vracet.

---

## Task 5: Push + hlášení

- [ ] **Step 1: Git stav**

Run: `git status --short && git log --oneline -4`
Expected: čistý strom vůči této práci (3 commity Tasks 1–3 + spec/plán).

- [ ] **Step 2: Push na staging**

```bash
git push origin staging
```

- [ ] **Step 3: Hlášení uživateli**

Shrň: verzi (z hooku), výsledek prod backfillu (Task 4/Step 7 — počet doplněných, NULL=0), že migrace je na prod aplikovaná. **Zdůrazni:** sloupec se v produkčním UI zobrazí až po deployi frontendu (`staging`→`main`) — nepushovat do `main` bez výslovného „push do prod".

---

## Self-Review (autor plánu)

**Spec coverage:**
- §1.1 migrace → Task 1 Step 3 + test Step 1–4 ✓
- §1.2 persist v rebuild.cjs i import.js → Task 1 Steps 5–8 ✓
- §1.3 API beze změny (`t.*`) → ověřeno v kontextu, žádná úloha netřeba ✓
- §1.4 backfill skript → Task 2 ✓
- §2 frontend (ALL_COLS po category_name, render, šířka, LS bump na _v2) → Task 3 Steps 1–4 ✓
- §3 testy + pořadí nasazení (migrace→commit→backfill→deploy) → Task 1 testy, Task 2 dry-run, Task 4 prod (migrace Step 1 PŘED backfillem Step 6), Task 5 deploy pozn. ✓
- §4 rizika (nedestruktivní, idempotentní, nullable) → backfill `WHERE ab_category IS NULL`, ALTER v try/catch, dry-run default ✓
- §5 mimo rozsah (skrývání už hotové) → nepřidáno ✓

**Placeholder scan:** žádné TBD/TODO; veškerý kód a příkazy konkrétní, přesné old/new stringy pro editace.

**Type consistency:** sloupec `ab_category` (TEXT, nullable) konzistentní napříč schema.js / rebuild.cjs INSERT (16. sloupec, hodnota `t.ab_category || null`) / import.js INSERT (16. sloupec) / backfill (`UPDATE ... ab_category`) / frontend (`tx.ab_category`, klíč `'ab_category'`, label `'AirBank kat.'`). Pořadí placeholderů v obou INSERTech: přidaný `?` je vždy poslední, hodnota přidána jako poslední argument run() — odpovídá pořadí sloupců. `parseAirBankCSV` vrací pole objektů s polem `ab_category` (ověřeno v csvParser.js).

**Známé omezení:** řádky bez `external_id` v CSV nelze backfillem spárovat (report `csv_no_ref`); dle dřívějšího zjištění 0 takových v prod.
