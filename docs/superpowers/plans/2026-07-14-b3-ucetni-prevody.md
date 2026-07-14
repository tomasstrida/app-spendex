# B-3 Účetní kategorie + Převody interní na Schůzce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zavést účetní kategorie (`categories.type = 4`) vyloučené z výdajů a zobrazit na Schůzce sekci „Účetní" se saldem interních převodů (kontrola nulového salda).

**Architecture:** Reuse existujícího sloupce `categories.type` čtvrtou hodnotou (4 = účetní). Backend `stats.js` přidá blok `accounting` (saldo per účetní kategorie napříč všemi účty). Frontend přidá sekci na Schůzce a čtvrtou volbu typu na stránce Kategorie. Seed + retroaktivní migrace přepnou „Převody" na type 4.

**Tech Stack:** Node.js + Express, better-sqlite3, React + Vite, vlastní CSS. Testy `node:test` (backend route testy přes express + fetch).

## Global Constraints

- **Model:** účetní = `categories.type = 4` (1 měsíční / 2 roční / 3 fond / 4 účetní). Žádná schema změna, žádný nový sloupec.
- **Saldo Převodů = `SUM(t.amount)` napříč VŠEMI účty** — bez `SPENDING_FILTER`, bez filtru na roli. Kladné = příliv, záporné = odliv, ~0 = vyrovnané.
- **Kategorie „Převody" se NEpřejmenovává** (seed `internalTransferCategory: 'Převody'` + L0 pravidlo mapují jménem).
- **Účetní se automaticky vyloučí z výdajů** — Dashboard i Měsíční výdaje na Schůzce už filtrují `category_type === 1`, beze změny.
- **Data isolation:** všechny dotazy filtrují `user_id` / `req.dataUserId`.
- **Čeština** v UI. **VERSION/package.json needitovat ručně** (husky bumpne sám).
- **Non-goals:** Drahé věci (odloženo), Příjmy (jiný bod), rozpočty/rozpad transakcí u účetních, přejmenování Převodů.
- Nasazení: commit + push do `staging`. Merge do `main` až na pokyn. Retroaktivní migrace na prod až po nasazení + potvrzení.

---

### Task 1: Backend — stats blok `accounting`

**Files:**
- Modify: `src/routes/stats.js` (za blok `bySubcategory` ~ř. 43-51; response `res.json` ~ř. 141-154)
- Test: `src/routes/stats.test.js`

**Interfaces:**
- Consumes: nic z předchozích tasků.
- Produces: `GET /api/stats/overview` vrací nové pole
  `accounting: [{ id: number, name: string, color: string, icon: string, saldo: number, tx_count: number }]`
  — jen kategorie `type = 4`, saldo přes všechny účty. Konzumuje Task 4 (ReportPage).

- [ ] **Step 1: Napsat failing testy**

Přidej na konec `src/routes/stats.test.js` (vzor existujícího `setup()`/`listen()` v tom souboru):

```js
test('accounting: saldo účetní kategorie (type=4) přes VŠECHNY účty vč. ignored', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (7,1,'Převody',4)").run();
  // účet role='ignored' NESMÍ být vyfiltrován (na rozdíl od SPENDING_FILTER)
  const accId = db.prepare("INSERT INTO accounts (user_id, account_number, name, role) VALUES (1,'999','Spořicí','ignored')").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description,account_id) VALUES (1,7,-5000,'2026-07-05','Převod na spoření',NULL),(1,7,5000,'2026-07-05','Převod ze spoření',?)").run(accId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  const row = (stats.accounting || []).find(r => r.id === 7);
  assert.ok(row, 'účetní kategorie musí být v accounting');
  assert.equal(row.saldo, 0, 'saldo obou noh převodu = 0');
  assert.equal(row.tx_count, 2);
  server.close();
});

test('accounting: kategorie type 1/2/3 se v accounting neobjeví', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (8,1,'Jídlo',1),(9,1,'Licence',2)").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,8,-300,'2026-07-05','Rohlik')").run();
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal((stats.accounting || []).length, 0);
  server.close();
});
```

- [ ] **Step 2: Spustit testy — musí selhat**

Run: `node --test src/routes/stats.test.js`
Expected: FAIL (`stats.accounting` je `undefined` → `.find`/`.length` na prázdném poli projde u druhého testu, ale první selže na `assert.ok(row)`).

- [ ] **Step 3: Přidat blok `accounting` do stats.js**

V `src/routes/stats.js` za blok `bySubcategory` (za ř. 51, před `// Posledních 12 období`) vlož:

```js
  // Účetní kategorie (type=4): saldo napříč VŠEMI účty (bez SPENDING_FILTER),
  // aby interní převody vyšly na nulu. Kladné=příliv, záporné=odliv, ~0=vyrovnané.
  const accounting = db.prepare(`
    SELECT c.id, c.name, c.color, c.icon,
      COALESCE(SUM(t.amount), 0) AS saldo,
      COUNT(t.id) AS tx_count
    FROM categories c
    LEFT JOIN transactions t ON t.category_id = c.id
      AND t.user_id = ?
      AND t.date >= ? AND t.date <= ?
    WHERE c.user_id = ? AND c.type = 4
    GROUP BY c.id
    ORDER BY c.name ASC
  `).all(req.dataUserId, start, end, req.dataUserId);
```

- [ ] **Step 4: Přidat `accounting` do response**

V `res.json({ ... })` (~ř. 141) přidej řádek za `expensive_items: expensiveItems,`:

```js
    accounting,
```

- [ ] **Step 5: Spustit testy — musí projít**

Run: `node --test src/routes/stats.test.js`
Expected: PASS (všechny testy stats vč. dvou nových).

- [ ] **Step 6: Commit**

```bash
git add src/routes/stats.js src/routes/stats.test.js
git commit -m "feat(accounting): stats vrací saldo účetních kategorií (type=4) přes všechny účty"
```

---

### Task 2: Seed „Převody" → type 4 + categories route test

**Files:**
- Modify: `scripts/seed/categories.js:26` (kategorie „Převody")
- Test: `src/routes/categories.test.js`

**Interfaces:**
- Consumes: nic.
- Produces: seed má „Převody" jako `type: 4`. Route `PATCH /api/categories/:id` s `type: 4` (beze změny kódu — stávající `if (newType !== 1)` už maže budgety) ověřen testem.

- [ ] **Step 1: Napsat failing test**

Přidej do `src/routes/categories.test.js` (za existující test „PATCH type 1→3 (fond)…", vzor je hned nad ním):

```js
test('PATCH type 1→4 (účetní): smaže měsíční budgety', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO budgets (user_id, category_id, month, amount) VALUES (1,10,'default',2000),(1,10,'2026-06',3000)").run();

  const res = await fetch(`${base}/api/categories/10`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ type: 4 }) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).type, 4);

  const left = db.prepare("SELECT COUNT(*) c FROM budgets WHERE user_id=1 AND category_id=10").get().c;
  assert.equal(left, 0, 'měsíční budgety měly být při přepnutí na účetní smazány');
  server.close();
});
```

- [ ] **Step 2: Spustit test — musí projít rovnou**

Run: `node --test src/routes/categories.test.js`
Expected: PASS (route už type=4 zvládá přes `newType !== 1`). Tento test je regresní pojistka, ne nová funkčnost.

Pozn.: pokud by test selhal, znamená to, že route validuje `type` na whitelist 1-3 — pak je potřeba do route přidat 4 mezi povolené hodnoty. Podle inspekce route (`type ?? cat.type ?? 1`, bez whitelistu) to ale projde.

- [ ] **Step 3: Přepnout seed „Převody" na type 4**

V `scripts/seed/categories.js` změň řádek s „Převody":

```js
  { name: 'Převody', type: 4 },
```

(byl `type: 1`.)

- [ ] **Step 4: Ověřit seed test (pokud existuje) + syntaxe**

Run: `node --test src/db/seed.test.js 2>/dev/null || node -c scripts/seed/categories.js && echo "seed OK"`
Expected: projde (seed je validní JS; případný seed.test.js zelený).

- [ ] **Step 5: Commit**

```bash
git add scripts/seed/categories.js src/routes/categories.test.js
git commit -m "feat(accounting): seed Převody jako type=4 + test přepnutí kategorie na účetní"
```

---

### Task 3: Frontend — čtvrtá volba typu na stránce Kategorie

**Files:**
- Modify: `client/src/pages/CategoriesPage.jsx:179-183` (`TYPE_OPTIONS`)

**Interfaces:**
- Consumes: nic (PATCH `type` už funguje).
- Produces: v type selectoru přibude volba „Účetní" (value 4). Formulářové pole specifická pro fond (type===3) se pro type 4 nezobrazí (podmínky `type === 3` zůstávají).

- [ ] **Step 1: Přidat 4. položku do TYPE_OPTIONS**

V `client/src/pages/CategoriesPage.jsx` uprav `TYPE_OPTIONS` (ř. 179-183):

```js
const TYPE_OPTIONS = [
  { value: 1, label: 'Měsíční', desc: 'Pravidelný měsíční limit' },
  { value: 2, label: 'Roční / sezónní', desc: 'Nepravidelné výdaje s ročním limitem' },
  { value: 3, label: 'Drahé věci', desc: 'Jednorázové velké výdaje (brýle, telefon…)' },
  { value: 4, label: 'Účetní', desc: 'Převody mezi účty, nezapočítává se do výdajů' },
];
```

- [ ] **Step 2: Build — musí projít**

Run: `cd client && npm run build`
Expected: OK, bez chyb.

- [ ] **Step 3: Sebekontrola**

Ověř v kódu, že sekce formuláře podmíněné `type === 3` (typická cena / frekvence, ~ř. 266-281) se pro `type === 4` nevykreslí (podmínka je striktně `=== 3`, takže type 4 je nezobrazí — žádná změna nutná). Radio se 4 volbami se vejde do `.type-options` gridu.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/CategoriesPage.jsx
git commit -m "feat(accounting): volba typu Účetní na stránce Kategorie"
```

---

### Task 4: Frontend — sekce „Účetní" na Schůzce

**Files:**
- Modify: `client/src/pages/ReportPage.jsx` (odvození `accounting` ~ř. 205-206; nová sekce PŘED „Drahé věci" ~ř. 651)

**Interfaces:**
- Consumes: `stats.accounting` z Tasku 1 (`[{ id, name, color, icon, saldo, tx_count }]`).
- Produces: nic pro další tasky.

- [ ] **Step 1: Odvodit `accounting` ze stats**

V `client/src/pages/ReportPage.jsx` k řádkům `const byCategory = stats?.by_category || [];` (~ř. 205) přidej:

```js
  const accounting = stats?.accounting || [];
```

- [ ] **Step 2: Přidat sekci „Účetní" před „Drahé věci"**

Najdi komentář `{/* ── DRAHÉ VĚCI (Typ 3) ── */}` (~ř. 651) a PŘED něj vlož novou sekci. Reuse existujících tříd (`report-section`, `report-section-title`, `report-budget-list`, `report-bilance-row`, `budget-dot`, `text-danger`) — žádné nové CSS:

```jsx
          {/* ── ÚČETNÍ (Typ 4) ── */}
          {accounting.length > 0 && (
            <section className="report-section">
              <div className="report-section-header">
                <h2 className="report-section-title">Účetní</h2>
              </div>
              <div className="report-budget-list">
                {accounting.map(a => {
                  const balanced = Math.round(a.saldo) === 0;
                  return (
                    <Link
                      key={a.id}
                      to={`/transactions?category_id=${a.id}` + (period ? `&period=${period}` : '')}
                      className="report-bilance-row"
                      style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                    >
                      <span>
                        <span className="budget-dot" style={{ background: a.color || '#6366f1' }} />
                        {a.name}
                      </span>
                      <span
                        className={balanced ? '' : 'text-danger'}
                        title={balanced ? 'Vyrovnané saldo' : 'Nenulové saldo — zkontroluj chybějící nohu převodu'}
                      >
                        {formatCurrency(a.saldo)}{balanced ? '' : ' ⚠'}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
```

- [ ] **Step 3: Build — musí projít**

Run: `cd client && npm run build`
Expected: OK. Ověř, že `formatCurrency`, `Link` a `period` jsou v souboru už importované/dostupné (jsou — používají je stávající sekce).

- [ ] **Step 4: Sebekontrola**

- Sekce se nevykreslí, když `accounting.length === 0` (žádná prázdná sekce).
- Vyrovnané saldo (0) = neutrální barva; nenulové = `text-danger` + `⚠`.
- Účetní kategorie se NEobjeví v Měsíčních výdajích (ty filtrují `category_type === 1`, ověřeno v specu).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ReportPage.jsx
git commit -m "feat(accounting): sekce Účetní na Schůzce se saldem převodů"
```

---

### Task 5: Retroaktivní migrace + závěrečné kroky

**Files:**
- Create: `scripts/migrate-accounting-type.cjs`

**Interfaces:**
- Consumes: nic.
- Produces: skript, který přepne kategorii „Převody" na `type = 4` u existujících uživatelů (dry-run/CONFIRM).

- [ ] **Step 1: Napsat migrační skript**

Vytvoř `scripts/migrate-accounting-type.cjs` (vzor `scripts/migrate-subcategories.cjs`):

```js
'use strict';
// Retroaktivní přepnutí účetních kategorií na type=4.
// Dnes má kategorie „Převody" (interní přesuny mezi vlastními účty) type=1 → přepni na 4.
// Env: DB_PATH (povinné), CONFIRM=1 pro ostrý zápis (jinak dry-run).
// Aditivní: mění jen type a maže mrtvé měsíční budgety té kategorie; NEMAŽE transakce.
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH;
const CONFIRM = process.env.CONFIRM === '1';
if (!DB_PATH) { console.error('Chybí DB_PATH'); process.exit(1); }

// Názvy kategorií, které jsou účetní (rozšiřitelné).
const ACCOUNTING_NAMES = ['Převody'];

const db = new Database(DB_PATH);
const ph = ACCOUNTING_NAMES.map(() => '?').join(',');
const cats = db.prepare(
  `SELECT id, user_id, name, type FROM categories WHERE name IN (${ph}) AND type != 4`
).all(...ACCOUNTING_NAMES);

console.log(`Kandidátů na type=4: ${cats.length}`);
console.log(cats.slice(0, 20));
if (!CONFIRM) { console.log('Dry-run (CONFIRM=1 pro zápis).'); process.exit(0); }

const setType = db.prepare('UPDATE categories SET type = 4 WHERE id = ?');
const delBudgets = db.prepare('DELETE FROM budgets WHERE user_id = ? AND category_id = ?');
const tx = db.transaction(() => {
  for (const c of cats) { setType.run(c.id); delBudgets.run(c.user_id, c.id); }
});
tx();
console.log(`Přepnuto na type=4: ${cats.length}`);
```

- [ ] **Step 2: Ověřit dry-run lokálně**

Run: `DB_PATH=./data.db node scripts/migrate-accounting-type.cjs`
Expected: vypíše počet kandidátů + ukázku, NEzapíše (dry-run). Lokálně bez kategorie „Převody" = 0 kandidátů — OK, ověřuje jen, že skript běží bez chyby. Pokud `./data.db` chybí, spusť aspoň `node -c scripts/migrate-accounting-type.cjs` (syntax check) a uveď to.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-accounting-type.cjs
git commit -m "feat(accounting): retroaktivní migrace Převody→type=4 (dry-run/CONFIRM)"
```

Pozn.: prod spuštění (`railway ssh` + CONFIRM=1) až po nasazení kódu a s explicitním potvrzením uživatele — NENÍ součástí implementace.

## Závěrečné kroky

- [ ] **Celá backend sada:** `node --test 'src/**/*.test.js'` → vše PASS.
- [ ] **Client build:** `cd client && npm run build` → OK.
- [ ] **Push do staging:** `git push origin staging`. Nahlásit verzi. Po vizuální kontrole na pokyn merge do `main`. Retroaktivní migraci na prod až po nasazení, s potvrzením.

## Self-Review

**Spec coverage:**
- Model type=4 → Task 2 (seed) + Task 1/3/4 (použití) ✓
- Automatické vyloučení z výdajů → bez změny (existující `category_type === 1` filtry), ověřeno v specu ✓
- Schůzka sekce Účetní + saldo přes všechny účty → Task 1 (backend) + Task 4 (frontend) ✓
- Signál nenulového salda → Task 4 (`text-danger` + ⚠) ✓
- Správa na stránce Kategorie (type=4) → Task 3 ✓
- Migrace (seed + retroaktiv) → Task 2 (seed) + Task 5 (skript) ✓
- Non-goals (Drahé věci, Příjmy, přejmenování Převodů) → nedotčeno ✓

**Placeholder scan:** žádné TBD/TODO; každý krok má konkrétní kód nebo příkaz s očekávaným výstupem.

**Type consistency:** `accounting` pole má tvar `{ id, name, color, icon, saldo, tx_count }` v Tasku 1 (produkce) i Tasku 4 (konzumace) shodně. `type = 4` konzistentní napříč Task 1/2/3/5. Reuse jen existujících CSS tříd (`report-section`, `report-bilance-row`, `budget-dot`, `text-danger`) — žádná nedefinovaná třída.
