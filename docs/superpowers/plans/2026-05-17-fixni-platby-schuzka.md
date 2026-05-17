# Fixní platby + přepracování Schůzky — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sledovat 5 fixních plateb na stránce Schůzka (stav ✅/⚠️/❌ proti reálným transakcím), zobrazit skutečně nasporeno a kumulovanou Harmonickou rezervu.

**Architecture:** Přístup C — editovatelný tracker zůstává v tabulce/route `fixed_expenses`, stabilní bankovní fakta jsou config-as-code v `src/utils/recurring.js`. Výpočetní logika je v čistých funkcích (unit-testovatelných), routes je jen napojí na SQL. Stav se počítá při čtení, žádná denormalizace.

**Tech Stack:** Node.js + Express, better-sqlite3, React + Vite, node:test (bez `npm test` skriptu — testy se spouští `node --test <soubor>`).

**Spec:** `docs/superpowers/specs/2026-05-17-fixni-platby-schuzka-design.md`

---

## File Structure

- **Create** `src/utils/recurring.js` — config (konstanta tolerance, čísla účtů, reservePaidPatterns) + čisté funkce `paymentStatus`, `savingsNet`, `reserveBalance`. Jedna odpovědnost: doménová logika pravidelných plateb.
- **Create** `src/utils/recurring.test.js` — node:test pro čisté funkce.
- **Modify** `src/db/schema.js` — `ALTER TABLE fixed_expenses ADD COLUMN match_pattern`.
- **Modify** `src/routes/fixed-expenses.js` — GET `?period=` dopočítá stav; POST/PATCH přijmou `match_pattern`.
- **Modify** `src/routes/stats.js` — overview přidá `savings` + `reserve`.
- **Modify** `scripts/seed/fixed-expenses.js` — nové pole skupiny A s `match_pattern`.
- **Modify** `scripts/rebuild.cjs:89-90` — INSERT vč. `match_pattern`.
- **Modify** `scripts/seed/rules.js` — `textOverrides` pro předplatné/ČT/tracker patterny.
- **Modify** `scripts/seed/seed.test.js` — test nového seedu fixních výdajů.
- **Modify** `client/src/pages/ReportPage.jsx` — sekce „Fixní platby" se stavy, blok „Spoření & rezerva", přestrukturovaná „Bilance".

---

## Task 1: Schema — sloupec match_pattern

**Files:**
- Modify: `src/db/schema.js` (konec `initSchema()`, mezi ostatní `try/catch` ALTER bloky)

- [ ] **Step 1: Najít místo migrací**

Run: `grep -n "ALTER TABLE" src/db/schema.js`
Expected: výpis existujících `ALTER TABLE … try/catch` migrací na konci `initSchema()`.

- [ ] **Step 2: Přidat migraci**

Za poslední existující `ALTER TABLE` blok přidej (zachovej styl okolních bloků — `try { db.exec(...) } catch {}`):

```js
try { db.exec(`ALTER TABLE fixed_expenses ADD COLUMN match_pattern TEXT`); } catch {}
```

- [ ] **Step 3: Ověřit, že migrace projde**

Run: `node -e "require('./src/db/connection'); const db=require('./src/db/connection'); console.log(db.prepare('PRAGMA table_info(fixed_expenses)').all().map(c=>c.name).join(','))"`
Expected: výpis sloupců obsahuje `match_pattern`.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.js
git commit -m "feat: fixed_expenses.match_pattern sloupec"
```

---

## Task 2: Config + čisté výpočetní funkce (TDD)

**Files:**
- Create: `src/utils/recurring.js`
- Test: `src/utils/recurring.test.js`

- [ ] **Step 1: Napsat padající testy**

Vytvoř `src/utils/recurring.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentStatus, savingsNet, reserveBalance, MATCH_TOLERANCE_PCT } = require('./recurring');

test('paymentStatus: žádná shoda → missing', () => {
  assert.equal(paymentStatus(38126, 0, 0), 'missing');
});

test('paymentStatus: přesná shoda → ok', () => {
  assert.equal(paymentStatus(38126, 38126, 1), 'ok');
});

test('paymentStatus: do 5 % → ok (hranice přesně 5 %)', () => {
  assert.equal(paymentStatus(1000, 1050, 1), 'ok');   // 5.0 %
});

test('paymentStatus: těsně nad 5 % → mismatch', () => {
  assert.equal(paymentStatus(1000, 1051, 1), 'mismatch'); // 5.1 %
});

test('paymentStatus: očekávaná ≤ 0 → null (žádný stav)', () => {
  assert.equal(paymentStatus(0, 100, 1), null);
});

test('savingsNet: vklady − výběry', () => {
  assert.equal(savingsNet({ deposits: 30000, withdrawals: 5800 }), 24200);
});

test('reserveBalance: vklady − nájem − PRE − vratky', () => {
  assert.equal(
    reserveBalance({ envelopeDeposits: 135000, najemSum: 114378, preSum: 10500, envelopeReturns: 37254 }),
    -27132
  );
});

test('MATCH_TOLERANCE_PCT je 5', () => {
  assert.equal(MATCH_TOLERANCE_PCT, 5);
});
```

- [ ] **Step 2: Spustit testy — musí padnout**

Run: `node --test src/utils/recurring.test.js`
Expected: FAIL — `Cannot find module './recurring'`.

- [ ] **Step 3: Implementovat modul**

Vytvoř `src/utils/recurring.js`:

```js
'use strict';

const MATCH_TOLERANCE_PCT = 5;

// Stabilní bankovní fakta (stejný princip jako ownAccountNumbers v scripts/seed/rules.js)
const savingsAccount = '1679014082';
const reserveAccount = '1679014066';
const reservePaidPatterns = ['JANA HRDLIČKOVÁ', 'Pražská energetika'];

/**
 * Stav fixní platby za období.
 * @returns 'ok' | 'mismatch' | 'missing' | null  (null = bez stavu)
 */
function paymentStatus(expected, actual, txCount) {
  if (!(expected > 0)) return null;
  if (!txCount || txCount === 0) return 'missing';
  const diffPct = (Math.abs(actual - expected) / expected) * 100;
  return diffPct <= MATCH_TOLERANCE_PCT ? 'ok' : 'mismatch';
}

function savingsNet({ deposits, withdrawals }) {
  return deposits - withdrawals;
}

function reserveBalance({ envelopeDeposits, najemSum, preSum, envelopeReturns }) {
  return envelopeDeposits - najemSum - preSum - envelopeReturns;
}

module.exports = {
  MATCH_TOLERANCE_PCT,
  savingsAccount,
  reserveAccount,
  reservePaidPatterns,
  paymentStatus,
  savingsNet,
  reserveBalance,
};
```

- [ ] **Step 4: Spustit testy — musí projít**

Run: `node --test src/utils/recurring.test.js`
Expected: PASS, 8 testů.

- [ ] **Step 5: Commit**

```bash
git add src/utils/recurring.js src/utils/recurring.test.js
git commit -m "feat: recurring.js – config + čisté výpočetní funkce + testy"
```

---

## Task 3: Route fixed-expenses — stav + match_pattern

**Files:**
- Modify: `src/routes/fixed-expenses.js`

- [ ] **Step 1: Rozšířit manuální větev GET o stav**

V `src/routes/fixed-expenses.js`, v handleru `GET /`, nahraď blok od `const manual = …` po `if (!req.query.period) return res.json(manual);` tímto (zachovej `require` styl souboru):

```js
const { paymentStatus } = require('../utils/recurring');

const manual = db.prepare(
  "SELECT *, 'manual' as source FROM fixed_expenses WHERE user_id = ? ORDER BY sort_order ASC, id ASC"
).all(req.user.id);

if (!req.query.period) return res.json(manual);

const { getPeriodDates, getUserBillingDay } = require('../utils/period');
const billingDay = getUserBillingDay(db, req.user.id);
const { start, end } = getPeriodDates(billingDay, req.query.period);

const matchStmt = db.prepare(`
  SELECT COALESCE(SUM(ABS(amount)), 0) AS actual, COUNT(*) AS tx_count
  FROM transactions
  WHERE user_id = ? AND amount < 0 AND date >= ? AND date <= ?
    AND description LIKE '%' || ? || '%'
`);

const manualWithStatus = manual.map(row => {
  if (!row.match_pattern) return row;
  const m = matchStmt.get(req.user.id, start, end, row.match_pattern);
  return {
    ...row,
    actual: m.actual,
    tx_count: m.tx_count,
    status: paymentStatus(row.amount, m.actual, m.tx_count),
  };
});
```

A níže ve stejném handleru změň finální `res.json([...manual, ...fromAccounts]);` na:

```js
res.json([...manualWithStatus, ...fromAccounts]);
```

- [ ] **Step 2: POST/PATCH přijmou match_pattern**

V `POST /`, rozšiř destrukturalizaci a INSERT:

```js
const { name, amount, note, sort_order, match_pattern } = req.body;
if (!name || amount == null) return res.status(400).json({ error: 'Název a částka jsou povinné.' });
const result = db.prepare(
  'INSERT INTO fixed_expenses (user_id, name, amount, note, sort_order, match_pattern) VALUES (?, ?, ?, ?, ?, ?)'
).run(req.user.id, name.trim(), parseFloat(amount), note || null, sort_order ?? 0,
  match_pattern && match_pattern.trim() ? match_pattern.trim() : null);
```

V `PATCH /:id`, rozšiř destrukturalizaci a UPDATE:

```js
const { name, amount, note, sort_order, match_pattern } = req.body;
db.prepare('UPDATE fixed_expenses SET name = ?, amount = ?, note = ?, sort_order = ?, match_pattern = ? WHERE id = ?').run(
  name ?? row.name,
  amount != null ? parseFloat(amount) : row.amount,
  note !== undefined ? (note || null) : row.note,
  sort_order ?? row.sort_order,
  match_pattern !== undefined ? (match_pattern && match_pattern.trim() ? match_pattern.trim() : null) : row.match_pattern,
  row.id
);
```

- [ ] **Step 3: Syntaktická kontrola**

Run: `node -e "require('./src/routes/fixed-expenses')"`
Expected: žádný výstup (modul se načte bez chyby).

- [ ] **Step 4: Manuální ověření přes běžící server**

Run: `npm run dev` (jiný terminál), pak:
`curl -s -b <session-cookie> 'http://localhost:3000/api/fixed-expenses?period=2026-04' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.stringify(JSON.parse(d).filter(r=>r.match_pattern),null,1)))"`
Expected: položky s `match_pattern` mají pole `actual`, `tx_count`, `status` (`ok`/`mismatch`/`missing`). (Session cookie získej přihlášením v prohlížeči a zkopírováním z devtools; lokální setup viz memory feedback_local_dev.)

- [ ] **Step 5: Commit**

```bash
git add src/routes/fixed-expenses.js
git commit -m "feat: fixed-expenses GET dopočítá stav, POST/PATCH match_pattern"
```

---

## Task 4: Route stats — savings + reserve

**Files:**
- Modify: `src/routes/stats.js`

- [ ] **Step 1: Přidat výpočet savings + reserve do /overview**

V `src/routes/stats.js`, na začátek souboru přidej require:

```js
const { savingsNet, reserveBalance, savingsAccount, reserveAccount, reservePaidPatterns } = require('../utils/recurring');
```

V handleru `GET /overview`, před `res.json({…})`, přidej:

```js
const sav = db.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS deposits,
    COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS withdrawals
  FROM transactions
  WHERE user_id = ? AND counterparty_account LIKE ? || '%'
    AND date >= ? AND date <= ?
`).get(req.user.id, savingsAccount, start, end);
const savings = { deposits: sav.deposits, withdrawals: sav.withdrawals, net: savingsNet(sav) };

const envCol = db.prepare(`
  SELECT
    COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS envelopeDeposits,
    COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS envelopeReturns
  FROM transactions
  WHERE user_id = ? AND counterparty_account LIKE ? || '%' AND date <= ?
`).get(req.user.id, reserveAccount, end);
const paidStmt = db.prepare(`
  SELECT COALESCE(SUM(ABS(amount)), 0) AS s
  FROM transactions
  WHERE user_id = ? AND amount < 0 AND date <= ? AND description LIKE '%' || ? || '%'
`);
const najemSum = paidStmt.get(req.user.id, end, reservePaidPatterns[0]).s;
const preSum   = paidStmt.get(req.user.id, end, reservePaidPatterns[1]).s;
const reserve = {
  balance: reserveBalance({
    envelopeDeposits: envCol.envelopeDeposits,
    najemSum, preSum,
    envelopeReturns: envCol.envelopeReturns,
  }),
};
```

A do `res.json({…})` přidej klíče `savings,` a `reserve,`.

- [ ] **Step 2: Syntaktická kontrola**

Run: `node -e "require('./src/routes/stats')"`
Expected: žádná chyba.

- [ ] **Step 3: Manuální ověření**

Run (server běží): `curl -s -b <session-cookie> 'http://localhost:3000/api/stats/overview?period=2026-04' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('savings',j.savings,'reserve',j.reserve)})"`
Expected: `savings { deposits, withdrawals, net }` a `reserve { balance }` s číselnými hodnotami.

- [ ] **Step 4: Commit**

```bash
git add src/routes/stats.js
git commit -m "feat: stats/overview přidá savings + reserve"
```

---

## Task 5: Seed fixed-expenses + rebuild + test

**Files:**
- Modify: `scripts/seed/fixed-expenses.js`
- Modify: `scripts/rebuild.cjs` (řádky 88-90)
- Modify: `scripts/seed/seed.test.js`

- [ ] **Step 1: Napsat padající test seedu**

Do `scripts/seed/seed.test.js` přidej (`fixed` už je naimportováno na začátku souboru):

```js
test('fixní výdaje: skupina A, každý má match_pattern a kladnou částku', () => {
  assert.equal(fixed.length, 5);
  const names = fixed.map(f => f.name);
  assert.deepEqual(names, [
    'Nájem Stodůlky', 'Záloha energie PRE', 'Splátka auta RAV4',
    'Telefon T-Mobile', 'Internet Nordic',
  ]);
  for (const f of fixed) {
    assert.ok(f.match_pattern && f.match_pattern.length > 0, f.name);
    assert.ok(f.amount > 0, f.name);
    assert.ok(Number.isInteger(f.sort_order), f.name);
  }
});
```

- [ ] **Step 2: Spustit — musí padnout**

Run: `node --test scripts/seed/seed.test.js`
Expected: FAIL (staré pole má jiný počet/názvy, chybí `match_pattern`).

- [ ] **Step 3: Přepsat seed**

Nahraď celý obsah `scripts/seed/fixed-expenses.js`:

```js
'use strict';
module.exports = [
  { name: 'Nájem Stodůlky',     amount: 38126, match_pattern: 'JANA HRDLIČKOVÁ',   sort_order: 1 },
  { name: 'Záloha energie PRE', amount: 3500,  match_pattern: 'Pražská energetika', sort_order: 2 },
  { name: 'Splátka auta RAV4',  amount: 13255, match_pattern: 'Toyota Financial',   sort_order: 3 },
  { name: 'Telefon T-Mobile',   amount: 2590,  match_pattern: 'T-Mobile',           sort_order: 4 },
  { name: 'Internet Nordic',    amount: 445,   match_pattern: 'Nordic Telecom',     sort_order: 5 },
];
```

- [ ] **Step 4: Rozšířit INSERT v rebuild.cjs**

V `scripts/rebuild.cjs`, řádky 88-90 (sekce „5. SEED fixní výdaje"), nahraď:

```js
  const insFx = db.prepare('INSERT INTO fixed_expenses (user_id, name, amount, sort_order, match_pattern) VALUES (?, ?, ?, ?, ?)');
  for (const f of fixedExpenses) insFx.run(USER_ID, f.name, f.amount, f.sort_order, f.match_pattern || null);
```

- [ ] **Step 5: Spustit testy — musí projít**

Run: `node --test scripts/seed/seed.test.js`
Expected: PASS (vč. nového testu). Pokud jiný existující test závisel na starých fixních výdajích, oprav ho na nová data.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed/fixed-expenses.js scripts/rebuild.cjs scripts/seed/seed.test.js
git commit -m "feat: seed skupiny A fixních plateb + rebuild match_pattern"
```

---

## Task 6: Seed rules — kategorizace předplatného a tracker plateb

**Files:**
- Modify: `scripts/seed/rules.js`
- Test: `scripts/lib/apply-rules.test.js` (ověření, že nové patterny kategorizují správně)

- [ ] **Step 1: Přidat textOverrides**

V `scripts/seed/rules.js`, do pole `textOverrides` přidej na konec (pořadí = priorita, první shoda vyhrává; tyto patterny jsou specifické, kolize nehrozí):

```js
    // Tracker fixních plateb → Pravidelné platby (mimo měsíční budgety)
    { pattern: 'JANA HRDLIČKOVÁ', category: 'Pravidelné platby' },
    { pattern: 'Pražská energetika', category: 'Pravidelné platby' },
    { pattern: 'Toyota Financial', category: 'Pravidelné platby' },
    { pattern: 'T-Mobile', category: 'Pravidelné platby' },
    { pattern: 'Nordic Telecom', category: 'Pravidelné platby' },
    { pattern: 'ČESKÁ TELEVIZE', category: 'Pravidelné platby' },
    // Digitální předplatné → Licence (Typ 2, roční)
    { pattern: 'OPENAI', category: 'Licence' },
    { pattern: 'Google Workspace', category: 'Licence' },
    { pattern: 'DISCORD', category: 'Licence' },
    { pattern: 'NUELINK', category: 'Licence' },
    { pattern: 'OPUS CLIP', category: 'Licence' },
    { pattern: 'P.SKOOL.COM', category: 'Licence' },
```

(`RAILWAY` se NEpřidává — kolize s jízdným, viz spec 2.4.)

- [ ] **Step 2: Ověřit, že cílové kategorie existují**

Run: `node -e "const c=require('./scripts/seed/categories');const need=['Pravidelné platby','Licence'];for(const n of need)console.log(n, c.some(x=>x.name===n))"`
Expected: `Pravidelné platby true` a `Licence true`.

- [ ] **Step 3: Ověřit kategorizaci přes apply-rules test**

Do `scripts/lib/apply-rules.test.js` přidej test (zkontroluj nejdřív skutečnou signaturu `applyRules(tx, account, rules)` v souboru a přizpůsob volání existujícímu stylu testů v tomto souboru):

```js
test('Toyota Financial → Pravidelné platby (RAV mimo PHM)', () => {
  const rules = require('../seed/rules');
  const cat = applyRules({ description: 'Toyota Financial Services Czech s.r.o.', amount: -13255 }, null, rules);
  assert.equal(cat, 'Pravidelné platby');
});

test('OPENAI → Licence', () => {
  const rules = require('../seed/rules');
  const cat = applyRules({ description: 'OPENAI *CHATGPT SUBSCR', amount: -430 }, null, rules);
  assert.equal(cat, 'Licence');
});
```

- [ ] **Step 4: Spustit test**

Run: `node --test scripts/lib/apply-rules.test.js`
Expected: PASS. (Pokud signatura `applyRules` vyžaduje jiné argumenty, uprav volání podle existujících testů v souboru — neměň `apply-rules.js`.)

- [ ] **Step 5: Commit**

```bash
git add scripts/seed/rules.js scripts/lib/apply-rules.test.js
git commit -m "feat: kategorizace tracker plateb (Pravidelné platby) + předplatné (Licence)"
```

---

## Task 7: Frontend — ReportPage.jsx

**Files:**
- Modify: `client/src/pages/ReportPage.jsx`

Frontend nemá testovací harness — ověřuje se manuálně v prohlížeči.

- [ ] **Step 1: Stavová logika + render sekce „Fixní platby" (varianta B)**

V `client/src/pages/ReportPage.jsx` přidej helper k ostatním nahoře (vedle `budgetStatus`):

```js
const FIXED_STATUS = {
  ok:       { icon: '✅', text: '' },
  mismatch: { icon: '⚠️', text: 'jiná částka' },
  missing:  { icon: '❌', text: 'chybí' },
};
```

V JSX nahraď nadpis sekce `Pevné výdaje` za `Fixní platby`. V seznamu `fixedExpenses.map(...)` zobrazovaného řádku (větev `report-income-row`, ne edit formulář) uprav obsah tak, aby u řádků s `row.status` ukázal ikonu a u `mismatch`/`missing` odchylku textem (varianta B — bez barevného pruhu, styl konzistentní s `report-budget-row`):

```jsx
<div key={row.id} className="report-income-row">
  {row.status && <span title={row.status}>{FIXED_STATUS[row.status].icon}</span>}
  <span className="report-income-person">{row.name}</span>
  {row.note && <span className="text-muted" style={{ fontSize: 12 }}>{row.note}</span>}
  {row.status === 'mismatch' && (
    <span className="text-muted" style={{ fontSize: 12 }}>
      {row.actual > row.amount ? '+' : '−'}{formatCurrency(Math.abs(row.actual - row.amount))} oproti plánu
      {row.tx_count > 1 ? ` · ${row.tx_count} platby` : ''}
    </span>
  )}
  {row.status === 'missing' && (
    <span className="text-muted" style={{ fontSize: 12 }}>chybí</span>
  )}
  <span className="report-income-amount">{formatCurrency(row.amount)}</span>
  <button className="btn btn-ghost btn-icon"
    onClick={() => { setShowFixedForm(false); setEditFixed(row); }}>
    <Pencil size={13} />
  </button>
  <button className="btn btn-ghost btn-icon" onClick={() => handleDeleteFixed(row.id)}>
    <Trash2 size={13} />
  </button>
</div>
```

Pod seznam (před `report-subtotal`) přidej souhrn:

```jsx
{fixedExpenses.some(f => f.status) && (() => {
  const s = k => fixedExpenses.filter(f => f.status === k).length;
  return (
    <div style={{ display: 'flex', gap: 16, fontSize: 13, marginTop: 4 }}>
      {s('ok') > 0 && <span>✅ {s('ok')} proběhly</span>}
      {s('mismatch') > 0 && <span>⚠️ {s('mismatch')} jiná částka</span>}
      {s('missing') > 0 && <span>❌ {s('missing')} chybí</span>}
    </div>
  );
})()}
```

- [ ] **Step 2: Přidat match_pattern do FixedExpenseForm**

Ve `FixedExpenseForm` přidej stav a pole:

```jsx
const [matchPattern, setMatchPattern] = useState(initial?.match_pattern || '');
```

Do `body` v `handleSubmit`:

```js
const body = { name: name.trim(), amount: amt, note: note || null, match_pattern: matchPattern.trim() || null };
```

Do formuláře (za pole „Poznámka"):

```jsx
<input className="input" placeholder="Pattern transakce (volitelně)"
  value={matchPattern} onChange={e => setMatchPattern(e.target.value)} style={{ maxWidth: 180 }} />
```

- [ ] **Step 3: Konzumovat savings + reserve ze stats**

V komponentě `ReportPage` jsou `stats` z `/api/stats/overview`. Odvoď:

```js
const savings = stats?.savings || { net: 0 };
const reserve = stats?.reserve || { balance: 0 };
```

- [ ] **Step 4: Blok „Spoření & rezerva" + přestrukturovat Bilanci**

Před sekci `report-section--bilance` vlož nový blok:

```jsx
<section className="report-section">
  <div className="report-section-header">
    <h2 className="report-section-title">Spoření &amp; rezerva</h2>
  </div>
  <div className="report-budget-list">
    <div className="report-budget-row">
      <span className="report-budget-name">Skutečně nasporeno (za období)</span>
      <span className="report-budget-spent" style={{ color: savings.net >= 0 ? 'var(--ok, #16a34a)' : 'var(--danger)' }}>
        {savings.net >= 0 ? '+ ' : '− '}{formatCurrency(Math.abs(savings.net))}
      </span>
    </div>
    <div className="report-budget-row">
      <span className="report-budget-name">Harmonická rezerva (kumulativně)</span>
      <span className="report-budget-spent">{formatCurrency(reserve.balance)}</span>
    </div>
  </div>
  <div className="report-pill text-muted" style={{ fontSize: 12, marginTop: 6 }}>
    netto převodů na spořicí účet · zůstatek obálky po nájmu a PRE
  </div>
</section>
```

V sekci `report-section--bilance` nahraď poslední řádek (`report-bilance-result` „Na spořicí účet") za:

```jsx
<div className={`report-bilance-row report-bilance-result ${savings.net >= 0 ? '' : 'text-danger'}`}>
  <span>Skutečně nasporeno</span>
  <span>{savings.net >= 0 ? '+' : '−'} {formatCurrency(Math.abs(savings.net))}</span>
</div>
<div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
  Výsledek je měřené netto převodů, ne aritmetický rozdíl rozpadu výše.
</div>
```

(Řádky rozpadu Příjmy / − Pevné výdaje / − Variabilní výdaje zůstávají beze změny — jsou informativní.)

- [ ] **Step 5: Build ověří, že JSX je validní**

Run: `npm run build`
Expected: build projde bez chyby (Vite zkompiluje `client/`).

- [ ] **Step 6: Manuální vizuální ověření**

Run: `npm run dev`, otevři Schůzku v prohlížeči, projdi obdobími.
Expected: sekce „Fixní platby" ukazuje ✅/⚠️/❌ + souhrn; u ⚠️ je odchylka textem; blok „Spoření & rezerva" má dvě čísla; Bilance končí řádkem „Skutečně nasporeno" s popiskem. Žádná položka fixní platby se neobjeví v progress barech měsíčních budgetů (díky kategorizaci do „Pravidelné platby").

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/ReportPage.jsx
git commit -m "feat: Schůzka – tracker fixních plateb, blok spoření/rezerva, bilance"
```

---

## Task 8: End-to-end ověření + nasazení

**Files:** žádné změny kódu — ověření a deploy.

- [ ] **Step 1: Rebuild lokální DB z configu**

Run: `node scripts/rebuild.cjs` (přečti si nejdřív hlavičku skriptu — je destruktivní, re-seeduje per-user data a re-kategorizuje transakce; lokální postup viz memory feedback_local_dev).
Expected: skript proběhne, závěrečný souhrn ukáže `fixed_expenses: 5`, kategorie/pravidla bez chyb.

- [ ] **Step 2: Ověřit dopady kategorizace**

Run: `node -e "const db=require('./src/db/connection');const r=db.prepare(\"SELECT c.name,COUNT(*) n FROM transactions t JOIN categories c ON c.id=t.category_id WHERE c.name IN ('Pravidelné platby','Licence','Auto Moto - PHM') GROUP BY c.name\").all();console.log(r)"`
Expected: `Pravidelné platby` obsahuje tracker platby; `Auto Moto - PHM` už neobsahuje splátku RAV (počet klesl oproti stavu před změnou).

- [ ] **Step 3: Spustit všechny dostupné testy**

Run: `node --test src/utils/recurring.test.js scripts/seed/seed.test.js scripts/lib/apply-rules.test.js`
Expected: vše PASS.

- [ ] **Step 4: Commit (pokud zbylo necommitnuté) a push na staging**

```bash
git push origin staging
```
Expected: Railway nasadí staging. Po pushi nahlas uživateli číslo verze (auto-bump hookem). Deploy do produkce jen na explicitní pokyn dle CLAUDE.md workflow.

---

## Self-Review (provedeno při psaní plánu)

**Spec coverage:**
- Schema (spec 3.1) → Task 1
- Config modul (3.2) → Task 2
- GET fixed-expenses stav + POST/PATCH (4.1) → Task 3
- stats savings + reserve (4.2) → Task 4
- seed fixed-expenses + rebuild (5.1) → Task 5
- rules.js předplatné/ČT (5.2) + tracker→Pravidelné platby (5.3) → Task 6
- frontend sekce/blok/bilance + varianta B (6.1–6.3) → Task 7
- edge cases (7): NULL pattern → Task 3 (`if (!row.match_pattern) return row`); expected ≤ 0 → Task 2 `paymentStatus`; víc shod → Task 3 `tx_count` + Task 7 render; chybí savings/reserve → Task 7 default
- testy (8) → Task 2, 5, 6, 8
- nasazení (9) → Task 8

**Placeholder scan:** žádné TBD/TODO; každý krok má konkrétní kód a příkaz.

**Type consistency:** `paymentStatus(expected, actual, txCount)`, `savingsNet({deposits,withdrawals})`, `reserveBalance({envelopeDeposits,najemSum,preSum,envelopeReturns})` — názvy konzistentní mezi Task 2 (definice/testy), Task 3 a Task 4 (volání). JSON pole `actual`/`tx_count`/`status` konzistentní mezi Task 3 (backend) a Task 7 (frontend).

**Známé riziko ověřit při exekuci:** přesná signatura `applyRules` v `scripts/lib/apply-rules.js` (Task 6 Step 3 — přizpůsobit voláním podle existujících testů, neměnit knihovnu).
