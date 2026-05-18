# Příjmy (automatická detekce) + oprava duplicitních fixních plateb — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na měsíční schůzce se automaticky zobrazují příjmy (Tom / Martin / Sudo nájem) detekované z transakcí, a fixní platby se přestanou dvojitě započítávat.

**Architecture:** Příjmy dostanou stejný model jako fixní platby — konfigurovatelné zdroje (`income_sources`) + sumace skutečných příchozích transakcí z účtů s novou rolí `income`. Detekční logika příjmů i fixních plateb se vytáhne do testovatelných čistých funkcí v `src/utils/`, routery se ztenčí. Fix duplicit = vyřazení transakcí už pokrytých ručním `match_pattern` z dotazu `fromAccounts`.

**Tech Stack:** Node.js + Express, better-sqlite3, `node:test` (vestavěný runner, spouštěno `node --test <soubor>`), React + Vite.

**Spec:** `docs/superpowers/specs/2026-05-18-prijmy-detekce-a-fix-duplicit-design.md`

**Testovací konvence projektu:** testy používají `node:test` + `assert/strict`. DB testy si vytvoří dočasný soubor přes `process.env.DB_PATH`, zavolají `initSchema()`, vloží fixtures, asertují, uklidí (vzor viz `src/db/schema.test.js`). Po každém Tasku commit do větve `staging`.

---

### Task 1: `incomeStatus` v recurring.js

`paymentStatus` penalizuje i příjem výrazně NAD plán (Tom 190k vs plán 140k → ⚠️). Pro příjem chceme: skutečnost ≥ ~plán = ✅, výrazně méně = ⚠️, nic = ❌.

**Files:**
- Modify: `src/utils/recurring.js`
- Test: `src/utils/recurring.test.js`

- [ ] **Step 1: Napsat failing testy**

Přidej na konec `src/utils/recurring.test.js`:

```js
const { incomeStatus } = require('./recurring');

test('incomeStatus: žádná transakce → missing', () => {
  assert.equal(incomeStatus(140000, 0, 0), 'missing');
});

test('incomeStatus: přesně plán → ok', () => {
  assert.equal(incomeStatus(140000, 140000, 1), 'ok');
});

test('incomeStatus: víc než plán → ok (přebytek je v pohodě)', () => {
  assert.equal(incomeStatus(140000, 190000, 1), 'ok');
});

test('incomeStatus: přesně 5 % pod plán → ok (hranice)', () => {
  assert.equal(incomeStatus(140000, 133000, 1), 'ok'); // 140000*0.95
});

test('incomeStatus: těsně pod 5 % → mismatch', () => {
  assert.equal(incomeStatus(140000, 132999, 1), 'mismatch');
});

test('incomeStatus: plán ≤ 0 → null', () => {
  assert.equal(incomeStatus(0, 100, 1), null);
});
```

- [ ] **Step 2: Spustit test, ověřit fail**

Run: `node --test src/utils/recurring.test.js`
Expected: FAIL — `incomeStatus is not a function`

- [ ] **Step 3: Implementovat `incomeStatus`**

V `src/utils/recurring.js` přidej za funkci `paymentStatus` (před `savingsNet`):

```js
/**
 * Stav příjmu za období. Na rozdíl od paymentStatus je přebytek (skutečnost
 * nad plán) v pořádku – penalizuje se jen výpadek pod plán.
 * @returns 'ok' | 'mismatch' | 'missing' | null
 */
function incomeStatus(expected, actual, txCount) {
  if (!(expected > 0)) return null;
  if (!txCount || txCount === 0) return 'missing';
  const floor = expected * (1 - MATCH_TOLERANCE_PCT / 100);
  return actual >= floor ? 'ok' : 'mismatch';
}
```

V `module.exports` přidej `incomeStatus` (vedle `paymentStatus`):

```js
module.exports = {
  MATCH_TOLERANCE_PCT,
  savingsAccount,
  reserveAccount,
  reservePaidPatterns,
  paymentStatus,
  incomeStatus,
  savingsNet,
  reserveBalance,
};
```

> Pozn.: zachovej ostatní stávající exporty beze změny; výše je jen ilustrace umístění `incomeStatus`. Pokud `module.exports` vypadá jinak, jen do něj přidej `incomeStatus`.

- [ ] **Step 4: Spustit test, ověřit pass**

Run: `node --test src/utils/recurring.test.js`
Expected: PASS (všechny testy včetně původních `paymentStatus`)

- [ ] **Step 5: Commit**

```bash
git add src/utils/recurring.js src/utils/recurring.test.js
git commit -m "feat: incomeStatus – stav příjmu (přebytek = ok)"
```

---

### Task 2: Tabulka `income_sources` ve schématu

**Files:**
- Modify: `src/db/schema.js` (uvnitř `initSchema()`, blok `CREATE TABLE IF NOT EXISTS`)
- Test: `src/db/schema.test.js`

- [ ] **Step 1: Napsat failing test**

Přidej na konec `src/db/schema.test.js`:

```js
test('migrace vytvoří tabulku income_sources', () => {
  const tmp = path.join(os.tmpdir(), `spendex-incsrc-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  const { initSchema } = require('../db/schema');
  initSchema();
  const cols = db.prepare("PRAGMA table_info(income_sources)").all().map(c => c.name);
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.deepEqual(
    cols.sort(),
    ['created_at', 'id', 'match_pattern', 'person', 'planned_amount', 'sort_order', 'user_id'].sort()
  );
});
```

- [ ] **Step 2: Spustit test, ověřit fail**

Run: `node --test src/db/schema.test.js`
Expected: FAIL — `income_sources` nemá sloupce (PRAGMA vrátí prázdno)

- [ ] **Step 3: Přidat tabulku do schématu**

V `src/db/schema.js`, do bloku `CREATE TABLE IF NOT EXISTS` (hned za definici tabulky `income`, kolem řádku 104), přidej:

```sql
    CREATE TABLE IF NOT EXISTS income_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      person TEXT NOT NULL,
      planned_amount REAL NOT NULL DEFAULT 0,
      match_pattern TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
```

- [ ] **Step 4: Spustit test, ověřit pass**

Run: `node --test src/db/schema.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.js src/db/schema.test.js
git commit -m "feat: tabulka income_sources"
```

---

### Task 3: Detekční helper `src/utils/income.js`

Čistá funkce: pro každý zdroj sečte příchozí transakce (`amount > 0`) z účtů s rolí `income` za období.

**Files:**
- Create: `src/utils/income.js`
- Test: `src/utils/income.test.js`

- [ ] **Step 1: Napsat failing test**

Vytvoř `src/utils/income.test.js`:

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
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
}

test('incomeSourcesForPeriod: sečte jen amount>0 z účtu role=income v období', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, role) VALUES (10, 1, 'Hlavní', 'income')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, role) VALUES (11, 1, 'Společný', 'spending')").run();
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, sort_order) VALUES (1, 'Tom', 140000, 'Tom - OSVC', 1)").run();
  // v období, role=income, kladná, matchuje → počítá se
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 10, 145000, '2026-04-10', 'Tom - OSVC platba')").run();
  // záporná → nepočítá
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 10, -5000, '2026-04-11', 'Tom - OSVC vratka')").run();
  // jiný účet (spending) → nepočítá
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 11, 9999, '2026-04-12', 'Tom - OSVC')").run();
  // mimo období → nepočítá
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 10, 99999, '2026-02-01', 'Tom - OSVC')").run();

  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].person, 'Tom');
  assert.equal(rows[0].actual, 145000);
  assert.equal(rows[0].tx_count, 1);
  assert.equal(rows[0].status, 'ok');
});

test('incomeSourcesForPeriod: zdroj bez match_pattern → actual 0, status null', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, sort_order) VALUES (1, 'Martin', 20000, NULL, 2)").run();
  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  cleanup(db, tmp);
  assert.equal(rows[0].actual, 0);
  assert.equal(rows[0].tx_count, 0);
  assert.equal(rows[0].status, null);
});
```

- [ ] **Step 2: Spustit test, ověřit fail**

Run: `node --test src/utils/income.test.js`
Expected: FAIL — `Cannot find module './income'`

- [ ] **Step 3: Implementovat helper**

Vytvoř `src/utils/income.js`:

```js
'use strict';
const { getPeriodDates } = require('./period');
const { incomeStatus } = require('./recurring');

/**
 * Vrátí příjmové zdroje uživatele se skutečnou částkou za období.
 * Skutečnost = SUM(amount) z transakcí kde amount>0, účet má roli 'income',
 * datum spadá do období a description LIKE %match_pattern%.
 */
function incomeSourcesForPeriod(db, userId, period, billingDay) {
  const sources = db.prepare(
    'SELECT * FROM income_sources WHERE user_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(userId);

  const { start, end } = getPeriodDates(billingDay, period);
  const matchStmt = db.prepare(`
    SELECT COALESCE(SUM(t.amount), 0) AS actual, COUNT(*) AS tx_count
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.user_id = ? AND a.role = 'income' AND t.amount > 0
      AND t.date >= ? AND t.date <= ?
      AND t.description LIKE '%' || ? || '%'
  `);

  return sources.map(s => {
    if (!s.match_pattern) {
      return { ...s, actual: 0, tx_count: 0, status: null };
    }
    const m = matchStmt.get(userId, start, end, s.match_pattern);
    return {
      ...s,
      actual: m.actual,
      tx_count: m.tx_count,
      status: incomeStatus(s.planned_amount, m.actual, m.tx_count),
    };
  });
}

module.exports = { incomeSourcesForPeriod };
```

- [ ] **Step 4: Spustit test, ověřit pass**

Run: `node --test src/utils/income.test.js`
Expected: PASS (oba testy)

- [ ] **Step 5: Commit**

```bash
git add src/utils/income.js src/utils/income.test.js
git commit -m "feat: incomeSourcesForPeriod – detekce příjmů z transakcí"
```

---

### Task 4: Přepsat router `src/routes/income.js`

Router přestane pracovat s tabulkou `income` (per období) a začne s `income_sources` (per uživatel) + detekcí.

**Files:**
- Modify: `src/routes/income.js` (kompletní přepis obsahu)

- [ ] **Step 1: Přepsat soubor**

Nahraď celý obsah `src/routes/income.js`:

```js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { getUserBillingDay, currentPeriodKey } = require('../utils/period');
const { incomeSourcesForPeriod } = require('../utils/income');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/income?period=YYYY-MM
router.get('/', requireAuth, (req, res) => {
  const billingDay = getUserBillingDay(db, req.user.id);
  const period = req.query.period || currentPeriodKey(billingDay);
  const sources = incomeSourcesForPeriod(db, req.user.id, period, billingDay);
  res.json({ period, sources });
});

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

// DELETE /api/income/:id
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM income_sources WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  db.prepare('DELETE FROM income_sources WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 2: Ověřit, že server nastartuje**

Run: `node -e "require('./src/routes/income.js'); console.log('ok')"`
Expected: výpis `ok` (žádná syntax/route chyba)

- [ ] **Step 3: Commit**

```bash
git add src/routes/income.js
git commit -m "feat: /api/income pracuje s income_sources + detekcí"
```

---

### Task 5: Role `income` pro účty

**Files:**
- Modify: `src/routes/accounts.js:6`
- Modify: `client/src/pages/ImportPage.jsx:8-19` (ROLE_LABELS, ROLE_HINTS)
- Modify: `scripts/seed/seed.test.js` (test rolí účtů)

- [ ] **Step 1: Upravit test rolí v seed.test.js**

V `scripts/seed/seed.test.js` nahraď test `'10 účtů s validní rolí'`:

```js
test('10 účtů s validní rolí, Hlavní má roli income', () => {
  assert.equal(accounts.length, 10);
  for (const a of accounts) assert.ok(['spending', 'fixed', 'ignored', 'income'].includes(a.role), a.name);
  const hlavni = accounts.find(a => a.name === 'Hlavní');
  assert.equal(hlavni.role, 'income');
});
```

- [ ] **Step 2: Spustit test, ověřit fail**

Run: `node --test scripts/seed/seed.test.js`
Expected: FAIL — `Hlavní` má roli `ignored`, ne `income` (toto opravíme v Tasku 7; nech fail viset)

> Tento test zůstane červený až do Tasku 7. Pokračuj — je to záměrná dočasná závislost. Ostatní testy v souboru musí být zelené.

- [ ] **Step 3: Přidat `income` do VALID_ROLES (backend)**

`src/routes/accounts.js`, řádek 6:

```js
const VALID_ROLES = ['spending', 'fixed', 'ignored', 'income'];
```

- [ ] **Step 4: Přidat `income` do labelů (frontend)**

`client/src/pages/ImportPage.jsx`, doplň do `ROLE_LABELS` a `ROLE_HINTS`:

```js
const ROLE_LABELS = {
  spending: 'Výdaje',
  fixed:    'Fixní',
  ignored:  'Ignorovat',
  income:   'Příjmy',
};

const ROLE_HINTS = {
  spending: 'Transakce vstupují do kategorií a budgetů.',
  fixed:    'Transakce jsou fixní výdaje (nájem, energie…), nezapočítávají se do budgetů.',
  ignored:  'Transakce jsou ignorovány (OSVČ, splátky, daně…).',
  income:   'Příchozí platby se sčítají jako příjmy (Tom, Martin, Sudo nájem).',
};
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/accounts.js client/src/pages/ImportPage.jsx scripts/seed/seed.test.js
git commit -m "feat: role účtu 'income' (backend + UI + test)"
```

---

### Task 6: Extrahovat a dedupovat fixní platby

Logika z `GET /api/fixed-expenses` se vytáhne do testovatelné funkce a doplní o dedup proti ručním `match_pattern`.

**Files:**
- Create: `src/utils/fixed-expenses.js`
- Create: `src/utils/fixed-expenses.test.js`
- Modify: `src/routes/fixed-expenses.js:9-63` (GET handler → tenké volání helperu)

- [ ] **Step 1: Napsat failing test**

Vytvoř `src/utils/fixed-expenses.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-fx-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
}

test('fixedExpensesForPeriod: transakce pokrytá ručním match_pattern se NEobjeví jako account-řádek', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, role) VALUES (20, 1, 'Harmonicka-najem', 'fixed')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, sort_order, match_pattern) VALUES (1, 'Nájem Stodůlky', 38126, 1, 'JANA HRDLIČKOVÁ')").run();
  // transakce kterou pokrývá match_pattern výše → NESMÍ se objevit jako account-řádek
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 20, -38126, '2026-04-05', 'JANA HRDLIČKOVÁ')").run();
  // jiná fixní transakce bez pokrytí → SMÍ se objevit jako account-řádek
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 20, -1234, '2026-04-06', 'Něco jiného')").run();

  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);

  const accountRows = rows.filter(r => r.source === 'account');
  assert.equal(accountRows.length, 1);
  assert.equal(accountRows[0].name, 'Něco jiného');
  const manual = rows.find(r => r.source === 'manual');
  assert.equal(manual.name, 'Nájem Stodůlky');
  assert.equal(manual.actual, 38126);
  assert.equal(manual.status, 'ok');
});

test('fixedExpensesForPeriod: bez period vrátí jen manuální položky', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, sort_order, match_pattern) VALUES (1, 'Telefon', 590, 1, NULL)").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, undefined);
  cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'manual');
});
```

- [ ] **Step 2: Spustit test, ověřit fail**

Run: `node --test src/utils/fixed-expenses.test.js`
Expected: FAIL — `Cannot find module './fixed-expenses'`

- [ ] **Step 3: Vytvořit helper s dedup logikou**

Vytvoř `src/utils/fixed-expenses.js`:

```js
'use strict';
const { getPeriodDates, getUserBillingDay } = require('./period');
const { paymentStatus } = require('./recurring');

/**
 * Manuální fixní položky + sumované odchozí transakce z účtů role='fixed'.
 * Account-řádky, jejichž description odpovídá nějakému ručnímu match_pattern,
 * se vynechají (jinak by se nájem/energie počítaly dvakrát).
 */
function fixedExpensesForPeriod(db, userId, period) {
  const manual = db.prepare(
    "SELECT *, 'manual' as source FROM fixed_expenses WHERE user_id = ? ORDER BY sort_order ASC, id ASC"
  ).all(userId);

  if (!period) return manual;

  const billingDay = getUserBillingDay(db, userId);
  const { start, end } = getPeriodDates(billingDay, period);

  const matchStmt = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) AS actual, COUNT(*) AS tx_count
    FROM transactions
    WHERE user_id = ? AND amount < 0 AND date >= ? AND date <= ?
      AND description LIKE '%' || ? || '%'
  `);

  const manualWithStatus = manual.map(row => {
    if (!row.match_pattern) return row;
    const m = matchStmt.get(userId, start, end, row.match_pattern);
    return {
      ...row,
      actual: m.actual,
      tx_count: m.tx_count,
      status: paymentStatus(row.amount, m.actual, m.tx_count),
    };
  });

  const patterns = manual.map(m => m.match_pattern).filter(Boolean);
  const excludeSql = patterns.length
    ? ' AND NOT (' + patterns.map(() => "t.description LIKE '%' || ? || '%'").join(' OR ') + ')'
    : '';

  const fromAccounts = db.prepare(`
    SELECT
      NULL as id,
      t.description as name,
      SUM(ABS(t.amount)) as amount,
      NULL as note,
      0 as sort_order,
      'account' as source,
      a.name as account_name,
      a.id as account_id
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.user_id = ?
      AND a.role = 'fixed'
      AND t.amount < 0
      AND t.date >= ? AND t.date <= ?${excludeSql}
    GROUP BY t.description, a.id
    ORDER BY a.name ASC, SUM(ABS(t.amount)) DESC
  `).all(userId, start, end, ...patterns);

  return [...manualWithStatus, ...fromAccounts];
}

module.exports = { fixedExpensesForPeriod };
```

- [ ] **Step 4: Spustit test, ověřit pass**

Run: `node --test src/utils/fixed-expenses.test.js`
Expected: PASS (oba testy)

- [ ] **Step 5: Ztenčit GET handler v routeru**

V `src/routes/fixed-expenses.js` nahraď celý `GET /` handler (řádky 9–63, od komentáře `// GET /api/fixed-expenses` po jeho uzavírací `});`) tímto:

```js
const { fixedExpensesForPeriod } = require('../utils/fixed-expenses');

// GET /api/fixed-expenses?period=YYYY-MM
router.get('/', requireAuth, (req, res) => {
  res.json(fixedExpensesForPeriod(db, req.user.id, req.query.period));
});
```

Ostatní handlery (POST/PATCH/DELETE) ponech beze změny.

- [ ] **Step 6: Ověřit, že router nastartuje**

Run: `node -e "require('./src/routes/fixed-expenses.js'); console.log('ok')"`
Expected: výpis `ok`

- [ ] **Step 7: Commit**

```bash
git add src/utils/fixed-expenses.js src/utils/fixed-expenses.test.js src/routes/fixed-expenses.js
git commit -m "fix: fixní platby – dedup account-řádků proti ručnímu match_pattern"
```

---

### Task 7: Seed `income_sources` + role Hlavní = income + rebuild

**Files:**
- Create: `scripts/seed/income-sources.js`
- Modify: `scripts/seed/accounts.js` (Hlavní → role `income`)
- Modify: `scripts/rebuild.cjs` (wipe + insert income_sources)
- Modify: `scripts/seed/seed.test.js` (tvar income-sources)

- [ ] **Step 1: Doplnit test tvaru income-sources**

V `scripts/seed/seed.test.js`:
- nahoře přidej require: `const incomeSources = require('./income-sources');`
- přidej nový test:

```js
test('income-sources: 3 zdroje s patternem a kladným plánem', () => {
  assert.equal(incomeSources.length, 3);
  const persons = incomeSources.map(s => s.person);
  assert.deepEqual(persons, ['Tom', 'Martin', 'Sudo nájem']);
  for (const s of incomeSources) {
    assert.ok(s.match_pattern && s.match_pattern.length > 0, s.person);
    assert.ok(s.planned_amount > 0, s.person);
    assert.ok(Number.isInteger(s.sort_order), s.person);
  }
});
```

- [ ] **Step 2: Spustit test, ověřit fail**

Run: `node --test scripts/seed/seed.test.js`
Expected: FAIL — `Cannot find module './income-sources'`

- [ ] **Step 3: Vytvořit seed data**

Vytvoř `scripts/seed/income-sources.js`:

```js
'use strict';
module.exports = [
  { person: 'Tom',        match_pattern: 'Tom - OSVC',   planned_amount: 140000, sort_order: 1 },
  { person: 'Martin',     match_pattern: 'Bísek Libor',  planned_amount: 20000,  sort_order: 2 },
  { person: 'Sudo nájem', match_pattern: 'Tomáš Střída', planned_amount: 21000,  sort_order: 3 },
];
```

- [ ] **Step 4: Přepnout Hlavní na roli income**

V `scripts/seed/accounts.js` změň řádek s účtem Hlavní:

```js
  { account_number: '1679014138', name: 'Hlavní', role: 'income' },
```

- [ ] **Step 5: Spustit seed testy, ověřit pass**

Run: `node --test scripts/seed/seed.test.js`
Expected: PASS — včetně testu z Tasku 5 (`Hlavní má roli income`) a nového income-sources testu

- [ ] **Step 6: Zapojit do rebuild.cjs**

V `scripts/rebuild.cjs`:

a) k ostatním require (poblíž `const income = require('./seed/income');`, ~ř. 18) přidej:

```js
const incomeSources = require('./seed/income-sources');
```

b) do seznamu mazaných tabulek (~ř. 59–60, pole s `'fixed_expenses', 'income'`) přidej `'income_sources'`:

```js
    'airbank_category_mappings', 'transactions', 'fixed_expenses', 'income', 'income_sources',
    'accounts', 'categories']) {
```

c) za blok vkládající `income` (po smyčce s `insInc`, ~ř. 100) přidej:

```js
  const insIncSrc = db.prepare('INSERT INTO income_sources (user_id, person, planned_amount, match_pattern, sort_order) VALUES (?, ?, ?, ?, ?)');
  for (const s of incomeSources) insIncSrc.run(USER_ID, s.person, s.planned_amount, s.match_pattern, s.sort_order);
```

d) do souhrnného počítadla (objekt s `income: db.prepare(...)`, ~ř. 150) přidej řádek:

```js
    income_sources: db.prepare('SELECT COUNT(*) n FROM income_sources WHERE user_id=?').get(USER_ID).n,
```

- [ ] **Step 7: Ověřit rebuild lokálně (smoke)**

Run: `node -e "require('./scripts/seed/income-sources'); require('./scripts/seed/accounts'); console.log('seed moduly ok')"`
Expected: `seed moduly ok`

> Plný `node scripts/rebuild.cjs` nespouštěj automaticky — přepsal by lokální `data.db`. Spustí ho uživatel/operátor vědomě (lokálně i na prod přes railway ssh — viz paměť „Prod data propagation").

- [ ] **Step 8: Commit**

```bash
git add scripts/seed/income-sources.js scripts/seed/accounts.js scripts/rebuild.cjs scripts/seed/seed.test.js
git commit -m "feat: seed income_sources + Hlavní role income + rebuild zapojení"
```

---

### Task 8: Frontend — sekce Příjmy v ReportPage

Sekci „Příjmy" přepíšeme z ručních per-období záznamů na zdroje (plán vs. skutečnost), vizuál jako „Fixní platby".

**Files:**
- Modify: `client/src/pages/ReportPage.jsx`

- [ ] **Step 1: Nahradit `IncomeForm` za `IncomeSourceForm`**

V `client/src/pages/ReportPage.jsx` nahraď celou komponentu `IncomeForm` (od `// ── Formulář příjmů` po její uzavírací `}` před `// ── Hlavní stránka`) tímto:

```jsx
// ── Formulář příjmových zdrojů ────────────────────────────────────────────────

function IncomeSourceForm({ initial, onSave, onCancel }) {
  const isNew = !initial;
  const [person, setPerson] = useState(initial?.person || '');
  const [planned, setPlanned] = useState(initial?.planned_amount != null ? String(initial.planned_amount) : '');
  const [matchPattern, setMatchPattern] = useState(initial?.match_pattern || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!person.trim()) { setError('Zadejte jméno / zdroj.'); return; }
    setSaving(true); setError('');
    try {
      const method = isNew ? 'POST' : 'PATCH';
      const url = isNew ? '/api/income' : `/api/income/${initial.id}`;
      const body = {
        person: person.trim(),
        planned_amount: parseFloat(planned) || 0,
        match_pattern: matchPattern.trim() || null,
      };
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Chyba.'); return; }
      onSave(d);
    } catch { setError('Chyba připojení.'); }
    finally { setSaving(false); }
  }

  return (
    <form className="income-form" onSubmit={handleSubmit}>
      {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="income-form-row">
        <input className="input" placeholder="Kdo / zdroj (Tom, Martin, Sudo nájem…)"
          value={person} onChange={e => setPerson(e.target.value)} autoFocus style={{ flex: 1 }} />
        <input className="input" type="number" min="0" step="1" placeholder="Plán"
          value={planned} onChange={e => setPlanned(e.target.value)} style={{ maxWidth: 130 }} />
        <input className="input" placeholder="Pattern transakce (volitelně)"
          value={matchPattern} onChange={e => setMatchPattern(e.target.value)} style={{ maxWidth: 200 }} />
        <button type="submit" className="btn btn-primary btn-icon" disabled={saving}><Check size={15} /></button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onCancel}><X size={15} /></button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Upravit state a fetch v `ReportPage`**

V komponentě `ReportPage`:

a) přejmenuj stav příjmů:

```jsx
  const [incomeSources, setIncomeSources] = useState([]);
```
(nahrazuje `const [income, setIncome] = useState([]);`)

b) ve `Promise.all` výsledku změň zpracování příjmů:

```jsx
    }).then(([inc, fixed, bud, st]) => {
      setIncomeSources(inc.sources || []);
      setFixedExpenses(Array.isArray(fixed) ? fixed : []);
      setBudgets((bud.budgets || []).filter(b => !b.category_type || b.category_type === 1));
      setPeriodStart(bud.period_start);
      setPeriodEnd(bud.period_end);
      setStats(st);
    }).finally(() => setLoading(false));
```

- [ ] **Step 3: Upravit handlery a odvozené hodnoty**

a) nahraď `handleIncomeSaved` a `handleDeleteIncome`:

```jsx
  function handleIncomeSaved(row) {
    if (editIncome) {
      setIncomeSources(prev => prev.map(i => i.id === row.id ? { ...i, ...row } : i));
      setEditIncome(null);
    } else {
      setIncomeSources(prev => [...prev, { ...row, actual: 0, tx_count: 0, status: null }]);
      setShowIncomeForm(false);
    }
  }

  async function handleDeleteIncome(id) {
    if (!confirm('Smazat tento příjmový zdroj?')) return;
    const r = await fetch(`/api/income/${id}`, { method: 'DELETE' });
    if (r.ok) setIncomeSources(prev => prev.filter(i => i.id !== id));
  }
```

b) nahraď výpočet `totalIncome` a smaž `usedPersons`:

```jsx
  const totalIncome = incomeSources.reduce((s, i) => s + (i.actual || 0), 0);
```
(odstraň řádek `const usedPersons = income.map(i => i.person);`)

- [ ] **Step 4: Přepsat JSX sekce „Příjmy"**

Nahraď celý `<section className="report-section">` blok PŘÍJMY (od `{/* ── PŘÍJMY ── */}` po jeho uzavírací `</section>`) tímto:

```jsx
          {/* ── PŘÍJMY ── */}
          <section className="report-section">
            <div className="report-section-header">
              <h2 className="report-section-title">Příjmy</h2>
              {!showIncomeForm && !editIncome && (
                <button className="btn btn-ghost btn-sm" onClick={() => setShowIncomeForm(true)}>
                  <Plus size={14} /> Přidat
                </button>
              )}
            </div>
            {showIncomeForm && !editIncome && (
              <IncomeSourceForm onSave={handleIncomeSaved} onCancel={() => setShowIncomeForm(false)} />
            )}
            {incomeSources.length === 0 && !showIncomeForm ? (
              <p className="text-muted" style={{ fontSize: 13 }}>
                Žádné příjmové zdroje. Přidejte Tom / Martin / Sudo nájem.
              </p>
            ) : (
              <div className="report-income-list">
                {incomeSources.map(row => (
                  editIncome?.id === row.id ? (
                    <IncomeSourceForm key={row.id} initial={row}
                      onSave={handleIncomeSaved} onCancel={() => setEditIncome(null)} />
                  ) : (
                    <div key={row.id} className="report-income-row">
                      {row.status && <span title={row.status}>{FIXED_STATUS[row.status].icon}</span>}
                      <span className="report-income-person">{row.person}</span>
                      {row.status === 'mismatch' && (
                        <span className="text-muted" style={{ fontSize: 12 }}>
                          {row.actual > row.planned_amount ? '+' : '−'}
                          {formatCurrency(Math.abs(row.actual - row.planned_amount))} oproti plánu
                          {row.tx_count > 1 ? ` · ${row.tx_count} platby` : ''}
                        </span>
                      )}
                      {row.status === 'missing' && (
                        <span className="text-muted" style={{ fontSize: 12 }}>nepřišlo</span>
                      )}
                      <span className="report-income-amount">{formatCurrency(row.actual || 0)}</span>
                      <button className="btn btn-ghost btn-icon"
                        onClick={() => { setShowIncomeForm(false); setEditIncome(row); }}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn-ghost btn-icon" onClick={() => handleDeleteIncome(row.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )
                ))}
              </div>
            )}
            <div className="report-subtotal">
              <span>Příjmy celkem</span>
              <span>{formatCurrency(totalIncome)}</span>
            </div>
          </section>
```

> `FIXED_STATUS` (✅/⚠️/❌) i klíče `ok|mismatch|missing` jsou sdílené s fixními platbami — `incomeStatus` vrací stejné klíče, takže mapa funguje beze změny.

- [ ] **Step 5: Build klienta, ověřit, že projde**

Run: `npm run build`
Expected: Vite build skončí úspěšně, žádná chyba o nedefinovaném `income` / `IncomeForm` / `usedPersons`.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/ReportPage.jsx
git commit -m "feat: sekce Příjmy – zdroje plán vs. skutečnost (vizuál jako fixní platby)"
```

---

### Task 9: Integrační ověření + push

**Files:** žádné nové (ověření).

- [ ] **Step 1: Spustit všechny relevantní testy**

Run:
```bash
node --test src/utils/recurring.test.js src/utils/income.test.js src/utils/fixed-expenses.test.js src/db/schema.test.js scripts/seed/seed.test.js
```
Expected: všechny PASS, 0 fail.

- [ ] **Step 2: Smoke build + start kontrola requirů**

Run:
```bash
node -e "require('./src/routes/income.js'); require('./src/routes/fixed-expenses.js'); require('./src/routes/accounts.js'); console.log('routery ok')" && npm run build
```
Expected: `routery ok` a úspěšný Vite build.

- [ ] **Step 3: Push do staging**

```bash
git push origin staging
```
Expected: Railway nasadí staging.

- [ ] **Step 4: Manuální ověření na staging (uživatel)**

Předej uživateli kontrolní seznam:
1. V **Importu** přiřadit účtu **Hlavní** roli **Příjmy** (pokud rebuild ještě neproběhl) — jinak budou příjmy 0.
2. Na **Schůzce** sekce Příjmy ukazuje Tom / Martin / Sudo nájem se skutečnými částkami a stavem ✅/⚠️/❌.
3. Fixní platby už neobsahují „JANA HRDLIČKOVÁ" ani „Pražská energetika, a.s."; `Fixní platby celkem` ≈ 57 916 Kč (ne 99 542).
4. „Příjmy celkem" a „Bilance" sedí.

> Pozn.: prod/staging data se pečou při rebuildu — samotný deploy kódu příjmy nenaplní ani nepřepne roli účtu. Rebuild spustí operátor vědomě (viz paměť „Prod data propagation").

---

## Self-review

- **Spec coverage:** Část A (tabulka income_sources → T2; detekce → T3; router → T4; role income → T5; seed/rebuild → T7; UI → T8; bilance → T8 step 3). Část B (dedup fixních → T6). `incomeStatus` riziko ze specu → T1. Account scoping rolí `income` → T3 (SQL `a.role='income'`) + T5 + T7. Vše pokryto.
- **Placeholder scan:** žádné TBD/TODO; každý krok má konkrétní kód a příkaz s očekávaným výstupem.
- **Type/název konzistence:** `income_sources` sloupce (`person`, `planned_amount`, `match_pattern`, `sort_order`) konzistentní napříč T2/T3/T4/T7/T8. API odpověď `{ period, sources }` konzistentní mezi T4 a T8 (`inc.sources`). `incomeStatus` klíče `ok|mismatch|missing|null` shodné s `FIXED_STATUS` mapou v T8. `fixedExpensesForPeriod(db, userId, period)` signatura shodná T6 helper i router.
- **Záměrná dočasná závislost:** seed.test.js test rolí (T5 step 1–2) je červený do T7 step 5 — explicitně označeno.
