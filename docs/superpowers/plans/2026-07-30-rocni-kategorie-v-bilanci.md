# Roční kategorie (typ 2) v měsíční bilanci Schůzky — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uzavřít bilanci Schůzky pro roční kategorie — přidat řádek „Nestandardní dobití ročního budgetu" (nová technická kategorie type=4) a řádek „Roční výdaje mimo fond" (nový příznak `accounts.is_fund`), aby bilance měřila veškerý odliv z provozních účtů.

**Architecture:** Backend `GET /api/stats/overview` dopočítá dva nové agregáty (`fund_topup`, `annual_off_fund`); sdílený klientský helper `meetingBalance.js` je odečte od přebytku; Schůzka i stránka Spořicí účet je předají stejně. Matcher fixních plateb musí novou kategorii v obou svých větvích vylučovat, jinak by se stejný převod počítal dvakrát.

**Tech Stack:** Node.js + Express, better-sqlite3, React + Vite. Testy: `node:test` (backend i klientské utility), žádný test runner navíc.

**Spec:** `docs/superpowers/specs/2026-07-30-rocni-kategorie-v-bilanci-design.md`

## Global Constraints

- **Testy backendu:** `node --test 'src/**/*.test.js'` — **glob MUSÍ být v apostrofech**; `node --test src/` visí. Když padají route testy, přidej `--test-force-exit`.
- **Testy klienta:** `node --test client/src/utils/*.test.js`.
- **Build klienta:** `npm run build` (musí projít před commitem UI změn).
- **DB migrace:** výhradně na konec `initSchema()` v `src/db/schema.js`, každá ve vlastním `try/catch`. Žádný migrační framework.
- **Identita kategorie v kódu je `categories.system_role`, NIKDY název.** Poučení z `src/utils/transfer-category.js` (prod má „Převody interní", kód hledal „Převody").
- **Jazyk UI je čeština** (`client/src/i18n.js` pro nové texty se v tomto plánu nepoužívá — bilanční řádky mají texty inline, stejně jako stávající řádky).
- **Deploy:** po každém tasku commit; push do větve `staging` (nikdy `main`). Verzi bumpuje pre-commit hook automaticky.
- **Prod data:** žádný task v tomto plánu nesmí mutovat produkční DB. Konfigurace (§ Task 9) je ruční práce uživatele v UI.
- Hodnota `system_role` pro tuto featuru je přesně string `'fund_topup'`.

---

## File Structure

| Soubor | Odpovědnost | Akce |
|---|---|---|
| `src/db/schema.js` | migrace `categories.system_role`, `accounts.is_fund`, bootstrap kategorie | Modify (konec `initSchema`) |
| `src/db/schema.test.js` | ověření migrací | Modify |
| `src/utils/fixed-expenses.js` | matcher fixních plateb — vyloučit `fund_topup` v obou větvích | Modify (`matchByDesc`, `outgoingWithCp`) |
| `src/utils/fixed-expenses.test.js` | regrese dvojího počítání | Modify |
| `src/routes/stats.js` | agregáty `fund_topup` + `annual_off_fund` v `/overview` | Modify |
| `src/routes/stats.test.js` | testy agregátů | Modify |
| `src/routes/transactions.js` | filtr `off_fund=1` pro proklik | Modify (`buildTxWhere`) |
| `src/routes/transactions.test.js` | test filtru | Modify |
| `src/routes/accounts.js` | `is_fund` v GET/POST/PATCH | Modify |
| `src/routes/accounts.test.js` | testy `is_fund` | **Create** |
| `src/routes/categories.js` | ochrana systémové kategorie (PATCH type, DELETE) | Modify |
| `src/routes/categories.test.js` | testy ochrany | Modify |
| `client/src/utils/meetingBalance.js` | dva nové vstupy do přebytku | Modify |
| `client/src/utils/meetingBalance.test.js` | testy přebytku | Modify |
| `client/src/pages/ReportPage.jsx` | dva nové bilanční řádky | Modify |
| `client/src/pages/SavingsPage.jsx` | stejné vstupy do `computeMeetingSurplus` | Modify |
| `client/src/pages/AccountsPage.jsx` | checkbox „Fond" | Modify |
| `client/src/pages/TransactionsPage.jsx` | chip skupina „Účetní" (typ 4) | Modify |

---

### Task 1: Schema — `system_role`, `is_fund`, bootstrap kategorie

**Files:**
- Modify: `src/db/schema.js` (na samý konec `initSchema()`, před uzavírací `}`)
- Test: `src/db/schema.test.js`

**Interfaces:**
- Consumes: nic (první task)
- Produces: sloupec `categories.system_role TEXT` (NULL | `'fund_topup'`), sloupec `accounts.is_fund INTEGER NOT NULL DEFAULT 0`, a pro každého uživatele s aspoň jednou kategorií řádek v `categories` s `system_role='fund_topup'`, `type=4`, `name='Nestandardní dobití ročního budgetu'`.

- [ ] **Step 1: Write the failing tests**

Přidej na konec `src/db/schema.test.js`:

```js
test('migrace: categories.system_role + accounts.is_fund existují', () => {
  const tmp = path.join(os.tmpdir(), `spendex-sysrole-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  const catCols = db.prepare('PRAGMA table_info(categories)').all().map(c => c.name);
  const accCols = db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name);
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.ok(catCols.includes('system_role'), `categories nemá system_role; má: ${catCols.join(',')}`);
  assert.ok(accCols.includes('is_fund'), `accounts nemá is_fund; má: ${accCols.join(',')}`);
});

test('bootstrap: kategorie fund_topup vznikne jen uživateli, který už kategorie má, a je idempotentní', () => {
  const tmp = path.join(os.tmpdir(), `spendex-topup-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  // user 1 = data owner s kategoriemi, user 2 = člen domácnosti bez vlastních kategorií
  db.prepare("INSERT INTO users (id, email) VALUES (1,'owner@x'),(2,'member@x')").run();
  db.prepare("INSERT INTO categories (user_id, name, type) VALUES (1,'Jídlo',1)").run();
  require('../db/schema').initSchema();
  require('../db/schema').initSchema();   // druhý běh nesmí duplikovat
  const rows = db.prepare("SELECT user_id, name, type FROM categories WHERE system_role = 'fund_topup'").all();
  const defaultIsFund = db.prepare('PRAGMA table_info(accounts)').all().find(c => c.name === 'is_fund');
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.equal(rows.length, 1, 'právě jedna kategorie fund_topup (jen pro user 1)');
  assert.equal(rows[0].user_id, 1);
  assert.equal(rows[0].name, 'Nestandardní dobití ročního budgetu');
  assert.equal(rows[0].type, 4);
  assert.equal(defaultIsFund.dflt_value, '0');
});

test('bootstrap: ručně založenou kategorii se stejným názvem povýší místo duplikátu', () => {
  const tmp = path.join(os.tmpdir(), `spendex-topup2-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'owner@x')").run();
  // uživatel si ji založil sám jako měsíční (unique index na user_id+name)
  db.prepare("INSERT INTO categories (user_id, name, type) VALUES (1,'Nestandardní dobití ročního budgetu',1)").run();
  require('../db/schema').initSchema();
  const rows = db.prepare("SELECT type, system_role FROM categories WHERE name = 'Nestandardní dobití ročního budgetu'").all();
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.equal(rows.length, 1, 'žádný duplikát');
  assert.equal(rows[0].type, 4);
  assert.equal(rows[0].system_role, 'fund_topup');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/db/schema.test.js`
Expected: FAIL — `categories nemá system_role; má: id,user_id,name,...`

- [ ] **Step 3: Write the migrations**

Na konec `initSchema()` v `src/db/schema.js` (za blok s pravidlem „Splátka půjčky"):

```js
  // Technická kategorie „Nestandardní dobití ročního budgetu" (typ 4 = Účetní):
  // nese převody na fondové účty NAD rámec standardní dotace. Nelze to odvodit
  // z cílového účtu (na Nepravidelné chodí i dotace na T-Mobile / TV poplatek)
  // ani z poznámky (u většiny převodů chybí) — rozhodnutí je per transakce.
  // Identita je `system_role`, ne název, aby přejmenování v UI nic nerozbilo.
  try {
    db.prepare('ALTER TABLE categories ADD COLUMN system_role TEXT').run();
  } catch { /* sloupec už existuje */ }

  // accounts.is_fund = účet, na kterém se kumulují peníze na roční výdaje
  // (Licence, Nepravidelné). Záměrně NENÍ nová `role` — role je vstup do
  // SPENDING_FILTER a přepnutí by rozbilo měsíční čerpání.
  try {
    db.prepare('ALTER TABLE accounts ADD COLUMN is_fund INTEGER NOT NULL DEFAULT 0').run();
  } catch { /* sloupec už existuje */ }

  // Bootstrap kategorie fund_topup. Jen pro uživatele, kteří UŽ MAJÍ aspoň jednu
  // kategorii: v household sharingu jsou kategorie jen u data ownera, takže
  // členovi domácnosti by vznikl mrtvý záznam. Idempotentní.
  //
  // Na categories(user_id, name) je unique index — když si uživatel kategorii se
  // stejným názvem založil sám, INSERT by spadl. Takový řádek proto místo vkládání
  // POVÝŠÍME (type=4 + system_role), ať feature funguje a nezůstanou dvě kategorie.
  try {
    const TOPUP_NAME = 'Nestandardní dobití ročního budgetu';
    const owners = db.prepare(`
      SELECT DISTINCT user_id FROM categories
      WHERE user_id NOT IN (SELECT user_id FROM categories WHERE system_role = 'fund_topup')
    `).all();
    const findByName = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?');
    const promote = db.prepare("UPDATE categories SET type = 4, system_role = 'fund_topup' WHERE id = ?");
    const insTopup = db.prepare(`
      INSERT INTO categories (user_id, name, type, color, icon, system_role)
      VALUES (?, ?, 4, '#f59e0b', 'PiggyBank', 'fund_topup')
    `);
    for (const o of owners) {
      const existing = findByName.get(o.user_id, TOPUP_NAME);
      if (existing) promote.run(existing.id);
      else insTopup.run(o.user_id, TOPUP_NAME);
    }
  } catch { /* tabulka/sloupec ještě neexistuje při prvním běhu – ignoruj */ }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/db/schema.test.js`
Expected: PASS (všechny testy v souboru)

- [ ] **Step 5: Run the full backend suite (migrace se dotýká všech testů)**

Run: `node --test 'src/**/*.test.js'`
Expected: PASS, žádná regrese

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.js src/db/schema.test.js
git commit -m "feat(schema): categories.system_role + accounts.is_fund + bootstrap kategorie fund_topup"
```

---

### Task 2: Matcher fixních plateb vylučuje `fund_topup` v obou větvích

**Files:**
- Modify: `src/utils/fixed-expenses.js:49-66` (`matchByDesc`, `outgoingWithCp`)
- Test: `src/utils/fixed-expenses.test.js`

**Interfaces:**
- Consumes: `categories.system_role` z Tasku 1
- Produces: `fixedExpensesForPeriod(db, userId, period)` nadále vrací `actual`/`tx_count`/`status`, ale **nikdy** nepočítá transakce v kategorii se `system_role='fund_topup'`

**Proč:** dnešní guard `COALESCE(c.type, 0) != 4` se u řádků s `include_transfers = 1` vypíná — a to jsou právě obě dotace na fondové účty. Účtová větev (`outgoingWithCp`) nemá dnes na kategorie join vůbec, takže dotace matchovaná číslem fondového účtu by sečetla i nadplánové převody.

- [ ] **Step 1: Write the failing tests**

Přidej na konec `src/utils/fixed-expenses.test.js`:

```js
test('fixedExpensesForPeriod: include_transfers=1 NEmatchuje tx v kategorii fund_topup (textová větev)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type, system_role) VALUES (30,1,'Nestandardní dobití ročního budgetu',4,'fund_topup'),(31,1,'Převody interní',4,NULL)").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, match_pattern, include_transfers) VALUES (1,'Dotace na účet Licence',6000,6000,6000,'Dotace - Licence',1)").run();
  // standardní dotace (běžná účetní kategorie) – MÁ se počítat
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description, note) VALUES (1,31,-6000,'2026-07-22','Tomáš Střída','Dotace - Licence')").run();
  // nadplánové dobití se stejným textem – NESMÍ se počítat
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description, note) VALUES (1,30,-10500,'2026-07-23','Tomáš Střída','Dotace - Licence extra')").run();

  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-07');
  cleanup(db, tmp);
  const m = rows.find(r => r.name === 'Dotace na účet Licence');
  assert.equal(m.tx_count, 1, 'jen standardní dotace');
  assert.equal(m.actual, 6000);
  assert.equal(m.status, 'ok');
});

test('fixedExpensesForPeriod: match_counterparty_account NEmatchuje tx v kategorii fund_topup (účtová větev)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type, system_role) VALUES (30,1,'Nestandardní dobití ročního budgetu',4,'fund_topup'),(31,1,'Převody interní',4,NULL)").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, amount_min, amount_max, match_counterparty_account) VALUES (1,'Dotace na účet Licence',6000,6000,6000,'1679014111/3030')").run();
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account) VALUES (1,31,-6000,'2026-07-22','Tomáš Střída','1679014111/3030')").run();
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account) VALUES (1,30,-10500,'2026-07-23','Tomáš Střída','1679014111/3030')").run();

  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-07');
  cleanup(db, tmp);
  const m = rows.find(r => r.name === 'Dotace na účet Licence');
  assert.equal(m.tx_count, 1, 'nadplánové dobití se nesmí přičíst');
  assert.equal(m.actual, 6000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/utils/fixed-expenses.test.js`
Expected: FAIL — `tx_count` je 2 místo 1 (a `actual` 16500 místo 6000) v obou nových testech

- [ ] **Step 3: Add the guard to both branches**

V `src/utils/fixed-expenses.js` rozšiř komentář nad `matchByDesc` a oba dotazy:

```js
  // Kategorie se `system_role='fund_topup'` (Nestandardní dobití ročního budgetu)
  // je vyloučená VŽDY, i u řádků s include_transfers=1 — ta transakce je vlastním
  // řádkem bilance, takže by se přes dotaci počítala podruhé.
  const matchByDesc = db.prepare(`
    SELECT t.id, t.amount
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = ? AND t.amount < 0 AND t.date >= ? AND t.date <= ?
      AND (t.description LIKE '%' || :pattern || '%'
        OR t.note LIKE '%' || :pattern || '%'
        OR t.place LIKE '%' || :pattern || '%')
      AND COALESCE(c.system_role, '') != 'fund_topup'
      AND (:includeTransfers = 1 OR COALESCE(c.type, 0) != 4)
  `);
  // Číslo účtu se normalizuje v JS (SQLite neumí „číslice před /" čistě), proto
  // načteme odchozí transakce s protiúčtem v okně a porovnáme přes normCounterparty.
  const outgoingWithCp = db.prepare(`
    SELECT t.id, t.amount, t.counterparty_account
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = ? AND t.amount < 0 AND t.date >= ? AND t.date <= ?
      AND t.counterparty_account IS NOT NULL
      AND COALESCE(c.system_role, '') != 'fund_topup'
  `);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/utils/fixed-expenses.test.js`
Expected: PASS (všech ~12 testů v souboru — hlavně stávající regrese s `include_transfers`)

- [ ] **Step 5: Commit**

```bash
git add src/utils/fixed-expenses.js src/utils/fixed-expenses.test.js
git commit -m "fix(schuzka): matcher fixnich plateb vylucuje kategorii fund_topup v obou vetvich"
```

---

### Task 3: Backend agregáty `fund_topup` + `annual_off_fund`

**Files:**
- Modify: `src/routes/stats.js` (nové dotazy před `res.json`, nové klíče v odpovědi na `src/routes/stats.js:146-158`)
- Test: `src/routes/stats.test.js`

**Interfaces:**
- Consumes: `categories.system_role`, `accounts.is_fund` z Tasku 1; `SPENDING_AND` z `src/utils/spending-filter.js` (už importovaný jako `SPENDING_FILTER`)
- Produces: v odpovědi `GET /api/stats/overview`:
  - `fund_topup: { category_id: number|null, name: string|null, outflow: number, tx_count: number, saldo: number }`
  - `annual_off_fund: { spent: number, tx_count: number } | null` (null = uživatel nemá ani jeden účet s `is_fund=1`)

- [ ] **Step 1: Write the failing tests**

Přidej na konec `src/routes/stats.test.js`:

```js
test('fund_topup: outflow bere jen odchozí nohy z NE-fondového účtu, saldo hlídá párovou nohu', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type,system_role) VALUES (40,1,'Nestandardní dobití ročního budgetu',4,'fund_topup')").run();
  const hlavni = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'100/3030','Hlavní','ignored',0)").run().lastInsertRowid;
  const fond   = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'200/3030','Licence','spending',1)").run().lastInsertRowid;
  // obě nohy jednoho převodu: odchozí z Hlavní (počítá se), příchozí na fond (ne)
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description) VALUES (1,40,?,-10500,'2026-07-22','Tomáš Střída'),(1,40,?,10500,'2026-07-22','Tomáš Střída')").run(hlavni, fond);
  // mimo období
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description) VALUES (1,40,?,-999,'2026-06-15','Starý')").run(hlavni);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.fund_topup.category_id, 40);
  assert.equal(stats.fund_topup.name, 'Nestandardní dobití ročního budgetu');
  assert.equal(stats.fund_topup.outflow, 10500);
  assert.equal(stats.fund_topup.tx_count, 1);
  assert.equal(stats.fund_topup.saldo, 0, 'obě nohy označené → saldo 0');
  server.close();
});

test('fund_topup: chybějící párová noha se pozná na saldu', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type,system_role) VALUES (40,1,'Nestandardní dobití',4,'fund_topup')").run();
  const hlavni = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'100/3030','Hlavní','ignored',0)").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description) VALUES (1,40,?,-10500,'2026-07-22','Tomáš Střída')").run(hlavni);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.fund_topup.outflow, 10500);
  assert.equal(stats.fund_topup.saldo, -10500, 'jen jedna noha → saldo != 0');
  server.close();
});

test('fund_topup: bez kategorie fund_topup vrací nuly a category_id null', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.fund_topup.category_id, null);
  assert.equal(stats.fund_topup.outflow, 0);
  server.close();
});

test('annual_off_fund: null dokud není fondový účet, pak roční výdaje mimo fond', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (50,1,'Y_Licence',2)").run();
  const spol = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'300/3030','Společný','spending',0)").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description) VALUES (1,50,?,-2253,'2026-07-15','ANTHROPIC')").run(spol);
  const before = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(before.annual_off_fund, null, 'bez fondového účtu je řádek vypnutý');

  const fond = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'200/3030','Licence','spending',1)").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description) VALUES (1,50,?,-399,'2026-07-04','APPLE.COM')").run(fond);
  const after = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(after.annual_off_fund.spent, 2253, 'jen výdaj z NE-fondového účtu');
  assert.equal(after.annual_off_fund.tx_count, 1);
  server.close();
});

test('annual_off_fund: respektuje SPENDING_FILTER (roční výdaj z OSVČ účtu se nepočítá)', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (50,1,'Y_Licence',2)").run();
  db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'200/3030','Licence','spending',1)").run();
  const osvc = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'400/3030','Tom-OSVC','income',0)").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description) VALUES (1,50,?,-5000,'2026-07-10','Něco z OSVČ')").run(osvc);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.annual_off_fund.spent, 0);
  server.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/routes/stats.test.js`
Expected: FAIL — `TypeError: Cannot read properties of undefined (reading 'category_id')`

- [ ] **Step 3: Implement the aggregates**

V `src/routes/stats.js` vlož před `res.json({` (tj. za dotaz `expensiveItems`):

```js
  // ── Nestandardní dobití ročního budgetu (kategorie se system_role='fund_topup') ──
  // Do bilance jde JEN odchozí noha z provozního účtu; příchozí noha na fondovém
  // účtu by ji vyrušila. `saldo` napříč všemi účty je kontrola pro uživatele:
  // když označí jen jednu nohu převodu, nevyjde 0 (sekce Účetní to ukáže s ⚠).
  const topupCat = db.prepare(
    "SELECT id, name FROM categories WHERE user_id = ? AND system_role = 'fund_topup'"
  ).get(req.dataUserId);
  let fundTopup = { category_id: null, name: null, outflow: 0, tx_count: 0, saldo: 0 };
  if (topupCat) {
    const o = db.prepare(`
      SELECT COALESCE(SUM(-t.amount), 0) AS outflow, COUNT(t.id) AS tx_count
      FROM transactions t
      WHERE t.user_id = ? AND t.category_id = ? AND t.amount < 0
        AND t.date >= ? AND t.date <= ?
        AND NOT EXISTS (SELECT 1 FROM accounts fa WHERE fa.id = t.account_id AND fa.is_fund = 1)
    `).get(req.dataUserId, topupCat.id, start, end);
    const s = db.prepare(`
      SELECT COALESCE(SUM(t.amount), 0) AS saldo
      FROM transactions t
      WHERE t.user_id = ? AND t.category_id = ? AND t.date >= ? AND t.date <= ?
    `).get(req.dataUserId, topupCat.id, start, end);
    fundTopup = {
      category_id: topupCat.id, name: topupCat.name,
      outflow: o.outflow, tx_count: o.tx_count, saldo: s.saldo,
    };
  }

  // ── Roční výdaje (typ 2) zaplacené mimo fondový účet ──
  // null = uživatel nemá označený ani jeden fondový účet; řádek by pak ukázal
  // celé roční čerpání (každý účet by byl „mimo fond") a mátl, proto se skryje.
  const hasFundAccount = db.prepare(
    'SELECT 1 FROM accounts WHERE user_id = ? AND is_fund = 1 LIMIT 1'
  ).get(req.dataUserId);
  let annualOffFund = null;
  if (hasFundAccount) {
    annualOffFund = db.prepare(`
      SELECT COALESCE(SUM(-t.amount), 0) AS spent, COUNT(t.id) AS tx_count
      FROM transactions t
      JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
      WHERE t.user_id = ? AND c.type = 2 AND t.date >= ? AND t.date <= ?
        AND NOT EXISTS (SELECT 1 FROM accounts fa WHERE fa.id = t.account_id AND fa.is_fund = 1)
        ${SPENDING_FILTER}
    `).get(req.dataUserId, start, end);
  }
```

A do `res.json({ ... })` přidej za `accounting,`:

```js
    fund_topup: fundTopup,
    annual_off_fund: annualOffFund,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/routes/stats.test.js`
Expected: PASS (všechny testy v souboru)

- [ ] **Step 5: Commit**

```bash
git add src/routes/stats.js src/routes/stats.test.js
git commit -m "feat(stats): agregaty fund_topup a annual_off_fund v /overview"
```

---

### Task 4: Filtr `off_fund=1` pro proklik do Transakcí

**Files:**
- Modify: `src/routes/transactions.js:16-52` (`buildTxWhere`, vlož za blok `spending_only`)
- Test: `src/routes/transactions.test.js`

**Interfaces:**
- Consumes: `accounts.is_fund` z Tasku 1
- Produces: query param `off_fund=1` na `GET /api/transactions` (a tím i na `/export`, který sdílí `buildTxWhere`)

- [ ] **Step 1: Write the failing test**

Přidej na konec `src/routes/transactions.test.js`:

```js
test('off_fund=1 vyloučí transakce z fondového účtu', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const fond = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'200/3030','Licence','spending',1)").run().lastInsertRowid;
  const spol = db.prepare("INSERT INTO accounts (user_id,account_number,name,role,is_fund) VALUES (1,'300/3030','Společný','spending',0)").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id,category_id,account_id,amount,date,description) VALUES (1,5,?,-399,'2026-07-04','APPLE z fondu'),(1,5,?,-2253,'2026-07-15','ANTHROPIC ze Společného')").run(fond, spol);
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,5,-100,'2026-07-16','Bez účtu')").run();

  const res = await (await fetch(`${base}/api/transactions?off_fund=1`)).json();
  const rows = res.transactions || res;
  const descs = rows.map(r => r.description).sort();
  server.close();
  assert.deepEqual(descs, ['ANTHROPIC ze Společného', 'Bez účtu'], 'tx z fondového účtu vypadne, tx bez účtu zůstane');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/routes/transactions.test.js`
Expected: FAIL — v seznamu je i `APPLE z fondu`

- [ ] **Step 3: Implement the filter**

V `src/routes/transactions.js` za blok `if (query.spending_only === '1') { ... }`:

```js
  // off_fund=1 → jen transakce, které NEJSOU na fondovém účtu (accounts.is_fund).
  // Užívá Schůzka pro klik na „Roční výdaje mimo fond". Transakce bez účtu
  // (account_id IS NULL) projdou — NOT EXISTS je na NULL id pravdivé.
  if (query.off_fund === '1') {
    where += ` AND NOT EXISTS (
      SELECT 1 FROM accounts ofa WHERE ofa.id = t.account_id AND ofa.is_fund = 1
    )`;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/routes/transactions.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/transactions.js src/routes/transactions.test.js
git commit -m "feat(transakce): filtr off_fund=1 pro proklik na rocni vydaje mimo fond"
```

---

### Task 5: `is_fund` v API účtů + checkbox v UI

**Files:**
- Modify: `src/routes/accounts.js` (GET SELECT, POST, PATCH)
- Create: `src/routes/accounts.test.js`
- Modify: `client/src/pages/AccountsPage.jsx` (create formulář + nová buňka v tabulce)

**Interfaces:**
- Consumes: `accounts.is_fund` z Tasku 1
- Produces: `GET /api/accounts` vrací `is_fund` (0/1); `POST`/`PATCH` ho přijímají jako truthy/falsy a ukládají jako 0/1

- [ ] **Step 1: Write the failing tests**

Vytvoř `src/routes/accounts.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-accounts-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./accounts']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/accounts', require('./accounts'));
  return { db, app };
}

test('POST: is_fund se uloží jako 1, default je 0', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const a = await (await fetch(`${base}/api/accounts`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Licence', account_number:'200/3030', is_fund:true }) })).json();
  const b = await (await fetch(`${base}/api/accounts`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Společný', account_number:'300/3030' }) })).json();
  server.close();
  assert.equal(a.is_fund, 1);
  assert.equal(b.is_fund, 0);
});

test('PATCH: is_fund lze zapnout i vypnout, vynechání ho nemění', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const acc = await (await fetch(`${base}/api/accounts`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Licence', account_number:'200/3030' }) })).json();
  const on = await (await fetch(`${base}/api/accounts/${acc.id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ is_fund: true }) })).json();
  assert.equal(on.is_fund, 1);
  const renamed = await (await fetch(`${base}/api/accounts/${acc.id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name: 'Licence 2' }) })).json();
  assert.equal(renamed.is_fund, 1, 'partial update nesmí is_fund shodit');
  const off = await (await fetch(`${base}/api/accounts/${acc.id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ is_fund: false }) })).json();
  server.close();
  assert.equal(off.is_fund, 0);
});

test('GET: seznam obsahuje is_fund', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  await fetch(`${base}/api/accounts`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name:'Licence', is_fund:true }) });
  const rows = await (await fetch(`${base}/api/accounts`)).json();
  server.close();
  assert.equal(rows[0].is_fund, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/routes/accounts.test.js`
Expected: FAIL — `is_fund` je `undefined`

- [ ] **Step 3: Implement the route changes**

V `src/routes/accounts.js`:

```js
// GET /api/accounts
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, account_number, name, role, is_fund, created_at
    FROM accounts WHERE user_id = ? ORDER BY name ASC
  `).all(req.dataUserId);
  res.json(rows);
});
```

V POST:

```js
  const { name, role = 'spending', account_number = null, is_fund = 0 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Zadejte název účtu.' });
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Neplatná role.' });
  try {
    const result = db.prepare(`
      INSERT INTO accounts (user_id, account_number, name, role, is_fund)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.dataUserId, account_number?.trim() || null, name.trim(), role, is_fund ? 1 : 0);
```

V PATCH (za `account_number`):

```js
  // Fondový účet = kumuluje peníze na roční výdaje (Licence, Nepravidelné).
  const is_fund = 'is_fund' in req.body ? (req.body.is_fund ? 1 : 0) : row.is_fund;
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Neplatná role.' });
  try {
    db.prepare('UPDATE accounts SET name = ?, role = ?, account_number = ?, is_fund = ? WHERE id = ?')
      .run(name, role, account_number, is_fund, row.id);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/routes/accounts.test.js`
Expected: PASS (3 testy)

- [ ] **Step 5: Add the UI checkbox**

V `client/src/pages/AccountsPage.jsx`:

(a) nový state vedle `newRole`:

```jsx
  const [newIsFund, setNewIsFund] = useState(false);
```

(b) v `handleCreate` do těla POSTu přidej `is_fund: newIsFund,` a do resetu za `setNewRole('spending');` přidej `setNewIsFund(false);`

(c) do create formuláře za `<select>` s rolí:

```jsx
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={newIsFund} onChange={e => setNewIsFund(e.target.checked)} />
              Fondový účet
            </label>
```

(d) nový handler vedle `handleRoleChange`:

```jsx
  async function handleFundChange(acc, isFund) {
    await patchAccount(acc.id, { is_fund: isFund });
  }
```

(e) do `<thead>` za hlavičku „Role":

```jsx
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Fond</th>
```

(f) do řádku tabulky za buňku s rolí:

```jsx
                    <td style={{ padding: '8px 12px', verticalAlign: 'top' }}>
                      <input type="checkbox" checked={!!acc.is_fund}
                        onChange={e => handleFundChange(acc, e.target.checked)}
                        title="Fondový účet: kumuluje peníze na roční výdaje (Licence, Nepravidelné)" />
                    </td>
```

- [ ] **Step 6: Verify the client build**

Run: `npm run build`
Expected: build projde bez chyb

- [ ] **Step 7: Commit**

```bash
git add src/routes/accounts.js src/routes/accounts.test.js client/src/pages/AccountsPage.jsx
git commit -m "feat(ucty): priznak is_fund v API i UI (fondovy ucet pro rocni vydaje)"
```

---

### Task 6: Ochrana systémové kategorie

**Files:**
- Modify: `src/routes/categories.js:80-121` (PATCH `newType`, DELETE guard)
- Test: `src/routes/categories.test.js`

**Interfaces:**
- Consumes: `categories.system_role` z Tasku 1
- Produces: `PATCH /api/categories/:id` ignoruje `type` u kategorie se `system_role`; `DELETE /api/categories/:id` vrací 400

- [ ] **Step 1: Write the failing tests**

Přidej na konec `src/routes/categories.test.js` (soubor už má vlastní `setup()`; použij jeho helpery):

```js
test('PATCH: u systémové kategorie ignoruje změnu type (název jde měnit)', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const id = db.prepare("INSERT INTO categories (user_id,name,type,system_role) VALUES (1,'Nestandardní dobití',4,'fund_topup')").run().lastInsertRowid;
  const res = await fetch(`${base}/api/categories/${id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ type: 1, name: 'Dobití fondů' }) });
  const body = await res.json();
  server.close();
  assert.equal(res.status, 200);
  assert.equal(body.type, 4, 'type systémové kategorie se nesmí přepnout');
  assert.equal(body.name, 'Dobití fondů', 'název jde přejmenovat');
});

test('DELETE: systémovou kategorii nelze smazat', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const id = db.prepare("INSERT INTO categories (user_id,name,type,system_role) VALUES (1,'Nestandardní dobití',4,'fund_topup')").run().lastInsertRowid;
  const res = await fetch(`${base}/api/categories/${id}`, { method:'DELETE' });
  const still = db.prepare('SELECT 1 FROM categories WHERE id = ?').get(id);
  server.close();
  assert.equal(res.status, 400);
  assert.ok(still, 'kategorie musí zůstat');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/routes/categories.test.js`
Expected: FAIL — `type` je 1 a DELETE vrací 200

- [ ] **Step 3: Implement the guards**

V `src/routes/categories.js` PATCH, nahraď řádek `const newType = type ?? cat.type ?? 1;`:

```js
  // Systémové kategorie (categories.system_role) mají typ pevně daný kódem —
  // přepnutí by rozbilo logiku, která na ně spoléhá (fund_topup = type 4).
  // Název, barvu a ikonu měnit lze.
  const newType = cat.system_role ? cat.type : (type ?? cat.type ?? 1);
```

V DELETE, hned za kontrolu existence:

```js
  if (cat.system_role) return res.status(400).json({ error: 'Systémovou kategorii nelze smazat.' });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/routes/categories.test.js`
Expected: PASS (všechny testy v souboru)

- [ ] **Step 5: Commit**

```bash
git add src/routes/categories.js src/routes/categories.test.js
git commit -m "feat(kategorie): ochrana systemove kategorie (type + delete)"
```

---

### Task 7: `meetingBalance` — dva nové vstupy do přebytku

**Files:**
- Modify: `client/src/utils/meetingBalance.js`
- Test: `client/src/utils/meetingBalance.test.js`

**Interfaces:**
- Consumes: nic z předchozích tasků (čistá funkce)
- Produces:
  - `surplusToSavings({ totalIncome, totalFixed, fundTopup, annualOffFund, totalType1, totalType3 }) → number` (chybějící `fundTopup`/`annualOffFund` = 0)
  - `computeMeetingSurplus({ incomeSources, fixedExpenses, budgetsType1, byCategory, fundTopup, annualOffFund }) → { totalIncome, totalFixed, fundTopup, annualOffFund, totalType1, totalType3, surplus }`

- [ ] **Step 1: Write the failing tests**

Přidej na konec `client/src/utils/meetingBalance.test.js`:

```js
test('surplusToSavings: odečte dobití fondu i roční výdaje mimo fond', () => {
  const surplus = surplusToSavings({
    totalIncome: 203700, totalFixed: 102990,
    fundTopup: 10500, annualOffFund: 2653,
    totalType1: 55893, totalType3: 3600,
  });
  assert.equal(surplus, 203700 - 102990 - 10500 - 2653 - 55893 - 3600);
  assert.equal(surplus, 28064);
});

test('surplusToSavings: chybějící fundTopup/annualOffFund = 0 (zpětná kompatibilita)', () => {
  const surplus = surplusToSavings({
    totalIncome: 100000, totalFixed: 20000, totalType1: 10000, totalType3: 0,
  });
  assert.equal(surplus, 70000);
});

test('computeMeetingSurplus: nové vstupy projdou do výsledku i do přebytku', () => {
  const r = computeMeetingSurplus({
    incomeSources: [{ id: 1, actual: 100000 }],
    fixedExpenses: [{ source: 'manual', amount: 20000, actual: 20000, tx_count: 1 }],
    budgetsType1: [{ spent: 10000, amount: 12000 }],
    byCategory: [{ type: 3, spent: 1000 }],
    fundTopup: 5000,
    annualOffFund: 2000,
  });
  assert.equal(r.fundTopup, 5000);
  assert.equal(r.annualOffFund, 2000);
  assert.equal(r.surplus, 100000 - 20000 - 5000 - 2000 - 10000 - 1000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test client/src/utils/meetingBalance.test.js`
Expected: FAIL — přebytek je 41 217 místo 28 064 (nové vstupy se neodečítají)

- [ ] **Step 3: Implement**

V `client/src/utils/meetingBalance.js` uprav obě funkce (komentáře nad `surplusToSavings` ponech, doplň druhý odstavec):

```js
// „Na spořicí" = přebytek za období = příjmy minus výdaje (fixní, dobití ročních
// fondů nad plán, roční výdaje mimo fond, měsíční, drahé věci). Kolik by mělo jít
// na spoření. Skutečné pohyby na spořicím účtu se NEpočítají — Schůzka je
// plánovací, pohyby jsou v Transakcích.
//
// Dotace na účet „Nepravidelné" tu dřív byla čtvrtou položkou, počítaná ze všech
// odchozích plateb na hardcoded číslo účtu. Teď do bilance vstupuje jen jako
// definovaná fixní platba: jinak by se stejný přesun počítal dvakrát a bilance
// by měla vstup, který není nikde v konfiguraci vidět.
//
// `fundTopup` = odliv v kategorii fund_topup (dobití fondu nad standardní dotaci),
// `annualOffFund` = roční výdaje (typ 2) zaplacené mimo fondový účet. Oba jdou
// z `/api/stats/overview`; defaultně 0, aby starší volající nedostali NaN.
export function surplusToSavings({ totalIncome, totalFixed, fundTopup, annualOffFund, totalType1, totalType3 }) {
  return totalIncome - totalFixed - (fundTopup || 0) - (annualOffFund || 0) - totalType1 - totalType3;
}
```

```js
export function computeMeetingSurplus({
  incomeSources = [],
  fixedExpenses = [],
  budgetsType1 = [],
  byCategory = [],
  fundTopup = 0,
  annualOffFund = 0,
} = {}) {
  // Striktní whitelist: do bilance vstupují jen ručně aliasované zdroje (id != null).
  const totalIncome = incomeSources
    .filter(s => s.id != null)
    .reduce((s, i) => s + (i.actual || 0), 0);
  const totalFixed = fixedActualTotal(fixedExpenses);
  const totalType1 = budgetsType1.reduce((s, b) => s + (b.spent || 0), 0);
  const totalType3 = byCategory
    .filter(c => c.type === 3 && c.spent > 0)
    .reduce((s, c) => s + c.spent, 0);
  const surplus = surplusToSavings({
    totalIncome, totalFixed, fundTopup, annualOffFund, totalType1, totalType3,
  });
  return { totalIncome, totalFixed, fundTopup, annualOffFund, totalType1, totalType3, surplus };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test client/src/utils/meetingBalance.test.js`
Expected: PASS (vč. všech stávajících testů — hlavně `prázdné vstupy → nuly`)

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/meetingBalance.js client/src/utils/meetingBalance.test.js
git commit -m "feat(bilance): meetingBalance odecita dobiti fondu a rocni vydaje mimo fond"
```

---

### Task 8: Bilanční řádky na Schůzce + Spořicí účet + chip „Účetní"

**Files:**
- Modify: `client/src/pages/ReportPage.jsx:238-246` (derived state) a bilanční sekce `client/src/pages/ReportPage.jsx:293-311` (nové řádky mezi „Fixní platby" a „Měsíční výdaje")
- Modify: `client/src/pages/SavingsPage.jsx:43-48`
- Modify: `client/src/pages/TransactionsPage.jsx:617-619`

**Interfaces:**
- Consumes: `stats.fund_topup` / `stats.annual_off_fund` z Tasku 3; `computeMeetingSurplus` s novými vstupy z Tasku 7; filtr `off_fund=1` z Tasku 4
- Produces: nic (koncové UI)

- [ ] **Step 1: Update derived state in ReportPage**

V `client/src/pages/ReportPage.jsx` nahraď volání `computeMeetingSurplus` a doplň dvě proměnné:

```jsx
  const fundTopupRow     = stats?.fund_topup || null;
  const annualOffFundRow = stats?.annual_off_fund || null;
  const { totalIncome, totalFixed, totalType1, totalType3, surplus } = computeMeetingSurplus({
    incomeSources,
    fixedExpenses,
    budgetsType1: budgets,
    byCategory,
    fundTopup: fundTopupRow?.outflow || 0,
    annualOffFund: annualOffFundRow?.spent || 0,
  });
```

A vedle `typ3CatIds` přidej:

```jsx
  const typ2CatIds = byCategory.filter(c => c.type === 2).map(c => c.id).join(',');
```

- [ ] **Step 2: Add the two bilance rows**

V bilanční sekci, **za** blok `{totalFixed > 0 && (() => { ... })()}` a **před** řádek „Měsíční výdaje":

```jsx
            {/* Dobití ročního fondu nad rámec standardní dotace. Odliv z provozního
                účtu, který v bilanci dřív nebyl vůbec — roční kategorie (typ 2) do ní
                nevstupují a dotace na Licence nebyla definovaná jako fixní platba. */}
            {fundTopupRow?.category_id && fundTopupRow.outflow !== 0 && (
              <Link to={txLink(`category_ids=${fundTopupRow.category_id}&direction=out`)}
                className="report-bilance-row"
                style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                title="Klik: převody na fondové účty nad rámec standardní dotace">
                <span>{fundTopupRow.name}</span>
                <span>
                  − {formatCurrency(fundTopupRow.outflow)}
                  {Math.round(fundTopupRow.saldo) !== 0 && (
                    <span className="text-danger" style={{ fontWeight: 400 }}
                      title="U některého převodu chybí párová noha — zkontroluj sekci Účetní."> ⚠</span>
                  )}
                </span>
              </Link>
            )}
            {/* Roční výdaje zaplacené mimo fondový účet (typicky Oblečení ze Společného).
                Skryté, dokud uživatel neoznačí aspoň jeden fondový účet (API vrací null). */}
            {annualOffFundRow && annualOffFundRow.spent !== 0 && (
              <Link to={txLink(`${typ2CatIds ? `category_ids=${typ2CatIds}&` : ''}off_fund=1&spending_only=1`)}
                className="report-bilance-row"
                style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                title="Klik: roční výdaje (Typ 2) zaplacené mimo fondový účet">
                <span>Roční výdaje mimo fond</span>
                <span>− {formatCurrency(annualOffFundRow.spent)}</span>
              </Link>
            )}
```

- [ ] **Step 3: Keep SavingsPage in sync**

V `client/src/pages/SavingsPage.jsx` uprav volání (jinak se plánovaný přebytek na dvou stránkách rozejde):

```jsx
  // Plánovaný přebytek ze Schůzky — stejná pravda přes sdílený helper.
  const { surplus } = computeMeetingSurplus({
    incomeSources,
    fixedExpenses,
    budgetsType1: budgets,
    byCategory: stats?.by_category || [],
    fundTopup: stats?.fund_topup?.outflow || 0,
    annualOffFund: stats?.annual_off_fund?.spent || 0,
  });
```

- [ ] **Step 4: Add the „Účetní" chip group**

V `client/src/pages/TransactionsPage.jsx` rozšiř seznam skupin, ať se filtr z prokliku dá odklikat:

```jsx
          {[
            { type: 1, label: 'Měsíční' },
            { type: 2, label: 'Roční' },
            { type: 3, label: 'Fondy' },
            { type: 4, label: 'Účetní' },
          ].map(group => {
```

- [ ] **Step 5: Verify build and full test suites**

Run: `npm run build`
Expected: build projde

Run: `node --test client/src/utils/*.test.js`
Expected: PASS

Run: `node --test 'src/**/*.test.js'`
Expected: PASS

- [ ] **Step 6: Commit and push**

```bash
git add client/src/pages/ReportPage.jsx client/src/pages/SavingsPage.jsx client/src/pages/TransactionsPage.jsx
git commit -m "feat(schuzka): radky Nestandardni dobiti rocniho budgetu a Rocni vydaje mimo fond"
git push origin staging
```

---

### Task 9: Ověření na reálných datech + konfigurační checklist pro uživatele

**Files:** žádné změny kódu.

**Interfaces:**
- Consumes: nasazený staging ze Tasku 8

- [ ] **Step 1: Verify the deploy**

Run: `railway status` (z `/Users/tomas/app-spendex`, jinak „No linked project found")
Expected: projekt Spendex; staging deploy proběhl

- [ ] **Step 2: Read-only sanity check proti prod datům**

Přenes do kontejneru read-only skript (base64, jak je popsáno v `feedback_prod_data_propagation`) a zkontroluj, že bootstrap kategorie vznikla právě jednou a že žádný účet ještě není fondový:

```bash
railway ssh --service app-spendex "bash -lc 'node -e \"
const db=require(\\\"/app/node_modules/better-sqlite3\\\")(\\\"/data/data.db\\\",{readonly:true});
console.log(db.prepare(\\\"SELECT id,user_id,name,type,system_role FROM categories WHERE system_role IS NOT NULL\\\").all());
console.log(db.prepare(\\\"SELECT id,name,is_fund FROM accounts WHERE is_fund=1\\\").all());
\"'"
```
Expected: jeden řádek kategorie (`user_id=1`, `type=4`, `system_role='fund_topup'`), prázdný seznam fondových účtů → řádek „Roční výdaje mimo fond" je zatím skrytý.

- [ ] **Step 3: Hand the configuration checklist to the user**

Předej uživateli (nedělej za něj — jsou to jeho data a jeho účet v AirBank):

1. **Účty →** zaškrtnout „Fond" u účtů **Licence** (`1679014111/3030`) a **Nepravidelné** (`1679014074/3030`).
2. **AirBank →** zřídit trvalý příkaz na účet Licence (např. 6 000/měs), „Zpráva pro příjemce: **Dotace - Licence**".
3. **Fixní platby →** nový řádek „Dotace na účet Licence": `match_pattern = 'Dotace - Licence'`, zapnout „tato platba je převod mezi vlastními účty" (`include_transfers`), `valid_from` = měsíc, kdy příkaz začne. **Ne** číslo účtu příjemce — textový pattern je tu přesnější.
4. **Transakce →** u nadplánových převodů na fondové účty přiřadit **obě nohy** do kategorie „Nestandardní dobití ročního budgetu". Kontrola: saldo té kategorie v sekci **Účetní** na Schůzce musí být 0.

- [ ] **Step 4: Verify on real data after configuration**

Po bodech 1–4 otevřít Schůzku za aktuální období a zkontrolovat, že:
- řádek „Nestandardní dobití ročního budgetu" se objevil a klik vede na správné transakce,
- řádek „Roční výdaje mimo fond" se objevil (po zaškrtnutí fondových účtů),
- přebytek „Na spořicí" se snížil o oba nové řádky,
- stránka Spořicí účet ukazuje **stejný** plánovaný přebytek jako Schůzka.

- [ ] **Step 5: Merge do produkce (jen na pokyn uživatele)**

```bash
git checkout main && git merge staging && git push origin main && git checkout staging
```

---

## Self-Review

**Spec coverage:**

| Sekce specu | Task |
|---|---|
| §1 Schema (`system_role`, `is_fund`, bootstrap) | Task 1 |
| §2 Matcher fixních plateb — obě větve | Task 2 |
| §3 Backend agregáty `fund_topup` + `annual_off_fund` | Task 3 |
| §4 `meetingBalance` dva nové vstupy | Task 7 |
| §5 Bilanční řádky ReportPage + SavingsPage | Task 8 |
| §6 Filtr `off_fund=1` | Task 4 |
| §7 `is_fund` v accounts API + UI | Task 5 |
| §8 Ochrana systémové kategorie | Task 6 |
| §9 Chip filtr typ 4 | Task 8 (Step 4) |
| Konfigurace uživatele (4 body) | Task 9 |
| Kontrola saldem místo nového mechanismu | Task 3 (`saldo`) + Task 8 (⚠ v řádku) |
| Testy (5 odrážek specu) | Tasky 1–7, každý má vlastní test cycle |

Bez pokrytí: nic. „Mimo scope" položky specu (auto-párování noh, retroaktivní historie, rozpad per fond, oprava červnového nájmu, ostatní nálezy auditu) záměrně nemají task.

**Type consistency:** `fund_topup` má napříč Task 3 (backend), Task 7 (helper) a Task 8 (UI) shodné klíče `category_id` / `name` / `outflow` / `tx_count` / `saldo`; `annual_off_fund` klíče `spent` / `tx_count` a hodnotu `null`. Helper přijímá skalární `fundTopup` / `annualOffFund` (ne objekty) — mapování z objektu na skalár se děje ve stránkách (Task 8), což je jediné místo, kde se obě jména potkávají.
