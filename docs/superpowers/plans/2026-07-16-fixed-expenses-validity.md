# Okno platnosti fixních plateb — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fixní platby dostanou volitelné okno platnosti (`valid_from`/`valid_to`, periodKey `"YYYY-MM"`), takže výměna poskytovatele (NORDIC → T-Mobile) zachová přesnou historii bez falešných alertů.

**Architecture:** Dva nullable TEXT sloupce na `fixed_expenses`; `fixedExpensesForPeriod` filtruje manuální řádky podle období (stringové porovnání periodKey) a dedup account-řádků staví jen z platných matcherů; route validuje formát; UI přidá 2 month-inputy a kosmetické štítky „ukončeno/od".

**Tech Stack:** Node.js + Express + better-sqlite3, node:test, React (Vite).

**Spec:** `docs/superpowers/specs/2026-07-16-fixed-expenses-validity-design.md`

## Global Constraints

- Jazyk UI: čeština (texty přímo v JSX, jako zbytek FixedExpensesPage).
- Migrace = řádky v poli `migrations` v `initSchema()` (`src/db/schema.js`), žádný framework.
- Porovnání periodKey vždy stringově (`"2026-07" <= "2026-08"` lexikograficky) — žádná datová aritmetika.
- `valid_to` je **včetně** (poslední období, kdy platba platí).
- Commity průběžně do větve `staging`; verze bumpuje husky hook automaticky.
- Žádný `type: any`, žádné nové závislosti.

---

### Task 1: DB migrace + filtr platnosti v `fixedExpensesForPeriod`

**Files:**
- Modify: `src/db/schema.js:335` (konec pole `migrations`)
- Modify: `src/utils/fixed-expenses.js`
- Test: `src/utils/fixed-expenses.test.js`

**Interfaces:**
- Produces: sloupce `fixed_expenses.valid_from TEXT`, `fixed_expenses.valid_to TEXT` (nullable periodKey). `fixedExpensesForPeriod(db, userId, period)` s `period` vrací jen manuální řádky platné v období; bez `period` vrací všechny manuální řádky (pro editační UI). Dedup account-řádků používá jen matchery platných řádků.

- [ ] **Step 1: Přidej migraci sloupců**

V `src/db/schema.js` na konec pole `migrations` (za `'ALTER TABLE transactions ADD COLUMN card_last4 TEXT',`):

```js
    // Okno platnosti fixní platby (periodKey "YYYY-MM"; NULL = odjakživa/navždy)
    'ALTER TABLE fixed_expenses ADD COLUMN valid_from TEXT',
    'ALTER TABLE fixed_expenses ADD COLUMN valid_to TEXT',
```

- [ ] **Step 2: Napiš failing testy**

Na konec `src/utils/fixed-expenses.test.js`:

```js
test('fixedExpensesForPeriod: řádek s valid_to v minulosti se v novějším období nevrací, ve starším ano', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, match_pattern, valid_to) VALUES (1,'NORDIC internet',500,450,550,'NORDIC','2026-07')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const inAugust = fixedExpensesForPeriod(db, 1, '2026-08');
  const inJuly = fixedExpensesForPeriod(db, 1, '2026-07');
  const inMay = fixedExpensesForPeriod(db, 1, '2026-05');
  cleanup(db, tmp);
  assert.equal(inAugust.filter(r => r.source === 'manual').length, 0);
  assert.equal(inJuly.filter(r => r.source === 'manual').length, 1);   // valid_to je včetně
  assert.equal(inMay.filter(r => r.source === 'manual').length, 1);
});

test('fixedExpensesForPeriod: řádek s valid_from v budoucnu se v dřívějším období nevrací', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, match_pattern, valid_from) VALUES (1,'T-Mobile internet',600,550,650,'T-MOBILE','2026-08')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const inJuly = fixedExpensesForPeriod(db, 1, '2026-07');
  const inAugust = fixedExpensesForPeriod(db, 1, '2026-08');
  cleanup(db, tmp);
  assert.equal(inJuly.filter(r => r.source === 'manual').length, 0);
  assert.equal(inAugust.filter(r => r.source === 'manual').length, 1); // valid_from je včetně
});

test('fixedExpensesForPeriod: NULL/NULL okno = platí ve všech obdobích (beze změny chování)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, match_pattern) VALUES (1,'Nájem',38000,36000,40000,'NÁJEM')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  assert.equal(rows.filter(r => r.source === 'manual').length, 1);
});

test('fixedExpensesForPeriod: bez period vrací i ukončené řádky (editační seznam)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, match_pattern, valid_to) VALUES (1,'NORDIC internet',500,'NORDIC','2020-01')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, undefined);
  cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].valid_to, '2020-01');
});

test('fixedExpensesForPeriod: matcher ukončeného řádku neschovává account-řádky', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, role) VALUES (20, 1, 'Fixní účet', 'fixed')").run();
  // ukončený řádek (valid_to 2026-03) s patternem, který by transakci z dubna matchnul
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, match_pattern, valid_to) VALUES (1,'NORDIC internet',500,'NORDIC','2026-03')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description) VALUES (1, 20, -500, '2026-04-05', 'NORDIC TELECOM')").run();
  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04');
  cleanup(db, tmp);
  // ukončený manuální řádek se nevrací a jeho pattern nesmí transakci schovat
  assert.equal(rows.filter(r => r.source === 'manual').length, 0);
  const accountRows = rows.filter(r => r.source === 'account');
  assert.equal(accountRows.length, 1);
  assert.equal(accountRows[0].name, 'NORDIC TELECOM');
});
```

- [ ] **Step 3: Spusť testy — musí selhat**

Run: `node --test src/utils/fixed-expenses.test.js`
Expected: nové testy FAIL (řádky mimo platnost se vrací / account-řádek je schovaný), stávajících 10 testů PASS.

- [ ] **Step 4: Implementuj filtr platnosti**

V `src/utils/fixed-expenses.js` — za načtení `manual` (řádek 18) a guard `if (!period) return manual;` přidej filtr a všechna další použití `manual` přepni na `active`:

```js
  // Okno platnosti: řádek platí v období, když period ∈ [valid_from, valid_to]
  // (NULL = bez omezení; stringové porovnání periodKey je lexikograficky korektní).
  const active = manual.filter(r =>
    (!r.valid_from || r.valid_from <= period) && (!r.valid_to || r.valid_to >= period)
  );
```

Konkrétně:
- `const manualWithStatus = manual.map(row => {` → `const manualWithStatus = active.map(row => {`
- `const patterns = manual.map(m => m.match_pattern)...` → `const patterns = active.map(...)`
- `const cpTargets = manual.map(m => normCounterparty(...))...` → `const cpTargets = active.map(...)`

- [ ] **Step 5: Spusť testy — musí projít**

Run: `node --test src/utils/fixed-expenses.test.js`
Expected: všech 15 testů PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.js src/utils/fixed-expenses.js src/utils/fixed-expenses.test.js
git commit -m "feat(fixed): okno platnosti valid_from/valid_to — filtr per období + dedup jen z platných matcherů"
```

---

### Task 2: API validace `valid_from`/`valid_to` na POST/PATCH

**Files:**
- Modify: `src/routes/fixed-expenses.js`
- Test: `src/routes/fixed-expenses.test.js`

**Interfaces:**
- Consumes: sloupce `valid_from`/`valid_to` z Task 1.
- Produces: POST/PATCH `/api/fixed-expenses` přijímají volitelná pole `valid_from`, `valid_to` (string `"YYYY-MM"` nebo `null`/prázdný string → `NULL`). 400 při špatném formátu nebo `valid_from > valid_to`. PATCH: nezaslané pole = beze změny.

- [ ] **Step 1: Napiš failing testy**

Na konec `src/routes/fixed-expenses.test.js`:

```js
test('POST s valid_from/valid_to → 201 a uloží okno platnosti', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'T-Mobile internet', amount:600, match_pattern:'T-MOBILE', valid_from:'2026-08', valid_to:null }) });
  assert.equal(res.status, 201);
  const row = await res.json();
  assert.equal(row.valid_from, '2026-08');
  assert.equal(row.valid_to, null);
  server.close();
});

test('POST se špatným formátem valid_from → 400', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'X', amount:1, match_pattern:'X', valid_from:'srpen 2026' }) });
  assert.equal(res.status, 400);
  server.close();
});

test('POST s valid_from > valid_to → 400', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'X', amount:1, match_pattern:'X', valid_from:'2026-09', valid_to:'2026-08' }) });
  assert.equal(res.status, 400);
  server.close();
});

test('PATCH nastaví valid_to a nezaslaná pole zachová', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const postRes = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'NORDIC internet', amount:500, match_pattern:'NORDIC', valid_from:'2024-01' }) });
  const { id } = await postRes.json();
  const patchRes = await fetch(`${base}/api/fixed-expenses/${id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ valid_to:'2026-07' }) });
  assert.equal(patchRes.status, 200);
  const updated = await patchRes.json();
  assert.equal(updated.valid_to, '2026-07');
  assert.equal(updated.valid_from, '2024-01');
  assert.equal(updated.match_pattern, 'NORDIC');
  server.close();
});

test('PATCH valid_from do konfliktu se stávajícím valid_to → 400', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const postRes = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'X', amount:1, match_pattern:'X', valid_to:'2026-07' }) });
  const { id } = await postRes.json();
  const patchRes = await fetch(`${base}/api/fixed-expenses/${id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ valid_from:'2026-09' }) });
  assert.equal(patchRes.status, 400);
  server.close();
});

test('PATCH valid_to=null smaže konec platnosti', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const postRes = await fetch(`${base}/api/fixed-expenses`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'X', amount:1, match_pattern:'X', valid_to:'2026-07' }) });
  const { id } = await postRes.json();
  const patchRes = await fetch(`${base}/api/fixed-expenses/${id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ valid_to:null }) });
  assert.equal(patchRes.status, 200);
  const updated = await patchRes.json();
  assert.equal(updated.valid_to, null);
  server.close();
});
```

- [ ] **Step 2: Spusť testy — musí selhat**

Run: `node --test src/routes/fixed-expenses.test.js`
Expected: nové testy FAIL (sloupce se neukládají / validace nevrací 400), stávajících 8 PASS.

- [ ] **Step 3: Implementuj validaci a ukládání**

V `src/routes/fixed-expenses.js` nad routery přidej helper:

```js
const PERIOD_RE = /^\d{4}-\d{2}$/;
// Normalizuje vstup okna platnosti: '' / null / undefined→null, jinak trimovaný
// string; vrací { value } nebo { error } při špatném formátu.
function parsePeriodField(raw, label) {
  if (raw == null || String(raw).trim() === '') return { value: null };
  const v = String(raw).trim();
  if (!PERIOD_RE.test(v)) return { error: `${label} musí být ve formátu RRRR-MM.` };
  return { value: v };
}
```

**POST** — do destructuringu přidej `valid_from, valid_to`, za validaci `freq` vlož:

```js
  const vf = parsePeriodField(valid_from, 'Platí od');
  if (vf.error) return res.status(400).json({ error: vf.error });
  const vt = parsePeriodField(valid_to, 'Platí do');
  if (vt.error) return res.status(400).json({ error: vt.error });
  if (vf.value && vt.value && vf.value > vt.value) return res.status(400).json({ error: '„Platí od" nesmí být později než „Platí do".' });
```

a rozšiř INSERT:

```js
  const result = db.prepare(
    'INSERT INTO fixed_expenses (user_id, name, amount, note, sort_order, match_pattern, match_counterparty_account, amount_min, amount_max, frequency_months, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.dataUserId, name.trim(), parseFloat(amount), note || null, sort_order ?? 0,
    pattern, cpAccount, min, max, freq, vf.value, vt.value);
```

**PATCH** — do destructuringu přidej `valid_from, valid_to`, za výpočet `cpAccount` vlož (vzor `!== undefined` = nezasláno → beze změny):

```js
  let vfValue = row.valid_from;
  if (valid_from !== undefined) {
    const vf = parsePeriodField(valid_from, 'Platí od');
    if (vf.error) return res.status(400).json({ error: vf.error });
    vfValue = vf.value;
  }
  let vtValue = row.valid_to;
  if (valid_to !== undefined) {
    const vt = parsePeriodField(valid_to, 'Platí do');
    if (vt.error) return res.status(400).json({ error: vt.error });
    vtValue = vt.value;
  }
  if (vfValue && vtValue && vfValue > vtValue) return res.status(400).json({ error: '„Platí od" nesmí být později než „Platí do".' });
```

a rozšiř UPDATE:

```js
  db.prepare('UPDATE fixed_expenses SET name = ?, amount = ?, note = ?, sort_order = ?, match_pattern = ?, match_counterparty_account = ?, amount_min = ?, amount_max = ?, frequency_months = ?, valid_from = ?, valid_to = ? WHERE id = ?').run(
    name ?? row.name,
    amount != null ? parseFloat(amount) : row.amount,
    note !== undefined ? (note || null) : row.note,
    sort_order ?? row.sort_order,
    pattern, cpAccount,
    min, max,
    frequency_months !== undefined ? Math.max(1, parseInt(frequency_months, 10) || 1) : row.frequency_months,
    vfValue, vtValue,
    row.id
  );
```

- [ ] **Step 4: Spusť testy — musí projít**

Run: `node --test src/routes/fixed-expenses.test.js`
Expected: všech 14 testů PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/fixed-expenses.js src/routes/fixed-expenses.test.js
git commit -m "feat(fixed): POST/PATCH přijímají valid_from/valid_to s validací formátu a pořadí"
```

---

### Task 3: UI — pole „Platí od/do" + štítky ukončeno/od

**Files:**
- Modify: `client/src/pages/FixedExpensesPage.jsx`

**Interfaces:**
- Consumes: API z Task 2 (`valid_from`/`valid_to` v GET odpovědi i POST/PATCH body).
- Produces: jen UI, nic dalšího na tom nestaví.

- [ ] **Step 1: Rozšiř formulářový stav a submit**

V `client/src/pages/FixedExpensesPage.jsx`:

`EMPTY` (řádek 5):

```js
const EMPTY = { name: '', amount: '', amount_min: '', amount_max: '', frequency_months: 1, match_pattern: '', match_counterparty_account: '', note: '', valid_from: '', valid_to: '' };
```

Do `body` v `submit` (za `note`):

```js
      valid_from: form.valid_from || null,
      valid_to: form.valid_to || null,
```

Do `edit(it)` (za `note`):

```js
      valid_from: it.valid_from || '',
      valid_to: it.valid_to || '',
```

- [ ] **Step 2: Přidej inputy do formuláře**

Za blok s inputem „Poznámka" (před `{error && ...}`):

```jsx
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="text-muted" style={{ fontSize: 11, flex: 1 }}>
            Platí od
            <input
              className="input"
              type="month"
              value={form.valid_from}
              onChange={e => setForm({ ...form, valid_from: e.target.value })}
            />
          </label>
          <label className="text-muted" style={{ fontSize: 11, flex: 1 }}>
            Platí do (včetně)
            <input
              className="input"
              type="month"
              value={form.valid_to}
              onChange={e => setForm({ ...form, valid_to: e.target.value })}
            />
          </label>
        </div>
        <span className="text-muted" style={{ fontSize: 11 }}>
          Nech prázdné, pokud platba platí bez omezení. Při změně poskytovatele starou platbu ukonči („Platí do") a novou založ s „Platí od" — historie starých období zůstane přesná.
        </span>
```

- [ ] **Step 3: Štítky v seznamu**

Nad `return` komponenty přidej (kosmetický štítek — aktuální kalendářní měsíc, billing day se neřeší):

```js
  const now = new Date();
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fmtPeriod = (p) => `${parseInt(p.slice(5), 10)}/${p.slice(0, 4)}`;
```

V mapování seznamu: řádek `<div key={it.id} className="report-budget-row" ...>` dostane ztlumení pro ukončené položky a do bloku detailů přibudou štítky:

```jsx
            <div key={it.id} className="report-budget-row" style={{ alignItems: 'center', opacity: it.valid_to && it.valid_to < nowKey ? 0.55 : 1 }}>
              <span className="report-budget-name">
                {it.name}
                <span className="text-muted" style={{ display: 'block', fontSize: 11 }}>
                  {it.amount_min != null && it.amount_max != null ? `${it.amount_min}–${it.amount_max} Kč` : `${it.amount} Kč`}
                  {it.frequency_months > 1 ? ` · à ${it.frequency_months} měs.` : ''}
                  {it.match_pattern ? ` · „${it.match_pattern}"` : ''}
                  {it.match_counterparty_account ? ` · účet ${it.match_counterparty_account}` : ''}
                  {it.valid_to && it.valid_to < nowKey ? ` · ukončeno ${fmtPeriod(it.valid_to)}` : ''}
                  {it.valid_from && it.valid_from > nowKey ? ` · od ${fmtPeriod(it.valid_from)}` : ''}
                </span>
              </span>
```

- [ ] **Step 4: Ověř build**

Run: `npm run build`
Expected: Vite build projde bez chyb.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/FixedExpensesPage.jsx
git commit -m "feat(fixed): UI pole Platí od/do + štítky ukončeno/od v seznamu fixních plateb"
```

---

### Task 4: Verifikace, staging a produkce

**Files:** žádné nové — verifikační a deploy kroky.

- [ ] **Step 1: Celá backendová sada**

Run: `node --test src/`
Expected: vše PASS (před změnou 171 testů, po změně 182: +5 utils, +6 route).

- [ ] **Step 2: End-to-end ověření (skill `verify`)**

Spusť lokálně (`npm run build && npm start` s lokální DB), přes API ověř scénář:
1. POST NORDIC s `valid_to` = minulý měsíc, POST T-Mobile s `valid_from` = příští měsíc.
2. `GET /api/fixed-expenses?period=<minulý měsíc>` → vrací NORDIC, ne T-Mobile.
3. `GET /api/fixed-expenses?period=<příští měsíc>` → vrací T-Mobile, ne NORDIC.
4. `GET /api/fixed-expenses` (bez period) → vrací oba.
5. V prohlížeči: FixedExpensesPage ukazuje oba řádky, NORDIC ztlumený se štítkem „ukončeno", T-Mobile se štítkem „od".

- [ ] **Step 3: Push staging**

```bash
git push origin staging
```

Nahlásit číslo verze. Railway nasadí staging automaticky.

- [ ] **Step 4: Nasazení do produkce**

Uživatel předem autorizoval prod deploy („projeď komplet vývoj až po nasazení na prod"):

```bash
git checkout main
git merge staging
git push origin main
git checkout staging
```

Potvrdit uživateli, že produkce je aktuální, s číslem verze. Migrace sloupců proběhne automaticky při startu (`initSchema`), žádná data-migrace není potřeba (existující řádky = NULL/NULL, chování beze změny).
