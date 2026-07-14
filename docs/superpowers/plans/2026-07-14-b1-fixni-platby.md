# B-1 Fixní platby Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rozšířit fixní platby o rozmezí částky a frekvenci a přesunout jejich správu na samostatnou stránku; Schůzka zůstane read-only status.

**Architecture:** `fixed_expenses` dostane 3 sloupce (`amount_min`, `amount_max`, `frequency_months`). Status se přepíše z procentní tolerance na rozmezí [min,max] a počítá se v okně posledních `frequency_months` období. Správa se přesune z inline formuláře na Schůzce na novou stránku `FixedExpensesPage` v sekci Konfigurace. Backend beze změny architektury (stále oddělený subsystém, žádná vazba na `categories`).

**Tech Stack:** Node.js + Express + better-sqlite3 (CJS, backend); React + Vite (ESM, `client/`). Backend testy `node --test 'src/**/*.test.js'`, in-memory DB přes `DB_PATH` tmp + `initSchema()`. Route testy přes `express` + `fetch` (vzor `src/routes/categories.test.js`).

## Global Constraints

- Migrace jen aditivní (ALTER/UPDATE v `initSchema()` migrations, try/catch). Žádné mazání dat. Verzi needitovat (husky hook).
- Status rozmezí: `ok` když `actual ∈ [min,max]` (včetně hranic), `mismatch` mimo, `missing` bez transakce, `null` když rozmezí nedefinováno.
- Migrace existujících: `amount_min = amount*0.95`, `amount_max = amount*1.05` (ROUND na 2), `frequency_months = 1` (DEFAULT).
- `frequency_months = 1` → okno = aktuální období (zachovat dnešní chování měsíčních plateb).
- Jazyk UI: čeština. `paymentStatus` používá JEN `fixedExpensesForPeriod` — signaturu lze změnit. `incomeStatus` a `MATCH_TOLERANCE_PCT` beze změny.
- T-Mobile a Nordic zůstávají fixní platby (migrace nemaže). Nový seznam 7 plateb doplní uživatel ručně po nasazení.
- Commity + push do `staging`.

---

### Task 1: Schema – nové sloupce + data-migrace

**Files:**
- Modify: `src/db/schema.js` (migrations pole ~284–317, řádek 318 smyčka)
- Test: `src/db/schema.test.js`

**Interfaces:**
- Produces: tabulka `fixed_expenses` má sloupce `amount_min REAL`, `amount_max REAL`, `frequency_months INTEGER DEFAULT 1`; existující řádky mají dopočítané min/max.

- [ ] **Step 1: Přidat failing test**

Do `src/db/schema.test.js` přidej test (použij stávající `freshDb`/`initSchema` vzor v souboru — pokud helper chybí, zkopíruj z `src/utils/fixed-expenses.test.js` řádky 8–21):

```js
test('migrace: fixed_expenses má amount_min/max + frequency_months a dopočítané rozmezí', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount) VALUES (1,'Nájem',38000)").run();
  // znovu-spuštění initSchema musí dopočítat min/max existujícímu řádku
  require('../db/schema').initSchema();
  const row = db.prepare("SELECT amount_min, amount_max, frequency_months FROM fixed_expenses WHERE name='Nájem'").get();
  cleanup(db, tmp);
  assert.equal(row.amount_min, 36100);   // 38000*0.95
  assert.equal(row.amount_max, 39900);   // 38000*1.05
  assert.equal(row.frequency_months, 1);
});
```

- [ ] **Step 2: Spustit test, ověřit selhání**

Run: `node --test src/db/schema.test.js`
Expected: FAIL — sloupce zatím neexistují (`no such column: amount_min`).

- [ ] **Step 3: Přidat migrace**

V `src/db/schema.js` do pole `migrations` (za řádek 299 `ALTER TABLE fixed_expenses ADD COLUMN match_pattern TEXT`) přidej:

```js
    'ALTER TABLE fixed_expenses ADD COLUMN amount_min REAL',
    'ALTER TABLE fixed_expenses ADD COLUMN amount_max REAL',
    'ALTER TABLE fixed_expenses ADD COLUMN frequency_months INTEGER DEFAULT 1',
```

Za smyčku `for (const sql of migrations)` (za řádek 320) přidej idempotentní data-migraci:

```js
  // Data-migrace: fixním platbám bez rozmezí dopočítej min/max z dnešní 5% tolerance.
  try {
    db.exec(`UPDATE fixed_expenses
             SET amount_min = ROUND(amount * 0.95, 2),
                 amount_max = ROUND(amount * 1.05, 2)
             WHERE amount_min IS NULL AND amount IS NOT NULL`);
  } catch { /* sloupce ještě neexistují při první migraci pořadí – ignoruj */ }
```

- [ ] **Step 4: Spustit test, ověřit průchod**

Run: `node --test src/db/schema.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.js src/db/schema.test.js
git commit -m "feat(fixed): schema – amount_min/max + frequency_months + data-migrace"
```

---

### Task 2: `paymentStatus` – přepis na rozmezí

**Files:**
- Modify: `src/utils/recurring.js` (řádky 12–21)
- Test: `src/utils/recurring.test.js` (přepsat existující `paymentStatus` testy + nové)

**Interfaces:**
- Consumes: nic.
- Produces: `paymentStatus(min, max, actual, txCount) → 'ok'|'mismatch'|'missing'|null`. Signatura ZMĚNĚNA (dřív `(expected, actual, txCount)`). Konzument `fixedExpensesForPeriod` se upraví v Task 3.

- [ ] **Step 1: Přepsat testy `paymentStatus`**

V `src/utils/recurring.test.js` nahraď existující `paymentStatus` testy (řádky 6–24) za:

```js
test('paymentStatus: žádná transakce → missing', () => {
  assert.equal(paymentStatus(36000, 40000, 0, 0), 'missing');
});
test('paymentStatus: uvnitř rozmezí → ok', () => {
  assert.equal(paymentStatus(36000, 40000, 38000, 1), 'ok');
});
test('paymentStatus: přesně na dolní hranici → ok', () => {
  assert.equal(paymentStatus(36000, 40000, 36000, 1), 'ok');
});
test('paymentStatus: přesně na horní hranici → ok', () => {
  assert.equal(paymentStatus(36000, 40000, 40000, 1), 'ok');
});
test('paymentStatus: pod rozmezím → mismatch', () => {
  assert.equal(paymentStatus(36000, 40000, 35999, 1), 'mismatch');
});
test('paymentStatus: nad rozmezím → mismatch', () => {
  assert.equal(paymentStatus(36000, 40000, 40001, 1), 'mismatch');
});
test('paymentStatus: rozmezí nedefinováno → null', () => {
  assert.equal(paymentStatus(null, null, 100, 1), null);
});
```

- [ ] **Step 2: Spustit test, ověřit selhání**

Run: `node --test src/utils/recurring.test.js`
Expected: FAIL — stará `paymentStatus(expected, actual, txCount)` neodpovídá nové signatuře.

- [ ] **Step 3: Přepsat `paymentStatus`**

V `src/utils/recurring.js` nahraď funkci (řádky 12–21):

```js
/**
 * Stav fixní platby: skutečná částka vůči akceptovanému rozmezí [min, max].
 * @returns 'ok' | 'mismatch' | 'missing' | null  (null = rozmezí nedefinováno)
 */
function paymentStatus(min, max, actual, txCount) {
  if (!txCount || txCount === 0) return 'missing';
  if (min == null || max == null) return null;
  return (actual >= min && actual <= max) ? 'ok' : 'mismatch';
}
```

- [ ] **Step 4: Spustit test, ověřit průchod**

Run: `node --test src/utils/recurring.test.js`
Expected: PASS (nové paymentStatus testy + nezměněné incomeStatus/savingsNet/reserveBalance).

- [ ] **Step 5: Commit**

```bash
git add src/utils/recurring.js src/utils/recurring.test.js
git commit -m "feat(fixed): paymentStatus podle rozmezí [min,max] místo procentní tolerance"
```

---

### Task 3: `fixedExpensesForPeriod` – frekvenční okno + rozmezí status

**Files:**
- Modify: `src/utils/fixed-expenses.js` (řádky 20–36)
- Test: `src/utils/fixed-expenses.test.js`

**Interfaces:**
- Consumes: `paymentStatus(min, max, actual, txCount)` z Task 2; `getPeriodDates(billingDay, periodKey)` z `period.js`.
- Produces: `fixedExpensesForPeriod` vrací manuální řádky s `actual`, `tx_count`, `status` počítanými v okně posledních `frequency_months` období.

- [ ] **Step 1: Přidat failing testy okna + rozmezí**

Do `src/utils/fixed-expenses.test.js` přidej:

```js
test('fixedExpensesForPeriod: měsíční (freq 1) status podle rozmezí', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, frequency_months, match_pattern) VALUES (1,'Nájem',38000,36000,40000,1,'HRDLIČKOVÁ')").run();
  db.prepare("INSERT INTO transactions (user_id, amount, date, description) VALUES (1,-38000,'2026-04-05','JANA HRDLIČKOVÁ')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  const m = rows.find(r => r.source === 'manual');
  assert.equal(m.actual, 38000);
  assert.equal(m.status, 'ok');
});

test('fixedExpensesForPeriod: kvartální (freq 3) najde platbu z −2 období → ok', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, frequency_months, match_pattern) VALUES (1,'Pojistka',3000,2900,3100,3,'POJISTKA')").run();
  // platba ve únoru, sledované období duben (freq 3 → okno únor–duben)
  db.prepare("INSERT INTO transactions (user_id, amount, date, description) VALUES (1,-3000,'2026-02-10','POJISTKA AUTO')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  const m = rows.find(r => r.source === 'manual');
  assert.equal(m.status, 'ok');
});

test('fixedExpensesForPeriod: kvartální bez platby v okně → missing', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, frequency_months, match_pattern) VALUES (1,'Pojistka',3000,2900,3100,3,'POJISTKA')").run();
  db.prepare("INSERT INTO transactions (user_id, amount, date, description) VALUES (1,-3000,'2025-11-10','POJISTKA AUTO')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  const m = rows.find(r => r.source === 'manual');
  assert.equal(m.status, 'missing');
});
```

Pozn.: billing_day default 1 → období `2026-04` = 1.–30. 4.; okno freq 3 = únor start.

- [ ] **Step 2: Spustit test, ověřit selhání**

Run: `node --test src/utils/fixed-expenses.test.js`
Expected: FAIL — dnešní kód volá `paymentStatus(row.amount, ...)` (stará signatura, špatný sloupec) a hledá jen v aktuálním období.

- [ ] **Step 3: Přepsat matchování na okno + rozmezí**

V `src/utils/fixed-expenses.js` nahraď blok (řádky 20–36). Přidej helper pro posun období a použij okno:

```js
  // Posun periodKey "YYYY-MM" o delta měsíců (bez závislosti na frontend addPeriods).
  const shiftPeriod = (p, delta) => {
    const [y, m] = p.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const matchStmt = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) AS actual, COUNT(*) AS tx_count
    FROM transactions
    WHERE user_id = ? AND amount < 0 AND date >= ? AND date <= ?
      AND description LIKE '%' || ? || '%'
  `);

  const windowEnd = end;  // konec aktuálního období
  const manualWithStatus = manual.map(row => {
    if (!row.match_pattern) return row;
    const freq = row.frequency_months > 0 ? row.frequency_months : 1;
    const windowStart = getPeriodDates(billingDay, shiftPeriod(period, -(freq - 1))).start;
    const m = matchStmt.get(userId, windowStart, windowEnd, row.match_pattern);
    return {
      ...row,
      actual: m.actual,
      tx_count: m.tx_count,
      status: paymentStatus(row.amount_min, row.amount_max, m.actual, m.tx_count),
    };
  });
```

(`start` z `getPeriodDates` na řádku 18 se pro manuální větev už nepoužije, ale zůstává pro account-based dotaz níže — neodstraňovat.)

- [ ] **Step 4: Spustit test, ověřit průchod nových + selhání původního**

Run: `node --test src/utils/fixed-expenses.test.js`
Expected: 3 nové testy PASS; **původní test „Nájem Stodůlky" (řádky 23–42) nyní SELŽE** — vkládá řádek bez `amount_min`/`amount_max`, takže `paymentStatus` vrátí `null` místo `'ok'`. To je očekávané, opraví se v Step 5.

- [ ] **Step 5: Opravit původní test na rozmezí**

Uprav INSERT na řádku 27 původního testu, aby měl rozmezí (`paymentStatus` pak vrátí `'ok'`):

```js
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, sort_order, match_pattern) VALUES (1, 'Nájem Stodůlky', 38126, 37000, 39000, 1, 'JANA HRDLIČKOVÁ')").run();
```

Run: `node --test src/utils/fixed-expenses.test.js`
Expected: PASS (všech 5).

- [ ] **Step 6: Commit**

```bash
git add src/utils/fixed-expenses.js src/utils/fixed-expenses.test.js
git commit -m "feat(fixed): status v okně frekvence + podle rozmezí [min,max]"
```

---

### Task 4: Route – nová pole + validace

**Files:**
- Modify: `src/routes/fixed-expenses.js` (POST ~17–25, PATCH ~28–41)
- Test: `src/routes/fixed-expenses.test.js` (nový, vzor `src/routes/categories.test.js`)

**Interfaces:**
- Consumes: nic nového.
- Produces: `POST`/`PATCH /api/fixed-expenses` přijímají `amount_min`, `amount_max`, `frequency_months`; validace `min <= max` (400 při porušení).

- [ ] **Step 1: Napsat failing route test**

Vytvoř `src/routes/fixed-expenses.test.js` (in-memory DB + express mount dle vzoru `categories.test.js`):

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-fx-route-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./fixed-expenses']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/fixed-expenses', require('./fixed-expenses'));
  return { db, app };
}
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

test('POST přijme rozmezí + frekvenci', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Nájem', amount:38000, amount_min:36000, amount_max:40000, frequency_months:1 }) });
  assert.equal(res.status, 201);
  const row = await res.json();
  assert.equal(row.amount_min, 36000);
  assert.equal(row.amount_max, 40000);
  assert.equal(row.frequency_months, 1);
  server.close();
});

test('POST s min > max → 400', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Nájem', amount:38000, amount_min:40000, amount_max:36000 }) });
  assert.equal(res.status, 400);
  server.close();
});
```

- [ ] **Step 2: Spustit test, ověřit selhání**

Run: `node --test src/routes/fixed-expenses.test.js`
Expected: FAIL — POST zatím nová pole neukládá (`amount_min` undefined) a nevaliduje min>max.

- [ ] **Step 3: Rozšířit POST a PATCH**

V `src/routes/fixed-expenses.js` nahraď POST handler (řádky 17–25):

```js
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { name, amount, note, sort_order, match_pattern, amount_min, amount_max, frequency_months } = req.body;
  if (!name || amount == null) return res.status(400).json({ error: 'Název a částka jsou povinné.' });
  const min = amount_min != null ? parseFloat(amount_min) : null;
  const max = amount_max != null ? parseFloat(amount_max) : null;
  if (min != null && max != null && min > max) return res.status(400).json({ error: 'Min nesmí být větší než max.' });
  const freq = frequency_months != null ? Math.max(1, parseInt(frequency_months, 10) || 1) : 1;
  const result = db.prepare(
    'INSERT INTO fixed_expenses (user_id, name, amount, note, sort_order, match_pattern, amount_min, amount_max, frequency_months) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.dataUserId, name.trim(), parseFloat(amount), note || null, sort_order ?? 0,
    match_pattern && match_pattern.trim() ? match_pattern.trim() : null, min, max, freq);
  res.status(201).json(db.prepare('SELECT * FROM fixed_expenses WHERE id = ?').get(result.lastInsertRowid));
});
```

Nahraď PATCH handler (řádky 28–41):

```js
router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM fixed_expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  const { name, amount, note, sort_order, match_pattern, amount_min, amount_max, frequency_months } = req.body;
  const min = amount_min !== undefined ? (amount_min != null ? parseFloat(amount_min) : null) : row.amount_min;
  const max = amount_max !== undefined ? (amount_max != null ? parseFloat(amount_max) : null) : row.amount_max;
  if (min != null && max != null && min > max) return res.status(400).json({ error: 'Min nesmí být větší než max.' });
  db.prepare('UPDATE fixed_expenses SET name = ?, amount = ?, note = ?, sort_order = ?, match_pattern = ?, amount_min = ?, amount_max = ?, frequency_months = ? WHERE id = ?').run(
    name ?? row.name,
    amount != null ? parseFloat(amount) : row.amount,
    note !== undefined ? (note || null) : row.note,
    sort_order ?? row.sort_order,
    match_pattern !== undefined ? (match_pattern && match_pattern.trim() ? match_pattern.trim() : null) : row.match_pattern,
    min, max,
    frequency_months !== undefined ? Math.max(1, parseInt(frequency_months, 10) || 1) : row.frequency_months,
    row.id
  );
  res.json(db.prepare('SELECT * FROM fixed_expenses WHERE id = ?').get(row.id));
});
```

- [ ] **Step 4: Spustit test, ověřit průchod**

Run: `node --test src/routes/fixed-expenses.test.js`
Expected: PASS (2 testy).

- [ ] **Step 5: Commit**

```bash
git add src/routes/fixed-expenses.js src/routes/fixed-expenses.test.js
git commit -m "feat(fixed): route přijímá rozmezí + frekvenci, validuje min<=max"
```

---

### Task 5: Frontend – stránka „Fixní platby" v Konfiguraci

**Files:**
- Create: `client/src/pages/FixedExpensesPage.jsx`
- Modify: `client/src/App.jsx` (~17 import, ~89 route), `client/src/components/Sidebar.jsx` (~34–40 sectionConfig items + import ikony), `client/src/i18n.js` (nav label)

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /api/fixed-expenses` (bez `period` → holé položky).
- Produces: route `/fixed-expenses`, odkaz v menu Konfigurace.

- [ ] **Step 1: Přidat i18n label**

V `client/src/i18n.js` do objektu `nav` přidej klíč (vedle `rules`):

```js
    fixedExpenses: 'Fixní platby',
```

- [ ] **Step 2: Vytvořit stránku**

Vytvoř `client/src/pages/FixedExpensesPage.jsx` podle vzoru `RulesPage.jsx` (stejný layout `Layout`, `page-header`, seznam + formulář). Formulář má pole: **Název** (`name`), **Plánovaná částka** (`amount`, number), **Min** (`amount_min`, number), **Max** (`amount_max`, number), **Frekvence (měsíce)** (`frequency_months`, number, default 1), **Pattern transakce** (`match_pattern`, text, volitelné), **Poznámka** (`note`, text). CRUD:

```jsx
import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { t } from '../i18n';

const EMPTY = { name:'', amount:'', amount_min:'', amount_max:'', frequency_months:1, match_pattern:'', note:'' };

export default function FixedExpensesPage() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState('');

  const load = () => fetch('/api/fixed-expenses').then(r => r.json()).then(setItems);
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const body = {
      name: form.name, amount: parseFloat(form.amount),
      amount_min: form.amount_min === '' ? null : parseFloat(form.amount_min),
      amount_max: form.amount_max === '' ? null : parseFloat(form.amount_max),
      frequency_months: parseInt(form.frequency_months, 10) || 1,
      match_pattern: form.match_pattern || null, note: form.note || null,
    };
    const url = editId ? `/api/fixed-expenses/${editId}` : '/api/fixed-expenses';
    const res = await fetch(url, { method: editId ? 'PATCH' : 'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
    if (!res.ok) { setError((await res.json()).error || 'Chyba'); return; }
    setForm(EMPTY); setEditId(null); load();
  };
  const edit = (it) => { setEditId(it.id); setForm({ name:it.name||'', amount:it.amount??'', amount_min:it.amount_min??'', amount_max:it.amount_max??'', frequency_months:it.frequency_months||1, match_pattern:it.match_pattern||'', note:it.note||'' }); };
  const del = async (id) => { await fetch(`/api/fixed-expenses/${id}`, { method:'DELETE' }); load(); };

  return (
    <Layout>
      <div className="page-header"><h1>{t.nav.fixedExpenses}</h1></div>
      <form className="card" onSubmit={submit} style={{ display:'grid', gap:8, maxWidth:520 }}>
        <input className="input" placeholder="Název" value={form.name} onChange={e=>setForm({...form, name:e.target.value})} required />
        <input className="input" type="number" placeholder="Plánovaná částka" value={form.amount} onChange={e=>setForm({...form, amount:e.target.value})} required />
        <div style={{ display:'flex', gap:8 }}>
          <input className="input" type="number" placeholder="Min" value={form.amount_min} onChange={e=>setForm({...form, amount_min:e.target.value})} />
          <input className="input" type="number" placeholder="Max" value={form.amount_max} onChange={e=>setForm({...form, amount_max:e.target.value})} />
          <input className="input" type="number" placeholder="Frekvence (měsíce)" value={form.frequency_months} onChange={e=>setForm({...form, frequency_months:e.target.value})} min={1} />
        </div>
        <input className="input" placeholder="Pattern transakce (volitelné)" value={form.match_pattern} onChange={e=>setForm({...form, match_pattern:e.target.value})} />
        <input className="input" placeholder="Poznámka" value={form.note} onChange={e=>setForm({...form, note:e.target.value})} />
        {error && <div className="text-danger">{error}</div>}
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-primary" type="submit">{editId ? 'Uložit' : 'Přidat'}</button>
          {editId && <button className="btn btn-ghost" type="button" onClick={()=>{ setForm(EMPTY); setEditId(null); }}>Zrušit</button>}
        </div>
      </form>
      <div className="card" style={{ marginTop:16 }}>
        {items.filter(i => i.source !== 'account').map(it => (
          <div key={it.id} className="report-budget-row" style={{ alignItems:'center' }}>
            <span className="report-budget-name">
              {it.name}
              <span className="text-muted" style={{ display:'block', fontSize:11 }}>
                {it.amount_min != null && it.amount_max != null ? `${it.amount_min}–${it.amount_max} Kč` : `${it.amount} Kč`}
                {it.frequency_months > 1 ? ` · à ${it.frequency_months} měs.` : ''}
                {it.match_pattern ? ` · „${it.match_pattern}"` : ''}
              </span>
            </span>
            <button className="btn btn-ghost btn-sm" onClick={()=>edit(it)}>Upravit</button>
            <button className="btn btn-ghost btn-sm" onClick={()=>del(it.id)}>Smazat</button>
          </div>
        ))}
      </div>
    </Layout>
  );
}
```

Pozn.: `GET /api/fixed-expenses` bez `period` vrací jen manuální řádky, ale filtr `i.source !== 'account'` je pojistka. Pokud CSS třídy (`card`, `input`, `btn`, `report-budget-row`, `text-danger`, `text-muted`, `btn-sm`) nesedí na existující, sladit s `RulesPage.jsx`.

- [ ] **Step 3: Zaregistrovat route a menu**

V `client/src/App.jsx`:
- import (za řádek 17): `import FixedExpensesPage from './pages/FixedExpensesPage';`
- route (za řádek 89 `/rules`): `<Route path="/fixed-expenses" element={<R el={<FixedExpensesPage />} />} />`

V `client/src/components/Sidebar.jsx`:
- import ikony (do lucide bloku ~5–18): `Receipt,`
- do `sectionConfig` items (za řádek 35 `/rules`): `{ to: '/fixed-expenses', icon: Receipt, label: t.nav.fixedExpenses },`

- [ ] **Step 4: Ověřit build**

Run: `cd client && npm run build`
Expected: build projde bez chyb.

- [ ] **Step 5: Vizuální ověření**

Spustit appku, otevřít `/fixed-expenses` z menu Konfigurace. Přidat testovací platbu (název, částka, min/max, frekvence), ověřit, že se uloží a zobrazí; upravit; smazat. Ověř přes `/verify`.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/FixedExpensesPage.jsx client/src/App.jsx client/src/components/Sidebar.jsx client/src/i18n.js
git commit -m "feat(fixed): samostatná stránka Fixní platby v Konfiguraci"
```

---

### Task 6: Schůzka – read-only status s rozmezím

**Files:**
- Modify: `client/src/pages/ReportPage.jsx` (`FixedExpenseForm` ~32–76, sekce Fixní platby ~551–620)

**Interfaces:**
- Consumes: `GET /api/fixed-expenses?period=` (status s rozmezím z Task 3).
- Produces: read-only sekce Fixní platby (bez přidávání/editace).

- [ ] **Step 1: Odstranit editaci**

V `client/src/pages/ReportPage.jsx`:
- Smaž komponentu `FixedExpenseForm` (~řádky 32–76) a všechny její reference.
- V sekci Fixní platby (~551–620) odstraň tlačítko „Přidat", inline formulář, edit/delete tlačítka i příslušný stav (`editingFixed`, `showFixedForm` apod. — dohledat podle referencí na `FixedExpenseForm`). Zachovej: status ikonu (`FIXED_STATUS`), název, souhrn počtů, řádek „Fixní platby celkem" (`totalFixed`).
- Přidej odkaz na správu: nad seznamem malý `<Link to="/fixed-expenses" className="text-muted">Spravovat fixní platby →</Link>` (import `Link` z `react-router-dom`, pokud chybí).

- [ ] **Step 2: Zobrazit rozmezí u mismatch**

V řádku fixní platby u statusu `mismatch` (dnes ~584–589 ukazuje skutečnou vs jedna částka) uprav text, aby ukázal skutečnou vs **rozmezí**:

```jsx
{fe.status === 'mismatch' && fe.amount_min != null && (
  <span className="text-muted" style={{ fontSize: 12 }}>
    {`${formatCurrency(fe.actual)} (čekáno ${fe.amount_min}–${fe.amount_max} Kč)`}
  </span>
)}
```

(Přesné okolní JSX sladit s dnešní strukturou řádku; `formatCurrency` už je v ReportPage importovaný.)

- [ ] **Step 3: Ověřit build**

Run: `cd client && npm run build`
Expected: build projde bez chyb (žádné mrtvé reference na `FixedExpenseForm`).

- [ ] **Step 4: Vizuální ověření**

Otevřít Schůzku (`/report`) za období s fixními platbami: sekce Fixní platby je read-only, ukazuje status ✅/⚠️/❌, u ⚠️ skutečnou vs rozmezí, souhrn i „celkem" sedí, odkaz „Spravovat" vede na `/fixed-expenses`. Ověř přes `/verify`.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ReportPage.jsx
git commit -m "feat(fixed): Schůzka read-only status fixních plateb s rozmezím"
```

---

## Závěrečné kroky

- [ ] **Celá backend test sada**

Run: `node --test 'src/**/*.test.js'`
Expected: vše PASS (nové schema/recurring/fixed-expenses/route testy + stávající).

- [ ] **Client build**

Run: `cd client && npm run build`
Expected: OK.

- [ ] **Push do staging**

```bash
git push origin staging
```

Railway nasadí staging. Nahlásit verzi. Po vizuální kontrole na pokyn merge do `main`.

## Self-Review

**Spec coverage:**
- Schema `amount_min/max` + `frequency_months` + data-migrace → Task 1 ✓
- `paymentStatus` rozmezí → Task 2 ✓
- Frekvenční okno + status → Task 3 ✓
- Route nová pole + validace → Task 4 ✓
- Samostatná stránka v Konfiguraci → Task 5 ✓
- Schůzka read-only → Task 6 ✓
- Migrace nemaže (T-Mobile/Nordic zůstávají), seznam ručně → Task 1 nemaže; datová část mimo plán ✓
- Non-goals (žádná vazba na categories) → dodrženo ✓

**Placeholder scan:** žádné TBD; každý krok má kód a příkaz s očekávaným výstupem. Task 5/6 UI kroky mají vizuální `/verify` (nemají čistou util funkci).

**Type consistency:** `paymentStatus(min, max, actual, txCount)` definován v Task 2, volán v Task 3 se shodným pořadím. Sloupce `amount_min`/`amount_max`/`frequency_months` konzistentní napříč Task 1/3/4/5.
