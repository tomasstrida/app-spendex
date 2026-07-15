# Opravdový měsíční součet na Schůzce + skutečné fixní platby — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na Schůzce zobrazit aritmeticky uzavřenou měsíční bilanci se skutečnými (proběhlými) fixními platbami a umožnit párování fixní platby přes číslo účtu příjemce.

**Architecture:** Backend rozšíří párování fixních plateb o `match_counterparty_account` (priorita nad textem, vzor převzat z `income_sources`) a vrátí skutečnou částku (`actual`/`tx_count`/`status`) pro každou platbu. Frontend přepočítá součet fixních plateb na skutečnost a překlopí bilanci na uzavřený součet „Zbylo na běžném". Výpočty se vytáhnou do čisté testovatelné funkce.

**Tech Stack:** Node.js + Express, better-sqlite3, React + Vite, `node:test`.

## Global Constraints

- Backend testy: `node --test 'src/**/*.test.js'` — celá sada musí zůstat zelená.
- Client testy: `node --test client/src/utils/*.test.js`.
- Žádný `type: any`; SQLite migrace se přidávají na konec `initSchema()` v `src/db/schema.js` do `try/catch` pole `ALTER TABLE` (žádný migrační framework).
- Jazyk UI: čeština (labely inline nebo v `client/src/i18n.js`, dle stávajícího vzoru na stránce).
- Číslo účtu se páruje prefixově: `counterparty_account LIKE ? || '%'` (bez předčíslí banky), stejně jako `income_sources` a `savingsAccount` v `stats.js`.
- Po dokončení commituj a pushni do větve `staging` (ne `main`).

---

### Task 1: Schema — sloupec `match_counterparty_account`

**Files:**
- Modify: `src/db/schema.js` (pole migrací na konci `initSchema()`, kolem řádku 299–302)
- Test: `src/db/schema.test.js`

**Interfaces:**
- Produces: sloupec `fixed_expenses.match_counterparty_account TEXT` (nullable).

- [ ] **Step 1: Write the failing test**

Přidej do `src/db/schema.test.js` (za blok `fixed_expenses má amount_min/max…`):

```js
test('migrace: fixed_expenses má match_counterparty_account', () => {
  const { db, tmp } = freshDb();
  const cols = db.prepare("PRAGMA table_info(fixed_expenses)").all().map(c => c.name);
  cleanup(db, tmp);
  assert.ok(cols.includes('match_counterparty_account'), 'chybí sloupec match_counterparty_account');
});
```

Pozn.: použij `freshDb`/`cleanup` helpery, které už v souboru jsou (viz existující testy nahoře v souboru). Pokud test soubor helpery nemá pojmenované takto, použij vzor ze začátku souboru.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/db/schema.test.js`
Expected: FAIL — `chybí sloupec match_counterparty_account`.

- [ ] **Step 3: Přidej migraci**

V `src/db/schema.js` do pole `ALTER TABLE` migrací (kde jsou řádky `'ALTER TABLE fixed_expenses ADD COLUMN match_pattern TEXT'` atd.) přidej:

```js
'ALTER TABLE fixed_expenses ADD COLUMN match_counterparty_account TEXT',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/db/schema.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.js src/db/schema.test.js
git commit -m "feat(fixed): sloupec match_counterparty_account pro fixní platby"
```

---

### Task 2: Backend párování — counterparty priorita + skutečná částka pro všechny

**Files:**
- Modify: `src/utils/fixed-expenses.js`
- Test: `src/utils/fixed-expenses.test.js`

**Interfaces:**
- Consumes: `paymentStatus(min, max, actual, txCount)` z `src/utils/recurring.js` (beze změny).
- Produces: `fixedExpensesForPeriod(db, userId, period)` — každá manuální položka s matcherem nese `actual` (number), `tx_count` (number), `status` ('ok'|'mismatch'|'missing'|null). Párování přes `match_counterparty_account` (`counterparty_account LIKE ? || '%'`) má přednost před `match_pattern` (`description LIKE`).

- [ ] **Step 1: Write the failing tests**

Přidej do `src/utils/fixed-expenses.test.js`:

```js
test('fixedExpensesForPeriod: párování přes counterparty_account (priorita nad patternem)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, frequency_months, match_pattern, match_counterparty_account) VALUES (1,'Splátka RAV4',13255,13000,13500,1,'NESEDÍCÍ TEXT','1679014999')").run();
  // popis pattern NEmatchne, ale číslo účtu ano → platba se najde přes účet
  db.prepare("INSERT INTO transactions (user_id, amount, date, description, counterparty_account) VALUES (1,-13255,'2026-04-10','Toyota Financial','1679014999/0300')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  const m = rows.find(r => r.source === 'manual');
  assert.equal(m.actual, 13255);
  assert.equal(m.tx_count, 1);
  assert.equal(m.status, 'ok');
});

test('fixedExpensesForPeriod: platba přes counterparty nepřišla → missing, actual 0', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, frequency_months, match_counterparty_account) VALUES (1,'Splátka',5000,4900,5100,1,'1679014999')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  const m = rows.find(r => r.source === 'manual');
  assert.equal(m.tx_count, 0);
  assert.equal(m.actual, 0);
  assert.equal(m.status, 'missing');
});

test('fixedExpensesForPeriod: account-řádek se nezdvojí s ruční platbou přes číslo účtu', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, role) VALUES (20, 1, 'Harmonicka-najem', 'fixed')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, match_counterparty_account) VALUES (1,'Nájem',38126,37000,39000,'1679014777')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1,20,-38126,'2026-04-05','Platba nájem','1679014777/0300')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  // stejná transakce nesmí být zároveň account-řádek
  assert.equal(rows.filter(r => r.source === 'account').length, 0);
  const m = rows.find(r => r.source === 'manual');
  assert.equal(m.actual, 38126);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/utils/fixed-expenses.test.js`
Expected: FAIL — nové testy (counterparty párování ještě neexistuje; `m.actual` undefined nebo account-řádek se objeví).

- [ ] **Step 3: Implementace párování**

V `src/utils/fixed-expenses.js` nahraď blok od `const matchStmt = db.prepare(...)` po sestavení `fromAccounts` touto verzí (zachovej `shiftPeriod`, `getPeriodDates`, hlavičku funkce beze změny):

```js
  const matchByDesc = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) AS actual, COUNT(*) AS tx_count
    FROM transactions
    WHERE user_id = ? AND amount < 0 AND date >= ? AND date <= ?
      AND description LIKE '%' || ? || '%'
  `);
  const matchByAccount = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) AS actual, COUNT(*) AS tx_count
    FROM transactions
    WHERE user_id = ? AND amount < 0 AND date >= ? AND date <= ?
      AND counterparty_account LIKE ? || '%'
  `);

  const windowEnd = end;  // konec aktuálního období
  const manualWithStatus = manual.map(row => {
    const hasMatcher = row.match_counterparty_account || row.match_pattern;
    if (!hasMatcher) return row;  // po validaci nenastane; bezpečný fallback
    const freq = row.frequency_months > 0 ? row.frequency_months : 1;
    const windowStart = getPeriodDates(billingDay, shiftPeriod(period, -(freq - 1))).start;
    // Číslo účtu příjemce má přednost před textovým patternem.
    const m = row.match_counterparty_account
      ? matchByAccount.get(userId, windowStart, windowEnd, row.match_counterparty_account)
      : matchByDesc.get(userId, windowStart, windowEnd, row.match_pattern);
    return {
      ...row,
      actual: m.actual,
      tx_count: m.tx_count,
      status: paymentStatus(row.amount_min, row.amount_max, m.actual, m.tx_count),
    };
  });

  // Account-řádky (role='fixed') vynech, pokud odpovídají ručnímu matcheru
  // (jinak by se platba počítala dvakrát). Match přes description-pattern i číslo účtu.
  const patterns = manual.map(m => m.match_pattern).filter(Boolean);
  const cpAccounts = manual.map(m => m.match_counterparty_account).filter(Boolean);
  const excludeParts = [
    ...patterns.map(() => "t.description LIKE '%' || ? || '%'"),
    ...cpAccounts.map(() => "t.counterparty_account LIKE ? || '%'"),
  ];
  const excludeSql = excludeParts.length ? ' AND NOT (' + excludeParts.join(' OR ') + ')' : '';

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
  `).all(userId, start, end, ...patterns, ...cpAccounts);

  return [...manualWithStatus, ...fromAccounts];
```

Odstraň starý `const matchStmt = …` a starou verzi `manualWithStatus` / `patterns` / `excludeSql` / `fromAccounts`, kterou tento blok nahrazuje.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/utils/fixed-expenses.test.js`
Expected: PASS (nové i stávající testy v souboru).

- [ ] **Step 5: Commit**

```bash
git add src/utils/fixed-expenses.js src/utils/fixed-expenses.test.js
git commit -m "feat(fixed): párování fixní platby přes číslo účtu příjemce (priorita nad textem)"
```

---

### Task 3: Route — uložení counterparty + validace „aspoň jeden matcher"

**Files:**
- Modify: `src/routes/fixed-expenses.js`
- Test: `src/routes/fixed-expenses.test.js`

**Interfaces:**
- Consumes: sloupec `match_counterparty_account` (Task 1), tabulka `fixed_expenses`.
- Produces: `POST`/`PATCH /api/fixed-expenses` ukládá `match_counterparty_account`; oba vrátí `400 { error: 'Zadej text v popisu nebo číslo účtu příjemce.' }`, když by výsledný záznam neměl ani `match_pattern`, ani `match_counterparty_account`.

- [ ] **Step 1: Uprav existující testy, které POSTují bez matcheru**

Nová validace vyžaduje matcher — existující testy v `src/routes/fixed-expenses.test.js`, které POSTují jen `name+amount(+min/max)`, by nově dostaly 400. Do jejich POST body přidej `match_pattern:'NÁJEM'`:

- `test('POST přijme rozmezí + frekvenci', …)` — do body přidej `match_pattern:'NÁJEM'`.
- `test('POST s min > max → 400', …)` — do body přidej `match_pattern:'NÁJEM'` (test má stále vracet 400, ale kvůli min>max).
- `test('PATCH jen amount_min vyšší než stávající amount_max → 400', …)` — do úvodního POST body přidej `match_pattern:'NÁJEM'`.
- `test('PATCH jen amount_max nižší než stávající amount_min → 400', …)` — do úvodního POST body přidej `match_pattern:'NÁJEM'`.
- `test('PATCH partial update zachová nezadaná pole', …)` — do úvodního POST body přidej `match_pattern:'NÁJEM'`.

- [ ] **Step 2: Write the failing tests**

Přidej do `src/routes/fixed-expenses.test.js`:

```js
test('POST bez matcheru → 400', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Nájem', amount:38000 }) });
  assert.equal(res.status, 400);
  server.close();
});

test('POST s counterparty → 201 a uloží číslo účtu', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Splátka', amount:5000, match_counterparty_account:'1679014999' }) });
  assert.equal(res.status, 201);
  const row = await res.json();
  assert.equal(row.match_counterparty_account, '1679014999');
  server.close();
});

test('PATCH odebrání jediného matcheru → 400', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const postRes = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Splátka', amount:5000, match_pattern:'SPLÁTKA' }) });
  const { id } = await postRes.json();
  const patchRes = await fetch(`${base}/api/fixed-expenses/${id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ match_pattern: null }) });
  assert.equal(patchRes.status, 400);
  server.close();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test src/routes/fixed-expenses.test.js`
Expected: FAIL — validace a ukládání counterparty ještě nejsou.

- [ ] **Step 4: Implementace route**

V `src/routes/fixed-expenses.js`:

**POST** — rozšiř destructuring o `match_counterparty_account`, přidej validaci matcheru a ulož nový sloupec:

```js
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { name, amount, note, sort_order, match_pattern, match_counterparty_account, amount_min, amount_max, frequency_months } = req.body;
  if (!name || amount == null) return res.status(400).json({ error: 'Název a částka jsou povinné.' });
  const pattern = match_pattern && match_pattern.trim() ? match_pattern.trim() : null;
  const cpAccount = match_counterparty_account && String(match_counterparty_account).trim() ? String(match_counterparty_account).trim() : null;
  if (!pattern && !cpAccount) return res.status(400).json({ error: 'Zadej text v popisu nebo číslo účtu příjemce.' });
  const min = amount_min != null ? parseFloat(amount_min) : null;
  const max = amount_max != null ? parseFloat(amount_max) : null;
  if (min != null && max != null && min > max) return res.status(400).json({ error: 'Min nesmí být větší než max.' });
  const freq = frequency_months != null ? Math.max(1, parseInt(frequency_months, 10) || 1) : 1;
  const result = db.prepare(
    'INSERT INTO fixed_expenses (user_id, name, amount, note, sort_order, match_pattern, match_counterparty_account, amount_min, amount_max, frequency_months) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.dataUserId, name.trim(), parseFloat(amount), note || null, sort_order ?? 0,
    pattern, cpAccount, min, max, freq);
  res.status(201).json(db.prepare('SELECT * FROM fixed_expenses WHERE id = ?').get(result.lastInsertRowid));
});
```

**PATCH** — rozšiř destructuring, spočítej výsledné hodnoty matcherů (partial-update vzorem jako u ostatních polí), validuj že aspoň jeden zůstane, a ulož:

```js
router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  const { name, amount, note, sort_order, match_pattern, match_counterparty_account, amount_min, amount_max, frequency_months } = req.body;
  const min = amount_min !== undefined ? (amount_min != null ? parseFloat(amount_min) : null) : row.amount_min;
  const max = amount_max !== undefined ? (amount_max != null ? parseFloat(amount_max) : null) : row.amount_max;
  if (min != null && max != null && min > max) return res.status(400).json({ error: 'Min nesmí být větší než max.' });
  const pattern = match_pattern !== undefined ? (match_pattern && match_pattern.trim() ? match_pattern.trim() : null) : row.match_pattern;
  const cpAccount = match_counterparty_account !== undefined
    ? (match_counterparty_account && String(match_counterparty_account).trim() ? String(match_counterparty_account).trim() : null)
    : row.match_counterparty_account;
  if (!pattern && !cpAccount) return res.status(400).json({ error: 'Zadej text v popisu nebo číslo účtu příjemce.' });
  db.prepare('UPDATE fixed_expenses SET name = ?, amount = ?, note = ?, sort_order = ?, match_pattern = ?, match_counterparty_account = ?, amount_min = ?, amount_max = ?, frequency_months = ? WHERE id = ?').run(
    name ?? row.name,
    amount != null ? parseFloat(amount) : row.amount,
    note !== undefined ? (note || null) : row.note,
    sort_order ?? row.sort_order,
    pattern, cpAccount,
    min, max,
    frequency_months !== undefined ? Math.max(1, parseInt(frequency_months, 10) || 1) : row.frequency_months,
    row.id
  );
  res.json(db.prepare('SELECT * FROM fixed_expenses WHERE id = ?').get(row.id));
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test src/routes/fixed-expenses.test.js`
Expected: PASS (nové i upravené stávající testy).

- [ ] **Step 6: Commit**

```bash
git add src/routes/fixed-expenses.js src/routes/fixed-expenses.test.js
git commit -m "feat(fixed): validace aspoň jednoho matcheru + uložení čísla účtu příjemce"
```

---

### Task 4: Frontend — pole „Číslo účtu příjemce" ve FixedExpensesPage

**Files:**
- Modify: `client/src/pages/FixedExpensesPage.jsx`

**Interfaces:**
- Consumes: `POST`/`PATCH /api/fixed-expenses` s `match_counterparty_account` (Task 3).
- Produces: formulář posílá `match_counterparty_account`; klientská validace vyžaduje aspoň jeden matcher; seznam ukazuje číslo účtu, když je zadané.

- [ ] **Step 1: Přidej pole do stavu formuláře**

V `EMPTY` (řádek 5) přidej klíč `match_counterparty_account: ''`:

```js
const EMPTY = { name: '', amount: '', amount_min: '', amount_max: '', frequency_months: 1, match_pattern: '', match_counterparty_account: '', note: '' };
```

- [ ] **Step 2: Pošli pole v `submit` + klientská validace**

V `submit`, do `body` přidej `match_counterparty_account`, a před `fetch` doplň guard:

```js
    const pattern = form.match_pattern.trim();
    const cpAccount = form.match_counterparty_account.trim();
    if (!pattern && !cpAccount) { setError('Zadej text v popisu nebo číslo účtu příjemce.'); return; }
    const body = {
      name: form.name,
      amount: parseFloat(form.amount),
      amount_min: form.amount_min === '' ? null : parseFloat(form.amount_min),
      amount_max: form.amount_max === '' ? null : parseFloat(form.amount_max),
      frequency_months: parseInt(form.frequency_months, 10) || 1,
      match_pattern: pattern || null,
      match_counterparty_account: cpAccount || null,
      note: form.note || null,
    };
```

- [ ] **Step 3: Načti pole v `edit`**

Ve funkci `edit` do `setForm({…})` přidej:

```js
      match_counterparty_account: it.match_counterparty_account || '',
```

- [ ] **Step 4: Přidej input do formuláře**

Za input `match_pattern` (řádky 115–120) přidej:

```jsx
        <input
          className="input"
          placeholder="Číslo účtu příjemce (volitelné, má přednost)"
          value={form.match_counterparty_account}
          onChange={e => setForm({ ...form, match_counterparty_account: e.target.value })}
        />
```

A pod dvojici matcher-inputů přidej vysvětlivku (za input poznámky nebo pod matchery):

```jsx
        <span className="text-muted" style={{ fontSize: 11 }}>
          Vyplň aspoň jedno: text v popisu, nebo číslo účtu příjemce. Podle toho se pozná, jestli platba proběhla a v jaké částce. Číslo účtu je spolehlivější a má přednost.
        </span>
```

- [ ] **Step 5: Zobraz číslo účtu v seznamu**

V řádku seznamu (řádky 142–146), do drobného popisu přidej za `match_pattern`:

```jsx
                  {it.match_counterparty_account ? ` · účet ${it.match_counterparty_account}` : ''}
```

- [ ] **Step 6: Build klienta pro ověření, že se nic nerozbilo**

Run: `cd client && npm run build`
Expected: build projde bez chyb.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/FixedExpensesPage.jsx
git commit -m "feat(fixed): pole číslo účtu příjemce ve formuláři fixních plateb"
```

---

### Task 5: Client util — skutečný součet fixních plateb + aritmetická bilance

**Files:**
- Create: `client/src/utils/meetingBalance.js`
- Test: `client/src/utils/meetingBalance.test.js`

**Interfaces:**
- Produces:
  - `fixedActualTotal(fixedExpenses)` → number. Account-řádky (`source === 'account'`) se sčítají `amount`; manuální položky jen když proběhly (`tx_count > 0`), a to skutečnou částkou `actual`.
  - `leftoverOnMain({ totalIncome, totalFixed, variablePoolFunded, totalType1, totalType3, savingsNet })` → number = `totalIncome − totalFixed − variablePoolFunded − totalType1 − totalType3 − savingsNet`.

- [ ] **Step 1: Write the failing tests**

Vytvoř `client/src/utils/meetingBalance.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixedActualTotal, leftoverOnMain } from './meetingBalance.js';

test('fixedActualTotal: manuální proběhlá se počítá skutečnou částkou', () => {
  const rows = [{ source: 'manual', amount: 13255, actual: 13100, tx_count: 1 }];
  assert.equal(fixedActualTotal(rows), 13100);
});

test('fixedActualTotal: manuální neproběhlá (tx_count 0) se nezapočítá', () => {
  const rows = [{ source: 'manual', amount: 5000, actual: 0, tx_count: 0 }];
  assert.equal(fixedActualTotal(rows), 0);
});

test('fixedActualTotal: account-řádek se počítá svým amount', () => {
  const rows = [{ source: 'account', amount: 1234 }];
  assert.equal(fixedActualTotal(rows), 1234);
});

test('fixedActualTotal: mix', () => {
  const rows = [
    { source: 'manual', amount: 38126, actual: 38126, tx_count: 1 },
    { source: 'manual', amount: 5000, actual: 0, tx_count: 0 },
    { source: 'account', amount: 200 },
  ];
  assert.equal(fixedActualTotal(rows), 38326);
});

test('leftoverOnMain: aritmetický součet bilance', () => {
  const left = leftoverOnMain({
    totalIncome: 182000, totalFixed: 58126, variablePoolFunded: 5000,
    totalType1: 34210, totalType3: 5400, savingsNet: 80000,
  });
  assert.equal(left, 182000 - 58126 - 5000 - 34210 - 5400 - 80000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test client/src/utils/meetingBalance.test.js`
Expected: FAIL — modul neexistuje.

- [ ] **Step 3: Implementace**

Vytvoř `client/src/utils/meetingBalance.js`:

```js
// Skutečný součet fixních plateb: account-řádky nesou skutečnou sumu z transakcí,
// manuální položky se počítají jen když proběhly (tx_count > 0), skutečnou částkou.
export function fixedActualTotal(fixedExpenses) {
  return (fixedExpenses || []).reduce((s, f) => {
    if (f.source === 'account') return s + (f.amount || 0);
    return s + (f.tx_count > 0 ? (f.actual || 0) : 0);
  }, 0);
}

// Aritmetická měsíční bilance: kolik zbylo na běžném po všech pohybech.
// Interní převody (dotace na Nepravidelné, spoření) jsou vědomě mínus řádky.
export function leftoverOnMain({ totalIncome, totalFixed, variablePoolFunded, totalType1, totalType3, savingsNet }) {
  return totalIncome - totalFixed - variablePoolFunded - totalType1 - totalType3 - savingsNet;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test client/src/utils/meetingBalance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/meetingBalance.js client/src/utils/meetingBalance.test.js
git commit -m "feat(report): util pro skutečný součet fixních plateb a aritmetickou bilanci"
```

---

### Task 6: Frontend — přeskládaná uzavřená bilance na Schůzce

**Files:**
- Modify: `client/src/pages/ReportPage.jsx`

**Interfaces:**
- Consumes: `fixedActualTotal`, `leftoverOnMain` (Task 5); `fixedExpenses` řádky s `actual`/`tx_count`/`status` (Task 2); `stats.savings.net`, `stats.variable_pool_funded`.
- Produces: uzavřená bilance končící řádkem „Zbylo na běžném".

- [ ] **Step 1: Import utilu**

Nahoře v `ReportPage.jsx` přidej import:

```js
import { fixedActualTotal, leftoverOnMain } from '../utils/meetingBalance';
```

- [ ] **Step 2: Přepočítej `totalFixed` na skutečnost**

Nahraď (kolem ř. 214):

```js
const totalFixed   = fixedExpenses.reduce((s, f) => s + f.amount, 0);
```

za:

```js
const totalFixed   = fixedActualTotal(fixedExpenses);
```

- [ ] **Step 3: Spočti „Zbylo na běžném"**

Za výpočet `savings` / `variablePoolFunded` (kolem ř. 225–226) přidej:

```js
  const leftover = leftoverOnMain({
    totalIncome,
    totalFixed,
    variablePoolFunded,
    totalType1,
    totalType3,
    savingsNet: savings.net || 0,
  });
```

- [ ] **Step 4: Přeskládej bilanci (JSX)**

V sekci `report-section--bilance` (ř. 271–368) uprav pořadí a výsledek. Cílové pořadí řádků: **Příjmy celkem → Fixní platby → Dotace na nepravidelné → Měsíční výdaje → Drahé věci → Na spořicí → = Zbylo na běžném**.

Konkrétně:
1. Ponech řádek **„Příjmy celkem"** (ř. 272–277) beze změny.
2. Ponech blok **„Fixní platby"** (ř. 278–291) — už používá `totalFixed`, teď je skutečný.
3. **Přesuň** blok **„Dotace na nepravidelné"** (`variablePoolFunded > 0`, ř. 292–300) sem — hned za Fixní platby.
4. Ponech **„Měsíční výdaje"** (ř. 301–312).
5. Ponech **„Drahé věci"** (`totalType3 > 0 || type3MonthlyBudget > 0`, ř. 313–326).
6. **Nahraď** dosavadní výsledný řádek **„Skutečně naspořeno"** (ř. 327–333) mínus řádkem **„Na spořicí"** (bez `report-bilance-result`, tj. ne výsledný):

```jsx
            <Link to={txLink(`counterparty=${SAVINGS_ACCOUNT_NUM}`)}
              className="report-bilance-row"
              style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
              title="Klik: převody na spořicí účet v období">
              <span>Na spořicí</span>
              <span>{savings.net >= 0 ? '−' : '+'} {formatCurrency(Math.abs(savings.net))}</span>
            </Link>
```

7. Ponech detailní rozpad `savings.transfers` (ř. 334–364) beze změny — zůstane hned pod řádkem „Na spořicí".
8. **Přidej** nový výsledný řádek za rozpad `savings.transfers`:

```jsx
            <div className={`report-bilance-row report-bilance-result ${leftover >= 0 ? '' : 'text-danger'}`}>
              <span>Zbylo na běžném</span>
              <span>{leftover >= 0 ? '+' : '−'} {formatCurrency(Math.abs(leftover))}</span>
            </div>
```

9. **Nahraď** disclaimer (ř. 365–367) novým textem:

```jsx
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              „Zbylo na běžném" = přebytek/schodek toku za období (příjmy minus všechny odtoky včetně přesunů na spořicí a Nepravidelné). Je to orientační cash-flow, ne přesný bankovní zůstatek.
            </div>
```

- [ ] **Step 5: Zobraz skutečnou částku u řádku fixní platby**

V sekci Fixní platby (mapování `fixedExpenses.map`, ř. 459–474) uprav zobrazovanou částku tak, aby proběhlé manuální platby ukázaly skutečnost, missing plán. Nahraď `<span className="report-income-amount">{formatCurrency(row.amount)}</span>` (ř. 473) za:

```jsx
                    <span className="report-income-amount">
                      {formatCurrency(row.source === 'account' || row.tx_count > 0 ? (row.actual ?? row.amount) : row.amount)}
                    </span>
```

- [ ] **Step 6: Build klienta**

Run: `cd client && npm run build`
Expected: build projde bez chyb.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/ReportPage.jsx
git commit -m "feat(report): aritmetická bilance Schůzky se skutečnými fixními platbami"
```

---

### Task 7: Ověření celé sady + push na staging

**Files:** žádné (verifikace)

- [ ] **Step 1: Celá backend sada**

Run: `node --test 'src/**/*.test.js'`
Expected: PASS, 0 failing.

- [ ] **Step 2: Client utils sada**

Run: `node --test client/src/utils/*.test.js`
Expected: PASS.

- [ ] **Step 3: Build klienta**

Run: `cd client && npm run build`
Expected: OK.

- [ ] **Step 4: Push na staging**

```bash
git push origin staging
```

Expected: Railway nasadí staging. Po dokončení nahlásit uživateli číslo verze (z `package.json`, auto-bump na push).

---

## Self-Review (provedeno při psaní plánu)

- **Spec coverage:** A (counterparty matcher) → Task 1+3+4; B (skutečné částky, jen proběhlé) → Task 2+5+6; C (aritmetická bilance, „Zbylo na běžném", přesun spoření, nový disclaimer) → Task 5+6. Validace „aspoň jeden matcher" → Task 3+4. Rozšíření exclude-listu → Task 2. Vše pokryto.
- **Placeholder scan:** žádné TBD/TODO; každý krok má konkrétní kód a příkaz.
- **Type consistency:** `fixedActualTotal`/`leftoverOnMain` mají stejné signatury v Task 5 (definice) i Task 6 (použití); `match_counterparty_account` konzistentní napříč schema/util/route/frontend; `actual`/`tx_count`/`status` konzistentní backend→frontend.
- **Pozn. k existujícím testům:** Task 3 Step 1 explicitně upravuje 5 stávajících route-testů, které by jinak nová validace shodila.
