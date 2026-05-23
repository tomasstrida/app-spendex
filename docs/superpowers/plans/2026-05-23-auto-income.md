# Auto-Příjmy + always-import (Fáze 2) – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schůzka automaticky rozpozná příjmy z importovaných transakcí (bez nutnosti ručních `income_sources`); import vždy ukládá příchozí platby. Ruční zdroje fungují jako volitelný alias/label.

**Architecture:** Backend `src/utils/income.js` přepsán: scanuje incoming transakce (`amount > 0`) napříč všemi uživatelovými účty, vylučuje interní převody (counterparty = vlastní účet s rolí spending/fixed/ignored), seskupí podle counterparty (fallback description), na auto-skupiny aplikuje ruční aliasy z `income_sources` (nové pole `match_counterparty_account` s předností před stávajícím `match_pattern`). Sémantika `accounts.role='income'` přesměrována: nyní znamená „vlastní účet, jehož převody jsou příjem domácnosti" (typicky OSVČ). Frontend ReportPage prakticky beze změny (stejný JSON response), jen skryje Edit/Delete a status ikony pro auto-only řádky. Import: skip_incoming default false, toggle z UI pryč.

**Tech Stack:** Node + Express + better-sqlite3 + `node --test`. React/Vite frontend. Žádné nové dependence.

**Spec:** `docs/superpowers/specs/2026-05-23-auto-income-design.md`

---

## File structure

**Upravit:**
- `src/db/schema.js` — přidat `ALTER TABLE income_sources ADD COLUMN match_counterparty_account TEXT` do migrací.
- `src/utils/income.js` — přepsat `incomeSourcesForPeriod`.
- `src/utils/income.test.js` — nahradit/rozšířit testy pro novou logiku.
- `src/routes/income.js` — POST/PATCH přijímají `match_counterparty_account`.
- `src/routes/import.js` — confirm: default `skip_incoming = false`.
- `client/src/pages/ImportPage.jsx` — odebrat toggle „Přeskočit příchozí", updatovat `ROLE_HINTS`.
- `client/src/pages/ReportPage.jsx` — skrýt Edit/Delete a status pro `id == null`; rozšířit `IncomeSourceForm` o `match_counterparty_account`.

---

## Task 1: Schema migrace – `match_counterparty_account` na `income_sources`

**Files:**
- Modify: `src/db/schema.js`

- [ ] **Step 1: Přidej migraci do `migrations` pole**

V `src/db/schema.js` najdi pole `migrations` (kolem řádky 192 — obsahuje pole stringů `ALTER TABLE ...`). Najdi poslední řádek pole, např.:

```js
    'ALTER TABLE fixed_expenses ADD COLUMN match_pattern TEXT',
```

A přímo ZA něj (uvnitř pole `migrations`) přidej:

```js
    'ALTER TABLE income_sources ADD COLUMN match_counterparty_account TEXT',
```

(Migrace je obalena v `try { db.exec(sql); } catch { /* už existuje */ }` v loopu — bezpečné pro opakované spuštění.)

- [ ] **Step 2: Aplikuj migraci na lokální `data.db`**

```bash
cd /Users/tomas/app-spendex && node -e "require('./src/db/schema').initSchema(); console.log('ok');"
```

Expected: `ok`.

- [ ] **Step 3: Ověř sloupec**

```bash
cd /Users/tomas/app-spendex && node -e "
const db=require('better-sqlite3')('data.db');
console.table(db.prepare('PRAGMA table_info(income_sources)').all().map(c=>({name:c.name,type:c.type})));
"
```

Expected: výpis obsahuje řádek `match_counterparty_account` typu `TEXT`.

- [ ] **Step 4: Commit**

```bash
cd /Users/tomas/app-spendex && git add src/db/schema.js && git commit -m "feat: schema – income_sources.match_counterparty_account

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Přepsat `src/utils/income.js` – auto-detekce + alias

**Files:**
- Modify: `src/utils/income.js`
- Modify (replace tests): `src/utils/income.test.js`

- [ ] **Step 1: Přepiš obsah `src/utils/income.js` (úplná nová verze)**

Nahraď celý obsah `src/utils/income.js` tímto:

```js
'use strict';
const { getPeriodDates } = require('./period');
const { incomeStatus } = require('./recurring');

/**
 * Normalizuje counterparty_account: vezme jen číslice před `/`.
 * Vrátí null pokud vstup prázdný nebo se nepodaří extrahovat číslo.
 */
function normCounterparty(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d+)/);
  return m ? m[1] : null;
}

/**
 * Vrátí příjmy uživatele za období: kombinace auto-detekce z transakcí
 * + případné ruční aliasy z income_sources (na základě match_counterparty_account
 * nebo match_pattern).
 *
 * Pravidla:
 *  - Incoming transakce = amount > 0 na libovolném účtu uživatele.
 *  - Interní převod (vyloučeno): counterparty se shoduje s vlastním účtem
 *    s rolí spending/fixed/ignored.
 *  - Counterparty NEní v účtech, NEBO je v účtech s rolí 'income' → příjem.
 *  - Group key = normalizovaný counterparty, fallback = description.
 *  - Pro každou skupinu vyhledej ruční alias (income_source):
 *      1) match_counterparty_account == group_key (přednost),
 *      2) jinak match_pattern matchuje description některé tx ve skupině.
 *  - Pokud alias: použij person, planned_amount, status; jinak auto-only.
 *  - Ruční zdroje bez auto-shody (planned ale neviděn): vrátit actual=0, status='missing' nebo null.
 */
function incomeSourcesForPeriod(db, userId, period, billingDay) {
  const { start, end } = getPeriodDates(billingDay, period);

  // Načti účty uživatele a roli — k vyloučení interních převodů a k uznání income účtů.
  const accounts = db.prepare(
    'SELECT id, account_number, role FROM accounts WHERE user_id = ? AND account_number IS NOT NULL'
  ).all(userId);
  const internalRoles = new Set(['spending', 'fixed', 'ignored']);
  const internalNumbers = new Set();
  const incomeAccountNumbers = new Set();
  for (const a of accounts) {
    const num = normCounterparty(a.account_number);
    if (!num) continue;
    if (a.role === 'income') incomeAccountNumbers.add(num);
    else if (internalRoles.has(a.role)) internalNumbers.add(num);
  }

  // Načti incoming transakce v období pro uživatele.
  const txs = db.prepare(`
    SELECT id, amount, date, description, counterparty_account
    FROM transactions
    WHERE user_id = ? AND amount > 0 AND date >= ? AND date <= ?
  `).all(userId, start, end);

  // Filtruj na "skutečné příjmy" (vyloučí interní převody mezi spending/fixed/ignored).
  const incomeTxs = txs.filter(t => {
    const cp = normCounterparty(t.counterparty_account);
    if (cp && internalNumbers.has(cp) && !incomeAccountNumbers.has(cp)) return false;
    return true;
  });

  // Seskup podle counterparty (fallback description). Klíč skupiny je string.
  const groups = new Map(); // key -> { key, kind: 'counterparty'|'description', display, total, tx_count, descriptions:Set }
  for (const t of incomeTxs) {
    const cp = normCounterparty(t.counterparty_account);
    const key = cp ? `cp:${cp}` : `desc:${(t.description || '').trim() || '(bez popisu)'}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        counterparty: cp,
        display: cp ? cp : ((t.description || '').trim() || '(bez popisu)'),
        total: 0,
        tx_count: 0,
        descriptions: new Set(),
      };
      groups.set(key, g);
    }
    g.total += t.amount;
    g.tx_count += 1;
    if (t.description) g.descriptions.add(t.description);
  }

  // Načti ruční income_sources a aplikuj alias.
  const sources = db.prepare(
    'SELECT id, person, planned_amount, match_pattern, match_counterparty_account, sort_order FROM income_sources WHERE user_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(userId);
  const usedSourceIds = new Set();

  // Pro každou auto-skupinu najdi první matching alias (counterparty má přednost).
  const groupSource = new Map(); // group.key -> source row
  for (const g of groups.values()) {
    let matched = null;
    if (g.counterparty) {
      matched = sources.find(s => {
        const sn = normCounterparty(s.match_counterparty_account);
        return sn && sn === g.counterparty && !usedSourceIds.has(s.id);
      });
    }
    if (!matched) {
      matched = sources.find(s => {
        if (!s.match_pattern || usedSourceIds.has(s.id)) return false;
        const p = s.match_pattern;
        for (const d of g.descriptions) {
          if (d && d.indexOf(p) >= 0) return true;
        }
        return false;
      });
    }
    if (matched) {
      groupSource.set(g.key, matched);
      usedSourceIds.add(matched.id);
    }
  }

  // Sestav výstupní řádky: nejprve ruční zdroje (po sort_order), pak auto-only skupiny.
  const out = [];
  for (const s of sources) {
    if (!usedSourceIds.has(s.id)) {
      // Ruční zdroj bez auto-shody.
      out.push({
        id: s.id,
        person: s.person,
        planned_amount: s.planned_amount,
        match_pattern: s.match_pattern,
        match_counterparty_account: s.match_counterparty_account,
        actual: 0,
        tx_count: 0,
        status: s.planned_amount > 0 ? incomeStatus(s.planned_amount, 0, 0) : null,
        sort_order: s.sort_order,
      });
    } else {
      // Najdi auto-skupinu, ke které byl tento zdroj přiřazen.
      let g = null;
      for (const [key, src] of groupSource.entries()) {
        if (src.id === s.id) { g = groups.get(key); break; }
      }
      out.push({
        id: s.id,
        person: s.person,
        planned_amount: s.planned_amount,
        match_pattern: s.match_pattern,
        match_counterparty_account: s.match_counterparty_account,
        actual: g.total,
        tx_count: g.tx_count,
        status: s.planned_amount > 0 ? incomeStatus(s.planned_amount, g.total, g.tx_count) : null,
        sort_order: s.sort_order,
      });
    }
  }

  // Auto-only skupiny (bez ruční shody) seřazené sestupně dle total.
  const autoOnly = [];
  for (const [key, g] of groups.entries()) {
    if (groupSource.has(key)) continue;
    autoOnly.push({
      id: null,
      person: g.display,
      planned_amount: null,
      match_pattern: null,
      match_counterparty_account: g.counterparty,
      actual: g.total,
      tx_count: g.tx_count,
      status: null,
      sort_order: null,
    });
  }
  autoOnly.sort((a, b) => b.actual - a.actual);

  return [...out, ...autoOnly];
}

module.exports = { incomeSourcesForPeriod, normCounterparty };
```

- [ ] **Step 2: Nahraď celý obsah `src/utils/income.test.js` novými testy**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-inc-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  delete require.cache[require.resolve('./income')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  try { fs.unlinkSync(tmp); } catch { /* ok */ }
  try { fs.unlinkSync(tmp + '-wal'); } catch { /* ok */ }
  try { fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
}
function seedUser(db) {
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
}

test('auto: incoming z externího protiúčtu (nepatří uživateli) → příjem', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 10, 21000, '2026-04-10', 'Nájem byt', '9876543210')").run();

  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, null);
  assert.equal(rows[0].actual, 21000);
  assert.equal(rows[0].person, '9876543210');
});

test('auto: incoming z vlastního spending účtu (interní transfer) → NENÍ příjem', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (11, 1, 'Společný', '1679014023', 'spending')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 10, 5000, '2026-04-10', 'Transfer', '1679014023')").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 0);
});

test('auto: incoming z vlastního ignored účtu (Spořicí) → NENÍ příjem', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (12, 1, 'Spořicí', '1679014082', 'ignored')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 10, 3000, '2026-04-10', 'Z spořáku', '1679014082')").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 0);
});

test('auto: incoming z vlastního income účtu (OSVČ) → příjem', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (13, 1, 'OSVC', '1679014031', 'income')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 10, 162000, '2026-04-05', 'Tom strida', '1679014031')").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actual, 162000);
  assert.equal(rows[0].id, null);
  assert.equal(rows[0].person, '1679014031');
});

test('alias: income_source s match_counterparty_account → přejmenuje a dá status', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (13, 1, 'OSVC', '1679014031', 'income')").run();
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, match_counterparty_account, sort_order) VALUES (1, 'Tom', 162000, NULL, '1679014031', 1)").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 10, 162000, '2026-04-05', 'Tom strida', '1679014031')").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[0].person, 'Tom');
  assert.equal(rows[0].planned_amount, 162000);
  assert.equal(rows[0].actual, 162000);
  assert.equal(rows[0].status, 'ok');
});

test('alias: match_pattern (legacy) – matchne podle description', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, sort_order) VALUES (1, 'Martin', 20000, 'Bisek', 2)").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 10, 19500, '2026-04-15', 'Bisek vyplata', '5555555555')").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[0].person, 'Martin');
  assert.equal(rows[0].actual, 19500);
});

test('alias: ruční zdroj bez auto-shody → actual 0, status missing', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, sort_order) VALUES (1, 'Sudo', 21000, 'Sudo', 3)").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[0].actual, 0);
  assert.equal(rows[0].status, 'missing');
});

test('izolace mezi uživateli', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'u1@b.cz')").run();
  db.prepare("INSERT INTO users (id, email) VALUES (2, 'u2@b.cz')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (20, 2, 'U2H', '2222222222', 'ignored')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (2, 20, 99999, '2026-04-10', 'foreign', '9876543210')").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows.length, 0);
});
```

- [ ] **Step 3: Spusť testy**

```bash
cd /Users/tomas/app-spendex && node --test src/utils/income.test.js 2>&1 | tail -20
```

Expected: `# pass 8`, `# fail 0`.

- [ ] **Step 4: Commit**

```bash
cd /Users/tomas/app-spendex && git add src/utils/income.js src/utils/income.test.js && git commit -m "feat: utils/income – auto-detekce příjmů + alias z income_sources

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Route `src/routes/income.js` – POST/PATCH přijmou `match_counterparty_account`

**Files:**
- Modify: `src/routes/income.js`

- [ ] **Step 1: POST handler – rozšířit destrukturaci a INSERT**

V `src/routes/income.js` najdi POST handler (kolem řádky 20):

```js
// POST /api/income  body: { person, planned_amount, match_pattern, sort_order }
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { person, planned_amount, match_pattern, sort_order } = req.body;
  if (!person || !person.trim()) {
    return res.status(400).json({ error: 'person je povinný.' });
  }
  const result = db.prepare(
    'INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(
    req.user.id,
    person.trim(),
    parseFloat(planned_amount) || 0,
    match_pattern && match_pattern.trim() ? match_pattern.trim() : null,
    sort_order ?? 0
  );
  res.status(201).json(db.prepare('SELECT * FROM income_sources WHERE id = ?').get(result.lastInsertRowid));
});
```

a změň na:

```js
// POST /api/income  body: { person, planned_amount, match_pattern, match_counterparty_account, sort_order }
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { person, planned_amount, match_pattern, match_counterparty_account, sort_order } = req.body;
  if (!person || !person.trim()) {
    return res.status(400).json({ error: 'person je povinný.' });
  }
  const result = db.prepare(
    'INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, match_counterparty_account, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    req.user.id,
    person.trim(),
    parseFloat(planned_amount) || 0,
    match_pattern && match_pattern.trim() ? match_pattern.trim() : null,
    match_counterparty_account && String(match_counterparty_account).trim() ? String(match_counterparty_account).trim() : null,
    sort_order ?? 0
  );
  res.status(201).json(db.prepare('SELECT * FROM income_sources WHERE id = ?').get(result.lastInsertRowid));
});
```

- [ ] **Step 2: PATCH handler – přijmout `match_counterparty_account`**

Najdi PATCH handler:

```js
// PATCH /api/income/:id
router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM income_sources WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  const { person, planned_amount, match_pattern, sort_order } = req.body;
  db.prepare('UPDATE income_sources SET person = ?, planned_amount = ?, match_pattern = ?, sort_order = ? WHERE id = ?').run(
    person && person.trim() ? person.trim() : row.person,
    planned_amount != null ? parseFloat(planned_amount) : row.planned_amount,
    match_pattern !== undefined ? (match_pattern && match_pattern.trim() ? match_pattern.trim() : null) : row.match_pattern,
    sort_order ?? row.sort_order,
    row.id
  );
  res.json(db.prepare('SELECT * FROM income_sources WHERE id = ?').get(row.id));
});
```

a změň na:

```js
// PATCH /api/income/:id
router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM income_sources WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  const { person, planned_amount, match_pattern, match_counterparty_account, sort_order } = req.body;
  db.prepare('UPDATE income_sources SET person = ?, planned_amount = ?, match_pattern = ?, match_counterparty_account = ?, sort_order = ? WHERE id = ?').run(
    person && person.trim() ? person.trim() : row.person,
    planned_amount != null ? parseFloat(planned_amount) : row.planned_amount,
    match_pattern !== undefined ? (match_pattern && match_pattern.trim() ? match_pattern.trim() : null) : row.match_pattern,
    match_counterparty_account !== undefined
      ? (match_counterparty_account && String(match_counterparty_account).trim() ? String(match_counterparty_account).trim() : null)
      : row.match_counterparty_account,
    sort_order ?? row.sort_order,
    row.id
  );
  res.json(db.prepare('SELECT * FROM income_sources WHERE id = ?').get(row.id));
});
```

- [ ] **Step 3: Ověř syntax**

```bash
cd /Users/tomas/app-spendex && node -c src/routes/income.js && echo "syntax OK"
```

Expected: `syntax OK`.

- [ ] **Step 4: Commit**

```bash
cd /Users/tomas/app-spendex && git add src/routes/income.js && git commit -m "feat: income route – POST/PATCH přijímá match_counterparty_account

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Import confirm – default `skip_incoming = false`

**Files:**
- Modify: `src/routes/import.js`

- [ ] **Step 1: Změň default v destrukturaci**

V `src/routes/import.js` najdi v confirm handleru destrukturaci:

```js
  const { transactions, category_map = {}, skip_incoming = true, account_id = null, raw_csv = null, filename = null } = req.body;
```

a změň na (default `false`):

```js
  const { transactions, category_map = {}, skip_incoming = false, account_id = null, raw_csv = null, filename = null } = req.body;
```

Logika uvnitř smyčky (`if (skip_incoming && t.direction === 'Příchozí') { skipped++; continue; }`) zůstává — pokud klient explicitně pošle `skip_incoming: true`, stále se to respektuje. Default je teď ale opačný.

- [ ] **Step 2: Syntax check**

```bash
cd /Users/tomas/app-spendex && node -c src/routes/import.js && echo "syntax OK"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/tomas/app-spendex && git add src/routes/import.js && git commit -m "feat: import confirm – default skip_incoming=false (importovat příchozí)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend ImportPage – odebrat toggle + update role hints

**Files:**
- Modify: `client/src/pages/ImportPage.jsx`

- [ ] **Step 1: Update `ROLE_HINTS`**

V `client/src/pages/ImportPage.jsx` najdi:

```jsx
const ROLE_HINTS = {
  spending: 'Transakce vstupují do kategorií a budgetů.',
  fixed:    'Transakce jsou fixní výdaje (nájem, energie…), nezapočítávají se do budgetů.',
  ignored:  'Transakce jsou ignorovány (OSVČ, splátky, daně…).',
  income:   'Příchozí platby se sčítají jako příjmy (Tom, Martin, Sudo nájem).',
};
```

a změň na:

```jsx
const ROLE_HINTS = {
  spending: 'Transakce vstupují do kategorií a budgetů.',
  fixed:    'Transakce jsou fixní výdaje (nájem, energie…), nezapočítávají se do budgetů.',
  income:   'Vlastní účet, jehož převody do spending/fixed účtů jsou příjem domácnosti (OSVČ).',
  ignored:  'Účet je mimo evidenci (transit, savings, daně…). Transakce ignorovány v reportech.',
};
```

- [ ] **Step 2: Odstraň `skipIncoming` state a toggle**

Najdi state deklarace (nahoře v `ImportPage`):

```jsx
  const [skipIncoming, setSkipIncoming] = useState(true);
```

a tento řádek **smaž**.

Najdi v `handleConfirm` v POST body:

```jsx
            skip_incoming: skipIncoming,
```

a tento řádek **smaž**.

V JSX (sekce mapping step) najdi:

```jsx
          {/* Příchozí transakce */}
          {incomingCount > 0 && (
            <label className="import-toggle">
              <input
                type="checkbox"
                checked={skipIncoming}
                onChange={e => setSkipIncoming(e.target.checked)}
              />
              <span>Přeskočit příchozí platby ({incomingCount})</span>
            </label>
          )}
```

a celý tento blok **smaž**.

Najdi v computed helper:

```jsx
  const fileNewTx = f => f.transactions.filter(t => !t.duplicate && !(skipIncoming && t.direction === 'Příchozí'));
```

a změň na:

```jsx
  const fileNewTx = f => f.transactions.filter(t => !t.duplicate);
```

(Filtr na incoming odpadá — všechny non-duplicate se importují.)

`incomingCount` přestává být použitý — pokud zbude pouze jeho definice bez consumer, smaž ji taky. Najdi:

```jsx
  const incomingCount = allTx.filter(t => t.direction === 'Příchozí').length;
```

a tento řádek **smaž**.

- [ ] **Step 3: Build**

```bash
cd /Users/tomas/app-spendex/client && npm run build 2>&1 | tail -3
```

Expected: vite build success.

- [ ] **Step 4: Commit**

```bash
cd /Users/tomas/app-spendex && git add client/src/pages/ImportPage.jsx && git commit -m "feat: Import – odstranění toggle Přeskočit příchozí + nové role hinty

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: ReportPage – auto-only řádky bez Edit/Delete/status + form s counterparty polem

**Files:**
- Modify: `client/src/pages/ReportPage.jsx`

- [ ] **Step 1: V `IncomeSourceForm` přidej pole `match_counterparty_account`**

V `client/src/pages/ReportPage.jsx` najdi komponentu `IncomeSourceForm`. State přidat za existující `matchPattern`:

Najdi:
```jsx
  const [matchPattern, setMatchPattern] = useState(initial?.match_pattern || '');
```

a hned za něj přidej:
```jsx
  const [matchCounterparty, setMatchCounterparty] = useState(initial?.match_counterparty_account || '');
```

V `handleSubmit` (uvnitř té samé komponenty) najdi konstrukci `body`. Pokud existuje:
```jsx
    const body = { person: person.trim(), planned_amount: parseFloat(planned) || 0, match_pattern: matchPattern.trim() || null };
```
(přesný řádek může vypadat trochu jinak — najdi řádek tvořící objekt s `match_pattern`), změň jej tak, aby obsahoval i `match_counterparty_account: matchCounterparty.trim() || null`. Příklad cílového tvaru:
```jsx
    const body = {
      person: person.trim(),
      planned_amount: parseFloat(planned) || 0,
      match_pattern: matchPattern.trim() || null,
      match_counterparty_account: matchCounterparty.trim() || null,
    };
```

V JSX té komponenty najdi input pro `matchPattern` (label „Match pattern" nebo podobně) a hned ZA něj přidej nový input:
```jsx
        <div>
          <label className="form-label">Číslo protiúčtu (volitelné)</label>
          <input
            className="input"
            type="text"
            placeholder="např. 1679014031"
            value={matchCounterparty}
            onChange={e => setMatchCounterparty(e.target.value)}
          />
          <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
            Přesná shoda — má přednost před textem popisu.
          </div>
        </div>
```

- [ ] **Step 2: V renderu Příjmů na Schůzce skryj Edit/Delete pro auto-only**

Najdi řádek mapování `incomeSources` v render bloku Příjmů. Tam, kde se renderují tlačítka:

```jsx
                      <button className="btn btn-ghost btn-icon"
                        onClick={() => { setShowIncomeForm(false); setEditIncome(row); }}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn-ghost btn-icon" onClick={() => handleDeleteIncome(row.id)}>
                        <Trash2 size={13} />
                      </button>
```

obal je do podmíněného renderu `row.id != null`:

```jsx
                      {row.id != null && (
                        <>
                          <button className="btn btn-ghost btn-icon"
                            onClick={() => { setShowIncomeForm(false); setEditIncome(row); }}>
                            <Pencil size={13} />
                          </button>
                          <button className="btn btn-ghost btn-icon" onClick={() => handleDeleteIncome(row.id)}>
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
```

- [ ] **Step 3: Skryj status ikony (✅⚠️❌) když `status` je null**

Najdi v renderu Příjmů řádek se status ikonou (typicky):

```jsx
                      {row.status && <span title={row.status}>{FIXED_STATUS[row.status].icon}</span>}
```

(Pokud kód používá jiný styl rendrování statusu, např. switch na `row.status === 'ok'` apod., proveď stejnou úpravu: zobrazuj jen pokud `row.status != null`.)

Tento řádek je už podmíněný na `row.status` truthy — pokud auto-only řádky mají `status: null`, podmínka přirozeně nevykreslí. Ověř — pokud render statusu má jinou logiku, přidej guard `row.status &&`.

Případně najdi sumarizační pruh dole („✅ X přišlo"). Ten používá `incomeSources.filter(i => i.status === '...')`. Auto-only řádky se statusem null se nezapočítají — chování OK, ne kterou změnu.

- [ ] **Step 4: Build**

```bash
cd /Users/tomas/app-spendex/client && npm run build 2>&1 | tail -3
```

Expected: vite build success.

- [ ] **Step 5: Commit**

```bash
cd /Users/tomas/app-spendex && git add client/src/pages/ReportPage.jsx && git commit -m "feat: Schůzka – Příjmy: auto-only bez Edit/Delete + form s číslem protiúčtu

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Ruční konfigurace + ověření + push staging

**Files:** —

- [ ] **Step 1: Lokální konfigurace — nastavit OSVČ účet role='income'**

Otevři aplikaci (`npm run dev` z repo root). Jdi na `/import`, vyber Tom-OSVC v selectoru účtu (nebo jiný účet, kde to dává smysl — uživatel to ví), v dropdownu role změň na **„Vlastní účet, jehož převody do spending/fixed účtů jsou příjem domácnosti (OSVČ)"**. Ulož se automaticky přes PATCH.

Alternativně přímo v DB:
```bash
cd /Users/tomas/app-spendex && node -e "
const db=require('better-sqlite3')('data.db');
db.prepare(\"UPDATE accounts SET role='income' WHERE user_id=1 AND name='Tom-OSVC'\").run();
console.log('OSVC role=income set');
"
```

- [ ] **Step 2: Importuj CSV s incoming platbami (vč. OSVČ → Hlavní) a ověř Schůzku**

Importuj CSV z Hlavního, který obsahuje příchozí platby (OSVČ převod, případně Sudo nájem). Na `/import`:
1. Vyber soubor.
2. Po preview NEMÁ být toggle „Přeskočit příchozí".
3. Vyber účet, confirm.

Na `/report` (Schůzka):
1. V sekci Příjmy vidíš auto-detekované řádky:
   - Řádek z OSVČ převodu (counterparty 1679014031).
   - Sudo nájem (counterparty externí).
2. Žádné Edit/Delete tlačítko u auto-řádků.
3. Žádné status ikony u auto-řádků (planned chybí).
4. Pokud existuje ruční zdroj „Tom" s `match_counterparty_account=1679014031` (vytvoř přes „+ Přidat" formulář), po refreshi se OSVČ řádek přejmenuje na „Tom" + objeví Edit/Delete + případně status.

Edge cases k ověření:
- Spořicí → Hlavní převod v tom samém CSV: NESMÍ se objevit jako příjem.
- Hlavní → Nepravidelné (odchozí na Hlavním = nepatří do incoming filtru): nevadí, není to amount > 0 na Hlavním.

- [ ] **Step 3: Spusť backend testy (smoke)**

```bash
cd /Users/tomas/app-spendex && node --test src/utils/income.test.js src/utils/recurring.test.js src/utils/duplicates.test.js 2>&1 | tail -10
```

Expected: všechny tests pass.

- [ ] **Step 4: Push na staging**

```bash
cd /Users/tomas/app-spendex && git push origin staging
```

Railway nasadí staging. Po deployi proveď stejný scénář na stagingu (vč. konfigurace role='income' na OSVČ v prod DB, případně přes UI).

- [ ] **Step 5: Po úspěšném testu na stagingu počkej na pokyn k prod merge**

Sdělit číslo verze z `package.json` a žádost o pokyn.

---

## Self-review notes

- **Spec coverage:**
  - Schema migrace `match_counterparty_account` → Task 1.
  - Re-purpose `role='income'` jako source-of-income → implicitně v Task 2 (nová logika; existing data without role='income' se chová OK).
  - Auto-detekce příjmů (incoming ne-interní) → Task 2.
  - Alias z `income_sources` s counterparty / pattern fallback → Task 2.
  - Response shape stejný (id null pro auto-only) → Task 2.
  - POST/PATCH přijímá `match_counterparty_account` → Task 3.
  - Always-import (default skip=false, toggle pryč) → Task 4 + Task 5.
  - Role hints update → Task 5.
  - Auto-only bez Edit/Delete/status → Task 6.
  - Form s `match_counterparty_account` polem → Task 6.
  - Manuální ověření vč. role='income' nastavení → Task 7.

- **Placeholder check:** žádné TBD/TODO; veškerý kód je v krocích konkrétní. Test bodů 8.

- **Type consistency:** field `match_counterparty_account` (snake_case) je konzistentní napříč: DB column, POST/PATCH body, util shape, frontend form, util input. Žádný název nesedí.

- **Rizika:**
  - Test setup `freshDb()` musí invalidovat cache `./income` před require — zahrnuto v Step 2 (`delete require.cache[require.resolve('./income')]`).
  - Step 1 v Task 1 závisí na tom, že migrace `try/catch` ošetří situaci, kdy sloupec už existuje. Pattern existuje v `schema.js` (ostatní ALTER TABLE řádky). Bezpečné pro produkci.
  - Step 2 v Task 5 odstraní `skipIncoming` — pokud zůstane nějaká reference (např. dependency v useEffect), build zhavaruje a buildem se zachytí v Step 3.
  - Pokud má `ReportPage.jsx` `IncomeSourceForm` jinou strukturu než předpokládám (např. už dnes drží match_pattern v jiném tvaru), Step 1 v Task 6 vyžaduje adaptaci na reálný kód. Implementér by měl číst stávající formulář, aplikovat pattern.
