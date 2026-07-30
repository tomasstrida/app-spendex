# Předplacené balíčky (prepaid) — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jednorázová platba za balíček služeb (10 tréninků za 5 000 Kč) se v měsíčních rozpočtech projeví postupně podle skutečného čerpání, ne celou částkou v měsíci platby.

**Architecture:** Balíček a jeho čerpání žijí ve dvou nových tabulkách mimo `transactions`. Zdrojová platba se přeřadí do technické kategorie `system_role='prepaid_purchase'` (type=4), takže zmizí z měsíčního rozpočtu, a v bilanci Schůzky dostane vlastní mínus řádek. Čerpání se přičítá výhradně v `GET /api/budgets` do **nového** pole `budget_spent` — stávající `spent` zůstává čistě transakční, takže žádný cash-flow konzument (Schůzka, Spořicí účet) se nemění.

**Tech Stack:** Node.js + Express, better-sqlite3, `node:test`, React + Vite, lucide-react.

## Global Constraints

- Jazyk UI je čeština, texty do `client/src/i18n.js`.
- Žádný `type: any`; backend je CommonJS, klient ESM.
- Každý DB zápis scopovaný na `req.dataUserId` (household sharing), nikdy `req.user.id`.
- Migrace se přidávají na konec `initSchema()` v `src/db/schema.js`, žádný migrační framework.
- Období se počítá výhradně přes `getPeriodDates(billingDay, periodKey)` z `src/utils/period.js`.
- Write endpointy dostanou `writeLimiter` (`rateLimit({ windowMs: 60*1000, max: 60 })`).
- Backend testy: `node --test 'src/**/*.test.js' --test-force-exit` (uvozovky povinné — `src/` visí).
- Klientské testy: `node --test client/src/utils/*.test.js`.
- Commit messages bez diakritiky, conventional commits (viz `git log`).
- Po dokončení celé feature push do větve `staging`, ne `main`.

---

### Task 1: DB schéma a technická kategorie

**Files:**
- Modify: `src/db/schema.js` (konec `initSchema()`, za bootstrap `fund_topup` na řádku 472)
- Test: `src/db/schema.test.js`, `src/utils/transfer-category.test.js`

**Interfaces:**
- Produces: tabulky `prepaid_packages`, `prepaid_draws`; kategorie se `system_role='prepaid_purchase'`, `type=4`, název „Nákup předplacených balíčků".

- [ ] **Step 1: Napiš failing testy**

Do `src/db/schema.test.js` přidej (soubor už má vzor pro `fund_topup` na řádku 115 — použij stejný `setup()` helper, který je v souboru nahoře):

```javascript
test('prepaid: tabulky prepaid_packages a prepaid_draws existují se správnými sloupci', () => {
  const { db } = setup();
  const pkgCols = db.prepare('PRAGMA table_info(prepaid_packages)').all().map(c => c.name);
  for (const col of ['id','user_id','transaction_id','category_id','original_category_id','name',
                     'total_amount','units_total','unit_amount','valid_until','status','note',
                     'created_at','closed_at']) {
    assert.ok(pkgCols.includes(col), `prepaid_packages postrádá sloupec ${col}`);
  }
  const drawCols = db.prepare('PRAGMA table_info(prepaid_draws)').all().map(c => c.name);
  for (const col of ['id','user_id','package_id','date','units','amount','note','created_at']) {
    assert.ok(drawCols.includes(col), `prepaid_draws postrádá sloupec ${col}`);
  }
});

test('prepaid: bootstrap kategorie prepaid_purchase vznikne jen uzivateli s kategoriemi a je idempotentni', () => {
  const { db, initSchema } = setup();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@x'),(2,'b@x')").run();
  db.prepare("INSERT INTO categories (user_id, name) VALUES (1,'Jidlo')").run();
  initSchema();
  initSchema();
  const rows = db.prepare("SELECT user_id, name, type FROM categories WHERE system_role = 'prepaid_purchase'").all();
  assert.equal(rows.length, 1, 'prave jedna kategorie prepaid_purchase (jen pro user 1)');
  assert.equal(rows[0].user_id, 1);
  assert.equal(rows[0].type, 4);
  assert.equal(rows[0].name, 'Nákup předplacených balíčků');
});

test('prepaid: stejnojmenna uzivatelska kategorie se povysi, nevznikne duplicita', () => {
  const { db, initSchema } = setup();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@x')").run();
  const id = db.prepare("INSERT INTO categories (user_id, name, type) VALUES (1,'Nákup předplacených balíčků',1)").run().lastInsertRowid;
  db.prepare("INSERT INTO budgets (user_id, category_id, month, amount) VALUES (1,?, 'default', 500)").run(id);
  initSchema();
  const rows = db.prepare("SELECT id, type, system_role FROM categories WHERE user_id = 1 AND name = 'Nákup předplacených balíčků'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id, 'povysi se existujici radek, nevznika novy');
  assert.equal(rows[0].type, 4);
  assert.equal(rows[0].system_role, 'prepaid_purchase');
  const budgets = db.prepare('SELECT COUNT(*) AS n FROM budgets WHERE category_id = ?').get(id);
  assert.equal(budgets.n, 0, 'mrtvy mesicni budget se smaze');
});
```

Do `src/utils/transfer-category.test.js` přidej:

```javascript
test('tri systemove type=4 kategorie neprebiji identitu kategorie prevodu', () => {
  const d = freshDb();
  d.prepare("INSERT INTO categories (user_id, name, type, system_role) VALUES (1, 'Nestandardní dobití ročního budgetu', 4, 'fund_topup')").run();
  d.prepare("INSERT INTO categories (user_id, name, type, system_role) VALUES (1, 'Nákup předplacených balíčků', 4, 'prepaid_purchase')").run();
  const transferId = d.prepare("INSERT INTO categories (user_id, name, type) VALUES (1, 'Převody interní', 4)").run().lastInsertRowid;
  assert.equal(transferCategoryId(d, 1), transferId);
});
```

Pokud helper `freshDb()`/`transferCategoryId` mají v souboru jiný název, použij ten existující — testy v souboru už tenhle vzor mají (řádek 38).

- [ ] **Step 2: Spusť testy, ověř že padají**

Run: `node --test src/db/schema.test.js src/utils/transfer-category.test.js --test-force-exit`
Expected: FAIL — `prepaid_packages postrádá sloupec id` (tabulka neexistuje), `prave jedna kategorie prepaid_purchase` (0 řádků).

- [ ] **Step 3: Přidej migrace do `src/db/schema.js`**

Do pole migrací (tam, kde jsou ostatní `CREATE TABLE IF NOT EXISTS` jako `subcategories` na řádku 321) přidej:

```javascript
    `CREATE TABLE IF NOT EXISTS prepaid_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      transaction_id INTEGER,
      category_id INTEGER NOT NULL,
      original_category_id INTEGER,
      name TEXT NOT NULL,
      total_amount REAL NOT NULL,
      units_total REAL NOT NULL,
      unit_amount REAL NOT NULL,
      valid_until TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS prepaid_draws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      package_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      units REAL NOT NULL DEFAULT 1,
      amount REAL NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (package_id) REFERENCES prepaid_packages(id) ON DELETE CASCADE
    )`,
    'CREATE INDEX IF NOT EXISTS idx_prepaid_pkg_user ON prepaid_packages(user_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_prepaid_draws_pkg ON prepaid_draws(package_id)',
    'CREATE INDEX IF NOT EXISTS idx_prepaid_draws_date ON prepaid_draws(user_id, date)',
```

- [ ] **Step 4: Přidej bootstrap technické kategorie**

Na konec `initSchema()`, hned za blok `fund_topup` (za řádek 472), přidej strukturně identický blok:

```javascript
  // Bootstrap kategorie prepaid_purchase (Nákup předplacených balíčků). Stejná
  // pravidla jako u fund_topup výš: jen pro uživatele, kteří UŽ MAJÍ kategorie
  // (v household sharingu je má jen data owner), stejnojmenná uživatelská
  // kategorie se povýší místo vkládání, idempotentní.
  const PREPAID_NAME = 'Nákup předplacených balíčků';
  const prepaidOwners = db.prepare(`
    SELECT DISTINCT user_id FROM categories
    WHERE user_id NOT IN (SELECT user_id FROM categories WHERE system_role = 'prepaid_purchase')
  `).all();
  const promotePrepaid = db.prepare("UPDATE categories SET type = 4, system_role = 'prepaid_purchase' WHERE id = ?");
  const insPrepaid = db.prepare(`
    INSERT INTO categories (user_id, name, type, color, icon, system_role)
    VALUES (?, ?, 4, '#8b5cf6', 'Ticket', 'prepaid_purchase')
  `);
  for (const o of prepaidOwners) {
    try {
      const existing = findByName.get(o.user_id, PREPAID_NAME);
      if (existing) {
        promotePrepaid.run(existing.id);
        deleteBudgets.run(o.user_id, existing.id);
      } else {
        insPrepaid.run(o.user_id, PREPAID_NAME);
      }
    } catch { /* selhání bootstrapu pro jednoho uživatele – ostatní pokračují */ }
  }
```

`findByName` a `deleteBudgets` jsou už připravené v bloku `fund_topup` (řádky 452 a 457) — znovu je nedeklaruj.

- [ ] **Step 5: Spusť testy, ověř že prochází**

Run: `node --test src/db/schema.test.js src/utils/transfer-category.test.js --test-force-exit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.js src/db/schema.test.js src/utils/transfer-category.test.js
git commit -m "feat(prepaid): schema predplacenych balicku + technicka kategorie"
```

---

### Task 2: Čisté výpočty balíčku

**Files:**
- Create: `src/utils/prepaid.js`
- Test: `src/utils/prepaid.test.js`

**Interfaces:**
- Produces:
  - `unitAmount(totalAmount, unitsTotal) → number`
  - `drawAmount(unitAmountValue, units) → number`
  - `packageSummary(pkg, draws) → { drawn_units, drawn_amount, remaining_units, remaining_amount, last_draw_date }`
  - `writeOffAmount(pkg, draws) → number`

- [ ] **Step 1: Napiš failing test**

Vytvoř `src/utils/prepaid.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { unitAmount, drawAmount, packageSummary, writeOffAmount } = require('./prepaid');

const PKG = { total_amount: 5000, units_total: 10, unit_amount: 500 };

test('unitAmount deli celkovou castku poctem jednotek', () => {
  assert.equal(unitAmount(5000, 10), 500);
  assert.equal(unitAmount(1000, 3), 1000 / 3);
});

test('unitAmount odmita nulovy nebo zaporny pocet jednotek', () => {
  assert.throws(() => unitAmount(5000, 0), /jednotek/i);
  assert.throws(() => unitAmount(5000, -1), /jednotek/i);
});

test('drawAmount nasobi cenu jednotky poctem jednotek', () => {
  assert.equal(drawAmount(500, 1), 500);
  assert.equal(drawAmount(500, 2), 1000);
});

test('packageSummary secte cerpani a spocita zbytek', () => {
  const draws = [
    { date: '2026-03-05', units: 1, amount: 500 },
    { date: '2026-04-11', units: 2, amount: 1000 },
  ];
  const s = packageSummary(PKG, draws);
  assert.equal(s.drawn_units, 3);
  assert.equal(s.drawn_amount, 1500);
  assert.equal(s.remaining_units, 7);
  assert.equal(s.remaining_amount, 3500);
  assert.equal(s.last_draw_date, '2026-04-11');
});

test('packageSummary bez cerpani vraci plny zbytek a last_draw_date null', () => {
  const s = packageSummary(PKG, []);
  assert.equal(s.drawn_units, 0);
  assert.equal(s.drawn_amount, 0);
  assert.equal(s.remaining_units, 10);
  assert.equal(s.remaining_amount, 5000);
  assert.equal(s.last_draw_date, null);
});

test('packageSummary neklesne pod nulu ani pri prekrocení', () => {
  const s = packageSummary(PKG, [{ date: '2026-03-05', units: 12, amount: 6000 }]);
  assert.equal(s.remaining_units, 0);
  assert.equal(s.remaining_amount, 0);
});

test('writeOffAmount vraci presny zbytek castky vcetne zaokrouhlovaciho rozdilu', () => {
  const pkg = { total_amount: 1000, units_total: 3, unit_amount: 1000 / 3 };
  const draws = [
    { date: '2026-03-01', units: 1, amount: 1000 / 3 },
    { date: '2026-03-02', units: 1, amount: 1000 / 3 },
  ];
  assert.ok(Math.abs(writeOffAmount(pkg, draws) - 1000 / 3) < 0.0001);
  assert.equal(writeOffAmount(PKG, [{ date: '2026-03-01', units: 10, amount: 5000 }]), 0);
});
```

- [ ] **Step 2: Spusť test, ověř že padá**

Run: `node --test src/utils/prepaid.test.js`
Expected: FAIL — `Cannot find module './prepaid'`

- [ ] **Step 3: Implementuj `src/utils/prepaid.js`**

```javascript
'use strict';

// Čisté výpočty nad předplaceným balíčkem. Bez DB, aby šly testovat samostatně.
// Balíček (`pkg`) je řádek prepaid_packages, `draws` pole řádků prepaid_draws.

function unitAmount(totalAmount, unitsTotal) {
  const units = Number(unitsTotal);
  if (!(units > 0)) throw new Error('Počet jednotek musí být kladný.');
  return Number(totalAmount) / units;
}

function drawAmount(unitAmountValue, units) {
  return Number(unitAmountValue) * Number(units);
}

function packageSummary(pkg, draws = []) {
  const drawnUnits = draws.reduce((s, d) => s + Number(d.units || 0), 0);
  const drawnAmount = draws.reduce((s, d) => s + Number(d.amount || 0), 0);
  const dates = draws.map(d => d.date).filter(Boolean).sort();
  return {
    drawn_units: drawnUnits,
    drawn_amount: drawnAmount,
    remaining_units: Math.max(0, Number(pkg.units_total) - drawnUnits),
    remaining_amount: Math.max(0, Number(pkg.total_amount) - drawnAmount),
    last_draw_date: dates.length ? dates[dates.length - 1] : null,
  };
}

// Zbytek k doúčtování při uzavření balíčku. Počítá se z částek, ne z jednotek —
// srovná i drobný rozdíl u nedělitelné ceny jednotky (1000 / 3).
function writeOffAmount(pkg, draws = []) {
  const drawnAmount = draws.reduce((s, d) => s + Number(d.amount || 0), 0);
  return Math.max(0, Number(pkg.total_amount) - drawnAmount);
}

module.exports = { unitAmount, drawAmount, packageSummary, writeOffAmount };
```

- [ ] **Step 4: Spusť test, ověř že prochází**

Run: `node --test src/utils/prepaid.test.js`
Expected: PASS (7 testů)

- [ ] **Step 5: Commit**

```bash
git add src/utils/prepaid.js src/utils/prepaid.test.js
git commit -m "feat(prepaid): ciste vypocty balicku (unitAmount, packageSummary, writeOffAmount)"
```

---

### Task 3: API — seznam balíčků a založení

**Files:**
- Create: `src/routes/prepaid.js`
- Modify: `src/index.js:60` (mount za `/api/fixed-expenses`)
- Test: `src/routes/prepaid.test.js`

**Interfaces:**
- Consumes: `packageSummary`, `unitAmount` z `src/utils/prepaid.js` (Task 2)
- Produces:
  - `GET /api/prepaid?status=active|closed|all&category=<id>&period=YYYY-MM` → `{ packages: [...] }`, každý balíček má sloupce tabulky + `drawn_units`, `drawn_amount`, `remaining_units`, `remaining_amount`, `last_draw_date`, `category_name`, `draws` (pole čerpání; při `period` jen ta z období, jinak všechna)
  - `POST /api/prepaid` `{ transaction_id, name, category_id, units_total, valid_until?, note? }` → 201 + balíček

- [ ] **Step 1: Napiš failing testy**

Vytvoř `src/routes/prepaid.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-prepaid-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./prepaid']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x'),(2,'jiny@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (5,1,'Sport',1),(6,1,'Oblečení',2),(9,2,'Cizí',1)").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type, system_role) VALUES (7,1,'Nákup předplacených balíčků',4,'prepaid_purchase')").run();
  db.prepare("INSERT INTO transactions (id, user_id, category_id, amount, date, description) VALUES (100,1,5,-5000,'2026-03-04','Fitness 10x')").run();
  db.prepare("INSERT INTO transactions (id, user_id, category_id, amount, date, description) VALUES (101,2,9,-1000,'2026-03-04','Cizi platba')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/prepaid', require('./prepaid'));
  return { db, app };
}

async function createPackage(base, body = {}) {
  return fetch(`${base}/api/prepaid`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction_id: 100, name: 'Fitness 10x', category_id: 5, units_total: 10, ...body }),
  });
}

test('POST zalozi balicek a prehodi transakci do technicke kategorie', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const r = await createPackage(base);
  assert.equal(r.status, 201);
  const pkg = await r.json();
  assert.equal(pkg.total_amount, 5000);
  assert.equal(pkg.unit_amount, 500);
  assert.equal(pkg.category_id, 5);
  assert.equal(pkg.original_category_id, 5);
  assert.equal(pkg.status, 'active');
  const tx = db.prepare('SELECT category_id FROM transactions WHERE id = 100').get();
  assert.equal(tx.category_id, 7, 'transakce patri do kategorie prepaid_purchase');
  server.close();
});

test('POST odmitne cizi transakci i cizi kategorii', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  assert.equal((await createPackage(base, { transaction_id: 101 })).status, 404);
  assert.equal((await createPackage(base, { category_id: 9 })).status, 404);
  server.close();
});

test('POST odmitne kategorii, ktera neni typ 1', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const r = await createPackage(base, { category_id: 6 });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /měsíční/i);
  server.close();
});

test('POST odmitne neplatny pocet jednotek a prijmovou transakci', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  assert.equal((await createPackage(base, { units_total: 0 })).status, 400);
  db.prepare("INSERT INTO transactions (id,user_id,category_id,amount,date,description) VALUES (102,1,5,3000,'2026-03-05','Prijem')").run();
  assert.equal((await createPackage(base, { transaction_id: 102 })).status, 400);
  server.close();
});

test('GET vraci aktivni balicky s dopoctem zbytku', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  db.prepare("INSERT INTO prepaid_draws (user_id, package_id, date, units, amount) VALUES (1,?,'2026-04-02',2,1000)").run(pkg.id);
  const { packages } = await (await fetch(`${base}/api/prepaid`)).json();
  assert.equal(packages.length, 1);
  assert.equal(packages[0].drawn_units, 2);
  assert.equal(packages[0].remaining_units, 8);
  assert.equal(packages[0].remaining_amount, 4000);
  assert.equal(packages[0].category_name, 'Sport');
  assert.equal(packages[0].draws.length, 1);
  server.close();
});

test('GET s period vraci jen cerpani daneho obdobi, zbytek pocita ze vsech', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  db.prepare("INSERT INTO prepaid_draws (user_id, package_id, date, units, amount) VALUES (1,?,'2026-04-02',1,500),(1,?,'2026-05-02',1,500)").run(pkg.id, pkg.id);
  const { packages } = await (await fetch(`${base}/api/prepaid?period=2026-04`)).json();
  assert.equal(packages[0].draws.length, 1, 'jen cerpani z dubna');
  assert.equal(packages[0].draws[0].date, '2026-04-02');
  assert.equal(packages[0].drawn_units, 2, 'zbytek se pocita ze vsech cerpani');
  server.close();
});
```

- [ ] **Step 2: Spusť testy, ověř že padají**

Run: `node --test src/routes/prepaid.test.js --test-force-exit`
Expected: FAIL — `Cannot find module './prepaid'`

- [ ] **Step 3: Implementuj `src/routes/prepaid.js`**

```javascript
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { getPeriodDates, getUserBillingDay } = require('../utils/period');
const { unitAmount, packageSummary } = require('../utils/prepaid');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// Balíček + dopočtené hodnoty. `periodRange` (nepovinné) omezí vrácená čerpání
// na jedno období; zbytek balíčku se ale VŽDY počítá ze všech čerpání, jinak by
// v období bez čerpání vypadal balíček jako nedotčený.
function withSummary(pkg, periodRange) {
  const allDraws = db.prepare(
    'SELECT * FROM prepaid_draws WHERE package_id = ? AND user_id = ? ORDER BY date ASC, id ASC'
  ).all(pkg.id, pkg.user_id);
  const draws = periodRange
    ? allDraws.filter(d => d.date >= periodRange.start && d.date <= periodRange.end)
    : allDraws;
  return { ...pkg, ...packageSummary(pkg, allDraws), draws };
}

// GET /api/prepaid?status=active|closed|all&category=<id>&period=YYYY-MM
router.get('/', requireAuth, (req, res) => {
  const status = req.query.status || 'active';
  const filters = ['p.user_id = ?'];
  const params = [req.dataUserId];
  if (status !== 'all') { filters.push('p.status = ?'); params.push(status); }
  if (req.query.category) { filters.push('p.category_id = ?'); params.push(parseInt(req.query.category)); }

  let periodRange = null;
  if (req.query.period) {
    const billingDay = getUserBillingDay(db, req.dataUserId);
    periodRange = getPeriodDates(billingDay, req.query.period);
  }

  const rows = db.prepare(`
    SELECT p.*, c.name AS category_name, c.color AS category_color
    FROM prepaid_packages p
    LEFT JOIN categories c ON c.id = p.category_id AND c.user_id = p.user_id
    WHERE ${filters.join(' AND ')}
    ORDER BY p.status ASC, p.created_at DESC
  `).all(...params);

  res.json({ packages: rows.map(p => withSummary(p, periodRange)) });
});

// POST /api/prepaid — z existující platby udělá balíček
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { transaction_id, name, category_id, units_total, valid_until, note } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Název balíčku je povinný.' });

  const units = parseFloat(units_total);
  if (!(units > 0)) return res.status(400).json({ error: 'Počet jednotek musí být kladné číslo.' });

  const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .get(transaction_id, req.dataUserId);
  if (!tx) return res.status(404).json({ error: 'Transakce nenalezena.' });
  if (!(tx.amount < 0)) return res.status(400).json({ error: 'Balíček lze založit jen z výdajové platby.' });

  const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?')
    .get(category_id, req.dataUserId);
  if (!cat) return res.status(404).json({ error: 'Kategorie nenalezena.' });
  if (cat.type !== 1) {
    return res.status(400).json({ error: 'Čerpání lze účtovat jen do měsíční kategorie (typ 1).' });
  }

  const purchaseCat = db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND system_role = 'prepaid_purchase'"
  ).get(req.dataUserId);
  if (!purchaseCat) return res.status(500).json({ error: 'Chybí technická kategorie pro nákup balíčků.' });

  const existing = db.prepare('SELECT id FROM prepaid_packages WHERE transaction_id = ? AND user_id = ?')
    .get(tx.id, req.dataUserId);
  if (existing) return res.status(409).json({ error: 'Z této platby už balíček existuje.' });

  const total = Math.abs(tx.amount);
  const info = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO prepaid_packages
        (user_id, transaction_id, category_id, original_category_id, name,
         total_amount, units_total, unit_amount, valid_until, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.dataUserId, tx.id, cat.id, tx.category_id, String(name).trim(),
      total, units, unitAmount(total, units), valid_until || null, note || null);
    db.prepare('UPDATE transactions SET category_id = ? WHERE id = ? AND user_id = ?')
      .run(purchaseCat.id, tx.id, req.dataUserId);
    return r;
  })();

  const pkg = db.prepare('SELECT * FROM prepaid_packages WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(withSummary(pkg, null));
});

module.exports = router;
```

- [ ] **Step 4: Mountni router**

V `src/index.js` za řádek 60 (`app.use('/api/fixed-expenses', …)`) přidej:

```javascript
app.use('/api/prepaid', require('./routes/prepaid'));
```

- [ ] **Step 5: Spusť testy, ověř že prochází**

Run: `node --test src/routes/prepaid.test.js --test-force-exit`
Expected: PASS (6 testů)

- [ ] **Step 6: Commit**

```bash
git add src/routes/prepaid.js src/routes/prepaid.test.js src/index.js
git commit -m "feat(prepaid): API pro seznam a zalozeni balicku"
```

---

### Task 4: API — čerpání jednotek

**Files:**
- Modify: `src/routes/prepaid.js`
- Test: `src/routes/prepaid.test.js`

**Interfaces:**
- Consumes: `withSummary`, `drawAmount`, `packageSummary` (Task 2, 3)
- Produces:
  - `POST /api/prepaid/:id/draws` `{ units?, date?, note? }` → 201 + aktualizovaný balíček
  - `DELETE /api/prepaid/draws/:id` → `{ ok: true }`

- [ ] **Step 1: Napiš failing testy**

Přidej do `src/routes/prepaid.test.js`:

```javascript
async function draw(base, pkgId, body = {}) {
  return fetch(`${base}/api/prepaid/${pkgId}/draws`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('POST draws zapise cerpani s cenou jednotky a posune zbytek', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  const r = await draw(base, pkg.id, { date: '2026-04-02' });
  assert.equal(r.status, 201);
  const updated = await r.json();
  assert.equal(updated.drawn_units, 1);
  assert.equal(updated.drawn_amount, 500);
  assert.equal(updated.remaining_units, 9);
  assert.equal(updated.draws[0].amount, 500);
  server.close();
});

test('POST draws umi vice jednotek najednou', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  const updated = await (await draw(base, pkg.id, { units: 3, date: '2026-04-02' })).json();
  assert.equal(updated.drawn_amount, 1500);
  assert.equal(updated.remaining_units, 7);
  server.close();
});

test('POST draws odmitne prekroceni zbyvajicich jednotek', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  await draw(base, pkg.id, { units: 9, date: '2026-04-02' });
  const r = await draw(base, pkg.id, { units: 2, date: '2026-04-03' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /zbývá/i);
  server.close();
});

test('POST draws odmitne nekladne jednotky a spatny format data', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  assert.equal((await draw(base, pkg.id, { units: 0 })).status, 400);
  assert.equal((await draw(base, pkg.id, { date: '2. 4. 2026' })).status, 400);
  server.close();
});

test('DELETE draws smaze cerpani a vrati zbytek', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  const afterDraw = await (await draw(base, pkg.id, { date: '2026-04-02' })).json();
  const drawId = afterDraw.draws[0].id;
  const r = await fetch(`${base}/api/prepaid/draws/${drawId}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  const n = db.prepare('SELECT COUNT(*) AS n FROM prepaid_draws').get().n;
  assert.equal(n, 0);
  server.close();
});

test('cerpani cizim uzivatelem neprojde', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const pkgId = db.prepare(`
    INSERT INTO prepaid_packages (user_id, category_id, name, total_amount, units_total, unit_amount)
    VALUES (2, 9, 'Cizi balicek', 1000, 2, 500)
  `).run().lastInsertRowid;
  assert.equal((await draw(base, pkgId, {})).status, 404);
  server.close();
});
```

- [ ] **Step 2: Spusť testy, ověř že padají**

Run: `node --test src/routes/prepaid.test.js --test-force-exit`
Expected: FAIL — 404 z neexistující routy `/api/prepaid/:id/draws` (očekáváno 201)

- [ ] **Step 3: Implementuj endpointy**

Do `src/routes/prepaid.js` nad `module.exports` přidej (a rozšiř import o `drawAmount`):

```javascript
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function loadPackage(id, userId) {
  return db.prepare('SELECT * FROM prepaid_packages WHERE id = ? AND user_id = ?').get(id, userId);
}

// POST /api/prepaid/:id/draws — odtiknutí jedné (nebo více) jednotek
router.post('/:id/draws', requireAuth, writeLimiter, (req, res) => {
  const pkg = loadPackage(req.params.id, req.dataUserId);
  if (!pkg) return res.status(404).json({ error: 'Balíček nenalezen.' });

  const units = req.body.units == null ? 1 : parseFloat(req.body.units);
  if (!(units > 0)) return res.status(400).json({ error: 'Počet jednotek musí být kladné číslo.' });

  const date = req.body.date || todayISO();
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Datum musí být ve formátu RRRR-MM-DD.' });

  const existing = db.prepare('SELECT * FROM prepaid_draws WHERE package_id = ? AND user_id = ?')
    .all(pkg.id, req.dataUserId);
  const summary = packageSummary(pkg, existing);
  if (units > summary.remaining_units) {
    return res.status(400).json({ error: `V balíčku zbývá jen ${summary.remaining_units} jednotek.` });
  }

  db.prepare(`
    INSERT INTO prepaid_draws (user_id, package_id, date, units, amount, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.dataUserId, pkg.id, date, units, drawAmount(pkg.unit_amount, units), req.body.note || null);

  res.status(201).json(withSummary(loadPackage(pkg.id, req.dataUserId), null));
});

// DELETE /api/prepaid/draws/:id — oprava omylem zapsaného čerpání
router.delete('/draws/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM prepaid_draws WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Čerpání nenalezeno.' });
  db.prepare('DELETE FROM prepaid_draws WHERE id = ?').run(row.id);
  res.json({ ok: true });
});
```

**Pozor na pořadí rout:** `/draws/:id` musí být deklarované tak, aby ho nezachytila `/:id` routa z Tasku 5 (`DELETE /:id`). Express matchuje v pořadí deklarace, takže `DELETE /draws/:id` napiš **před** `DELETE /:id`.

- [ ] **Step 4: Spusť testy, ověř že prochází**

Run: `node --test src/routes/prepaid.test.js --test-force-exit`
Expected: PASS (12 testů)

- [ ] **Step 5: Commit**

```bash
git add src/routes/prepaid.js src/routes/prepaid.test.js
git commit -m "feat(prepaid): cerpani jednotek balicku"
```

---

### Task 5: API — uzavření a zrušení balíčku

**Files:**
- Modify: `src/routes/prepaid.js`
- Test: `src/routes/prepaid.test.js`

**Interfaces:**
- Consumes: `writeOffAmount` z `src/utils/prepaid.js`, `loadPackage`, `withSummary` (Task 3, 4)
- Produces:
  - `POST /api/prepaid/:id/close` `{ write_off: boolean }` → balíček se `status='closed'`
  - `DELETE /api/prepaid/:id` → `{ ok: true }`, transakce se vrátí do `original_category_id`

- [ ] **Step 1: Napiš failing testy**

Přidej do `src/routes/prepaid.test.js`:

```javascript
async function close(base, pkgId, writeOff) {
  return fetch(`${base}/api/prepaid/${pkgId}/close`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ write_off: writeOff }),
  });
}

test('close s write_off doucuje zbytek jednim cerpanim', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  await draw(base, pkg.id, { units: 4, date: '2026-04-02' });
  const closed = await (await close(base, pkg.id, true)).json();
  assert.equal(closed.status, 'closed');
  assert.equal(closed.drawn_amount, 5000, 'doucteni srovna celou castku');
  assert.equal(closed.remaining_amount, 0);
  assert.equal(closed.draws.length, 2);
  assert.equal(closed.draws[1].amount, 3000);
  server.close();
});

test('close bez write_off jen uzavre a zbytek nechá nedocerpany', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  await draw(base, pkg.id, { units: 4, date: '2026-04-02' });
  const closed = await (await close(base, pkg.id, false)).json();
  assert.equal(closed.status, 'closed');
  assert.equal(closed.drawn_amount, 2000);
  assert.equal(closed.remaining_amount, 3000);
  server.close();
});

test('uzavreny balicek uz nelze cerpat', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  await close(base, pkg.id, false);
  const r = await draw(base, pkg.id, { date: '2026-05-02' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /uzavřen/i);
  server.close();
});

test('DELETE vrati transakci do puvodni kategorie a smaze cerpani', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  await draw(base, pkg.id, { date: '2026-04-02' });
  const r = await fetch(`${base}/api/prepaid/${pkg.id}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT category_id FROM transactions WHERE id = 100').get().category_id, 5);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prepaid_draws').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prepaid_packages').get().n, 0);
  server.close();
});

test('GET status=closed vraci uzavrene balicky', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const pkg = await (await createPackage(base)).json();
  await close(base, pkg.id, false);
  assert.equal((await (await fetch(`${base}/api/prepaid`)).json()).packages.length, 0);
  assert.equal((await (await fetch(`${base}/api/prepaid?status=closed`)).json()).packages.length, 1);
  assert.equal((await (await fetch(`${base}/api/prepaid?status=all`)).json()).packages.length, 1);
  server.close();
});
```

- [ ] **Step 2: Spusť testy, ověř že padají**

Run: `node --test src/routes/prepaid.test.js --test-force-exit`
Expected: FAIL — routa `/close` neexistuje (404 místo 200)

- [ ] **Step 3: Implementuj endpointy**

Rozšiř import o `writeOffAmount` a přidej do `src/routes/prepaid.js` (`DELETE /:id` až **za** `DELETE /draws/:id` z Tasku 4):

```javascript
// POST /api/prepaid/:id/close — uzavření balíčku, volitelně s doúčtováním zbytku
router.post('/:id/close', requireAuth, writeLimiter, (req, res) => {
  const pkg = loadPackage(req.params.id, req.dataUserId);
  if (!pkg) return res.status(404).json({ error: 'Balíček nenalezen.' });

  const draws = db.prepare('SELECT * FROM prepaid_draws WHERE package_id = ? AND user_id = ?')
    .all(pkg.id, req.dataUserId);
  const rest = writeOffAmount(pkg, draws);
  const summary = packageSummary(pkg, draws);

  db.transaction(() => {
    if (req.body.write_off && rest > 0) {
      db.prepare(`
        INSERT INTO prepaid_draws (user_id, package_id, date, units, amount, note)
        VALUES (?, ?, ?, ?, ?, 'Doúčtování zbytku při uzavření')
      `).run(req.dataUserId, pkg.id, todayISO(), summary.remaining_units, rest);
    }
    db.prepare("UPDATE prepaid_packages SET status = 'closed', closed_at = datetime('now') WHERE id = ?")
      .run(pkg.id);
  })();

  res.json(withSummary(loadPackage(pkg.id, req.dataUserId), null));
});

// DELETE /api/prepaid/:id — zrušení balíčku; transakce se vrátí do původní kategorie
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const pkg = loadPackage(req.params.id, req.dataUserId);
  if (!pkg) return res.status(404).json({ error: 'Balíček nenalezen.' });

  db.transaction(() => {
    if (pkg.transaction_id) {
      db.prepare('UPDATE transactions SET category_id = ? WHERE id = ? AND user_id = ?')
        .run(pkg.original_category_id, pkg.transaction_id, req.dataUserId);
    }
    db.prepare('DELETE FROM prepaid_packages WHERE id = ?').run(pkg.id);
  })();

  res.json({ ok: true });
});
```

Do `POST /:id/draws` (Task 4) přidej hned za načtení balíčku guard:

```javascript
  if (pkg.status === 'closed') return res.status(400).json({ error: 'Balíček je uzavřený.' });
```

- [ ] **Step 4: Spusť testy, ověř že prochází**

Run: `node --test src/routes/prepaid.test.js --test-force-exit`
Expected: PASS (17 testů)

- [ ] **Step 5: Commit**

```bash
git add src/routes/prepaid.js src/routes/prepaid.test.js
git commit -m "feat(prepaid): uzavreni a zruseni balicku"
```

---

### Task 6: `/api/budgets` — čerpání v rozpočtu

**Files:**
- Modify: `src/routes/budgets.js:19-50`
- Test: `src/routes/budgets.test.js` (nový soubor)

**Interfaces:**
- Produces: `GET /api/budgets` vrací u každého budgetu navíc `prepaid_spent` (číslo) a `budget_spent` (= `spent + prepaid_spent`). **`spent` zůstává beze změny** — je to čistě součet transakcí a jedou z něj cash-flow konzumenti (Schůzka, Spořicí účet).

- [ ] **Step 1: Napiš failing test**

Vytvoř `src/routes/budgets.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-budgets-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./budgets']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (5,1,'Sport',1)").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type, system_role) VALUES (7,1,'Nákup předplacených balíčků',4,'prepaid_purchase')").run();
  db.prepare("INSERT INTO budgets (user_id, category_id, month, amount) VALUES (1,5,'default',2000)").run();
  db.prepare(`
    INSERT INTO prepaid_packages (id, user_id, category_id, name, total_amount, units_total, unit_amount)
    VALUES (1, 1, 5, 'Fitness 10x', 5000, 10, 500)
  `).run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/budgets', require('./budgets'));
  return { db, app };
}

test('budget_spent scita transakce i cerpani balicku v obdobi', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-300,'2026-04-05','Cokoliv')").run();
  db.prepare("INSERT INTO prepaid_draws (user_id, package_id, date, units, amount) VALUES (1,1,'2026-04-10',1,500)").run();
  const { budgets } = await (await fetch(`${base}/api/budgets?period=2026-04`)).json();
  const row = budgets.find(b => b.category_id === 5);
  assert.equal(row.spent, 300, 'spent zustava cistě transakcni');
  assert.equal(row.prepaid_spent, 500);
  assert.equal(row.budget_spent, 800);
  server.close();
});

test('cerpani mimo obdobi se nepocita', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO prepaid_draws (user_id, package_id, date, units, amount) VALUES (1,1,'2026-03-30',1,500)").run();
  const { budgets } = await (await fetch(`${base}/api/budgets?period=2026-04`)).json();
  const row = budgets.find(b => b.category_id === 5);
  assert.equal(row.prepaid_spent, 0);
  assert.equal(row.budget_spent, 0);
  server.close();
});

test('nakup balicku v technicke kategorii nezvysi zadny mesicni budget', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,7,-5000,'2026-04-04','Fitness 10x')").run();
  const { budgets } = await (await fetch(`${base}/api/budgets?period=2026-04`)).json();
  const row = budgets.find(b => b.category_id === 5);
  assert.equal(row.spent, 0);
  assert.equal(row.budget_spent, 0);
  server.close();
});

test('bez cerpani je budget_spent rovno spent', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-450,'2026-04-05','Cokoliv')").run();
  const { budgets } = await (await fetch(`${base}/api/budgets?period=2026-04`)).json();
  const row = budgets.find(b => b.category_id === 5);
  assert.equal(row.prepaid_spent, 0);
  assert.equal(row.budget_spent, row.spent);
  server.close();
});
```

- [ ] **Step 2: Spusť test, ověř že padá**

Run: `node --test src/routes/budgets.test.js --test-force-exit`
Expected: FAIL — `row.prepaid_spent` je `undefined`, očekáváno 500

- [ ] **Step 3: Rozšiř dotaz v `src/routes/budgets.js`**

Do SELECTu (za `) as spent` na řádku 35) přidej další poddotaz:

```sql
      COALESCE((
        SELECT SUM(d.amount)
        FROM prepaid_draws d
        JOIN prepaid_packages p ON p.id = d.package_id AND p.user_id = d.user_id
        WHERE d.user_id = db.user_id
          AND p.category_id = db.category_id
          AND d.date >= ? AND d.date <= ?
      ), 0) as prepaid_spent
```

Parametry se předávají pozičně — `.all(...)` na řádku 42 proto musí mít `start, end` **dvakrát**, ve stejném pořadí jako poddotazy:

```javascript
  `).all(start, end, start, end, periodKey, req.dataUserId);
```

A do mapování (řádek 45-48) přidej součet:

```javascript
  // `spent` = jen transakce (čte ho Schůzka i Spořicí účet — cash-flow).
  // `budget_spent` = co se počítá proti měsíčnímu rozpočtu, tedy včetně čerpání
  // předplacených balíčků. Rozpočtové zobrazení musí sáhnout po `budget_spent`.
  const budgets = rows.map(r => ({
    ...r,
    id: r.override_id ?? r.default_id,
    budget_spent: r.spent + r.prepaid_spent,
  }));
```

- [ ] **Step 4: Spusť testy, ověř že prochází**

Run: `node --test src/routes/budgets.test.js --test-force-exit`
Expected: PASS (4 testy)

- [ ] **Step 5: Commit**

```bash
git add src/routes/budgets.js src/routes/budgets.test.js
git commit -m "feat(prepaid): budget_spent v /api/budgets zahrnuje cerpani balicku"
```

---

### Task 7: Stats, matcher fixních plateb a ochrana kategorie

**Files:**
- Modify: `src/routes/stats.js:52-63` (accounting), `src/routes/stats.js:201-216` (odpověď)
- Modify: `src/utils/fixed-expenses.js:60,71`
- Test: `src/routes/stats.test.js`, `src/utils/fixed-expenses.test.js`, `src/routes/categories.test.js`

**Interfaces:**
- Produces: `GET /api/stats/overview` vrací `prepaid_purchase: { category_id, name, outflow, tx_count }` (outflow = kladné číslo, součet odchozích plateb v technické kategorii za období). Kategorie se `system_role='prepaid_purchase'` se **neobjeví** v poli `accounting`.

- [ ] **Step 1: Napiš failing testy**

Do `src/routes/stats.test.js`:

```javascript
test('prepaid_purchase: outflow secte nakupy balicku za obdobi', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type,system_role) VALUES (41,1,'Nákup předplacených balíčků',4,'prepaid_purchase')").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,41,-5000,'2026-07-04','Fitness 10x'),(1,41,-2000,'2026-07-20','Masaze 5x'),(1,41,-1000,'2026-06-30','Minule obdobi')").run();
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.prepaid_purchase.category_id, 41);
  assert.equal(stats.prepaid_purchase.outflow, 7000);
  assert.equal(stats.prepaid_purchase.tx_count, 2);
  server.close();
});

test('prepaid_purchase: technicka kategorie se neobjevi v sekci Ucetni', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type,system_role) VALUES (41,1,'Nákup předplacených balíčků',4,'prepaid_purchase')").run();
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (42,1,'Převody interní',4)").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,41,-5000,'2026-07-04','Fitness 10x'),(1,42,-100,'2026-07-05','Prevod')").run();
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  const ids = (stats.accounting || []).map(a => a.id);
  assert.ok(!ids.includes(41), 'prepaid_purchase nepatri do sekce Ucetni');
  assert.ok(ids.includes(42), 'skutecne prevody v sekci Ucetni zustavaji');
  server.close();
});

test('prepaid_purchase: bez technicke kategorie vraci nuly', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.prepaid_purchase.category_id, null);
  assert.equal(stats.prepaid_purchase.outflow, 0);
  server.close();
});
```

Do `src/utils/fixed-expenses.test.js` (vzor je na řádku 355):

```javascript
test('fixedExpensesForPeriod: NEmatchuje tx v kategorii prepaid_purchase', () => {
  const db = freshDb();
  db.prepare("INSERT INTO categories (id, user_id, name, type, system_role) VALUES (32,1,'Nákup předplacených balíčků',4,'prepaid_purchase')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, match_pattern, include_transfers) VALUES (1,'Fitness',5000,'Fitness',1)").run();
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,32,-5000,'2026-07-04','Fitness 10x')").run();
  const rows = fixedExpensesForPeriod(db, 1, '2026-07-01', '2026-07-31');
  assert.equal(rows[0].tx_count, 0, 'nakup balicku se nesmi zapocitat jako fixni platba');
});
```

Přesné názvy helperů (`freshDb`, `fixedExpensesForPeriod`) a povinné sloupce `fixed_expenses` opiš z existujících testů v tom souboru — nevymýšlej vlastní.

Do `src/routes/categories.test.js`:

```javascript
test('systemovou kategorii prepaid_purchase nelze prepnout na jiny typ ani smazat', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type,system_role) VALUES (50,1,'Nákup předplacených balíčků',4,'prepaid_purchase')").run();
  const patched = await (await fetch(`${base}/api/categories/50`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 1 }),
  })).json();
  assert.equal(patched.type, 4, 'typ systemove kategorie se nemeni');
  const del = await fetch(`${base}/api/categories/50`, { method: 'DELETE' });
  assert.equal(del.status, 400);
  server.close();
});
```

- [ ] **Step 2: Spusť testy, ověř které padají**

Run: `node --test src/routes/stats.test.js src/utils/fixed-expenses.test.js src/routes/categories.test.js --test-force-exit`
Expected: FAIL u stats (`stats.prepaid_purchase` je `undefined`, kategorie je v `accounting`) a u fixed-expenses (`tx_count` = 1). Test v `categories.test.js` **projde už teď** — ochrana přes `cat.system_role` v `src/routes/categories.js:89,123` existuje; test ji jen zafixuje proti regresi.

- [ ] **Step 3: Vylouč technickou kategorii ze sekce Účetní**

V `src/routes/stats.js` uprav `accounting` dotaz (řádek 60):

```javascript
    WHERE c.user_id = ? AND c.type = 4
      AND COALESCE(c.system_role, '') != 'prepaid_purchase'
```

a nad dotaz doplň k existujícímu komentáři větu:

```javascript
  // `prepaid_purchase` je z Účetní sekce vyloučená: není to převod mezi vlastními
  // účty, ale skutečný výdaj, takže saldo nemá smysl kontrolovat na nulu.
```

- [ ] **Step 4: Přidej agregát `prepaid_purchase`**

V `src/routes/stats.js` za blok `annual_off_fund` (řádek 199) přidej:

```javascript
  // ── Nákup předplacených balíčků ──
  // Skutečný odliv za období. Čerpání balíčku se do bilance NEpromítá (to je
  // rozpočtový pohled v /api/budgets), takže se nic nezapočte dvakrát.
  const prepaidCat = db.prepare(
    "SELECT id, name FROM categories WHERE user_id = ? AND system_role = 'prepaid_purchase'"
  ).get(req.dataUserId);
  let prepaidPurchase = { category_id: null, name: null, outflow: 0, tx_count: 0 };
  if (prepaidCat) {
    const p = db.prepare(`
      SELECT COALESCE(SUM(-t.amount), 0) AS outflow, COUNT(t.id) AS tx_count
      FROM transactions t
      WHERE t.user_id = ? AND t.category_id = ? AND t.amount < 0
        AND t.date >= ? AND t.date <= ?
    `).get(req.dataUserId, prepaidCat.id, start, end);
    prepaidPurchase = {
      category_id: prepaidCat.id, name: prepaidCat.name,
      outflow: p.outflow, tx_count: p.tx_count,
    };
  }
```

A do `res.json({...})` (řádek 215) přidej:

```javascript
    prepaid_purchase: prepaidPurchase,
```

- [ ] **Step 5: Zobecni guard v matcheru fixních plateb**

V `src/utils/fixed-expenses.js` nahraď na řádcích 60 a 71:

```javascript
      AND COALESCE(c.system_role, '') != 'fund_topup'
```

za:

```javascript
      AND COALESCE(c.system_role, '') = ''
```

a uprav komentář nad tím (řádek 49) na:

```javascript
  // Systémové kategorie (categories.system_role — fund_topup, prepaid_purchase)
  // jsou technické a nesmí se párovat s fixními platbami: jinak by se stejný
  // odliv počítal dvakrát (jednou jako fixní platba, jednou vlastním řádkem bilance).
```

- [ ] **Step 6: Spusť testy, ověř že prochází**

Run: `node --test src/routes/stats.test.js src/utils/fixed-expenses.test.js src/routes/categories.test.js --test-force-exit`
Expected: PASS

- [ ] **Step 7: Spusť celou backendovou sadu**

Run: `node --test 'src/**/*.test.js' --test-force-exit`
Expected: PASS, žádný regresní pád (zejména stávající testy `fund_topup`)

- [ ] **Step 8: Commit**

```bash
git add src/routes/stats.js src/routes/stats.test.js src/utils/fixed-expenses.js src/utils/fixed-expenses.test.js src/routes/categories.test.js
git commit -m "feat(prepaid): agregat nakupu balicku ve stats + guard matcheru fixnich plateb"
```

---

### Task 8: Stránka Předplacené balíčky

**Files:**
- Create: `client/src/pages/PrepaidPage.jsx`
- Create: `client/src/components/PrepaidPackageCard.jsx`
- Modify: `client/src/App.jsx:106` (routa), `client/src/components/Sidebar.jsx:40` (menu), `client/src/i18n.js:7` (nav popisek)

**Interfaces:**
- Consumes: `GET /api/prepaid`, `POST /api/prepaid/:id/draws`, `DELETE /api/prepaid/draws/:id`, `POST /api/prepaid/:id/close`, `DELETE /api/prepaid/:id` (Task 3–5)
- Produces: komponenta `PrepaidPackageCard` s props `{ pkg, compact, onChanged }` — `compact` skryje historii čerpání a tlačítka správy, `onChanged(updatedPackage | null)` se volá po každé mutaci (`null` = balíček smazán). Znovu ji použije Dashboard (Task 9).

- [ ] **Step 1: Vytvoř komponentu `client/src/components/PrepaidPackageCard.jsx`**

```jsx
import { useState } from 'react';
import { Plus, Trash2, Lock } from 'lucide-react';
import { formatCurrency } from '../i18n';

// Karta jednoho předplaceného balíčku. `compact` = varianta pro Dashboard
// (jen zbytek + tlačítko +1), plná varianta přidá historii čerpání a správu.
export default function PrepaidPackageCard({ pkg, compact = false, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function call(url, options) {
    setBusy(true);
    try {
      const r = await fetch(url, options);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        alert(body.error || 'Akce se nezdařila.');
        return;
      }
      const data = await r.json().catch(() => null);
      onChanged?.(data && data.id ? data : null);
    } finally {
      setBusy(false);
    }
  }

  function addDraw(units) {
    return call(`/api/prepaid/${pkg.id}/draws`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ units }),
    });
  }

  function removeDraw(drawId) {
    if (!confirm('Smazat toto čerpání?')) return;
    return call(`/api/prepaid/draws/${drawId}`, { method: 'DELETE' });
  }

  function closePackage() {
    const writeOff = pkg.remaining_amount > 0 &&
      confirm(`V balíčku zbývá ${formatCurrency(pkg.remaining_amount)}. Doúčtovat zbytek do aktuálního měsíce?`);
    return call(`/api/prepaid/${pkg.id}/close`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ write_off: writeOff }),
    });
  }

  function deletePackage() {
    if (!confirm('Zrušit balíček? Platba se vrátí do původní kategorie a čerpání se smažou.')) return;
    return call(`/api/prepaid/${pkg.id}`, { method: 'DELETE' });
  }

  const closed = pkg.status === 'closed';

  return (
    <div className="prepaid-card">
      <div className="prepaid-card-header">
        <div>
          <div className="prepaid-card-name">{pkg.name}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {pkg.category_name}
            {pkg.valid_until && ` · platí do ${pkg.valid_until}`}
            {closed && ' · uzavřený'}
            {!pkg.transaction_id && ' · zdrojová platba smazána'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 600 }}>
            zbývá {pkg.remaining_units} z {pkg.units_total}
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>{formatCurrency(pkg.remaining_amount)}</div>
        </div>
      </div>

      {!closed && (
        <div className="prepaid-card-actions">
          <button className="btn btn-primary btn-sm" disabled={busy || pkg.remaining_units <= 0}
            onClick={() => addDraw(1)} title="Odečíst jednu jednotku">
            <Plus size={14} /> 1
          </button>
          {pkg.remaining_units >= 2 && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => addDraw(2)}>+2</button>
          )}
          {!compact && (
            <>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={closePackage}>
                <Lock size={14} /> Uzavřít
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={deletePackage}>
                <Trash2 size={14} /> Zrušit
              </button>
            </>
          )}
        </div>
      )}

      {!compact && (
        <>
          <button type="button" className="budget-subcat-toggle" onClick={() => setOpen(o => !o)}>
            {open ? '▾' : '▸'} historie čerpání ({pkg.draws?.length || 0})
          </button>
          {open && (
            <div className="budget-subcat-list">
              {(pkg.draws || []).map(d => (
                <div key={d.id} className="budget-subcat-row">
                  <span className="budget-subcat-name">
                    {`${+d.date.slice(8, 10)}. ${+d.date.slice(5, 7)}. ${d.date.slice(0, 4)}`}
                    {d.note && <span className="text-muted"> · {d.note}</span>}
                  </span>
                  <span className="budget-subcat-spent">
                    {d.units}× {formatCurrency(d.amount)}
                    <button className="btn btn-ghost btn-sm" disabled={busy}
                      onClick={() => removeDraw(d.id)} title="Smazat čerpání">×</button>
                  </span>
                </div>
              ))}
              {!(pkg.draws || []).length && <div className="text-muted">Zatím žádné čerpání.</div>}
            </div>
          )}
          {closed && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={deletePackage}>
              <Trash2 size={14} /> Zrušit balíček
            </button>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Vytvoř stránku `client/src/pages/PrepaidPage.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PrepaidPackageCard from '../components/PrepaidPackageCard';
import { t } from '../i18n';

export default function PrepaidPage() {
  const [searchParams] = useSearchParams();
  const [packages, setPackages] = useState([]);
  const [status, setStatus] = useState('active');
  const [loading, setLoading] = useState(true);

  const category = searchParams.get('category') || '';
  const period = searchParams.get('period') || '';

  function load() {
    const qs = new URLSearchParams({ status });
    if (category) qs.set('category', category);
    if (period) qs.set('period', period);
    setLoading(true);
    fetch(`/api/prepaid?${qs}`)
      .then(r => r.json())
      .then(d => setPackages(d.packages || []))
      .finally(() => setLoading(false));
  }

  useEffect(load, [status, category, period]);

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{t.nav.prepaid}</h1>
        <div className="month-nav">
          {['active', 'closed', 'all'].map(s => (
            <button key={s} className={`btn ${status === s ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setStatus(s)}>
              {s === 'active' ? 'Aktivní' : s === 'closed' ? 'Uzavřené' : 'Vše'}
            </button>
          ))}
        </div>
      </div>

      {loading ? <div className="page-loading">{t.common.loading}</div> : (
        packages.length === 0 ? (
          <div className="empty-state">
            <p>Žádné předplacené balíčky.</p>
            <p className="text-muted">
              Balíček založíš v Transakcích u platby, kterou jsi ho zaplatil.
            </p>
          </div>
        ) : (
          <div className="prepaid-list">
            {packages.map(p => (
              <PrepaidPackageCard key={p.id} pkg={p} onChanged={load} />
            ))}
          </div>
        )
      )}
    </Layout>
  );
}
```

- [ ] **Step 3: Zaregistruj routu, menu a texty**

`client/src/App.jsx` — přidej import k ostatním stránkám a routu za řádek 106:

```jsx
import PrepaidPage from './pages/PrepaidPage';
```

```jsx
            <Route path="/prepaid"      element={<R el={<PrepaidPage />} />} />
```

`client/src/i18n.js` — do `nav` (za `fixedExpenses` na řádku 7):

```javascript
    prepaid: 'Předplacené balíčky',
```

`client/src/components/Sidebar.jsx` — přidej `Ticket` do importu z `lucide-react` a položku za `/fixed-expenses` (řádek 40):

```javascript
      { to: '/prepaid',    icon: Ticket,    label: t.nav.prepaid },
```

- [ ] **Step 4: Přidej styly do `client/src/App.css`**

Na konec souboru:

```css
/* ── Předplacené balíčky ─────────────────────────────────────────────────── */
.prepaid-list { display: flex; flex-direction: column; gap: 12px; max-width: 720px; }
.prepaid-card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.prepaid-card-header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.prepaid-card-name { font-weight: 600; }
.prepaid-card-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
```

Pokud proměnné `--card` / `--border` v souboru neexistují pod tímto názvem, použij ty, které používá `.budget-item` — cílem je vizuální shoda s kartami rozpočtů.

- [ ] **Step 5: Ověř build**

Run: `cd client && npm run build`
Expected: build projde bez chyby.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/PrepaidPage.jsx client/src/components/PrepaidPackageCard.jsx client/src/App.jsx client/src/App.css client/src/components/Sidebar.jsx client/src/i18n.js
git commit -m "feat(prepaid): stranka Predplacene balicky"
```

---

### Task 9: Měsíční rozpočty — čerpání v teploměru

**Files:**
- Modify: `client/src/pages/DashboardPage.jsx:53-77` (BudgetBar), `:112-137` (BudgetSummary), `:249-268` (sekce)

**Interfaces:**
- Consumes: `budget_spent`, `prepaid_spent` z `/api/budgets` (Task 6); `PrepaidPackageCard` (Task 8)

- [ ] **Step 1: Přepni `BudgetBar` na `budget_spent`**

V `client/src/pages/DashboardPage.jsx` ve `function BudgetBar` nahraď všech pět výskytů `budget.spent` (řádky 56, 57, 58, 61, 73, 77) hodnotou z nové proměnné a přidej podřádek s prokliem. Na začátek funkce:

```jsx
  // `budget_spent` = transakce + čerpání předplacených balíčků. Fallback na
  // `spent` drží komponentu funkční, kdyby API bylo starší (cache klienta).
  const spent = budget.budget_spent ?? budget.spent;
  const prepaid = budget.prepaid_spent || 0;
```

a dál používej `spent` místo `budget.spent`:

```jsx
  const over = spent > budget.amount;
  const remaining = budget.amount - spent;
  const pct = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;
  const state = budgetState({ spent, amount: budget.amount, daysPassed, totalDays });
```

```jsx
          <span style={amountColor ? { color: amountColor, fontWeight: 600 } : undefined}>{formatCurrency(spent)}</span>
```

```jsx
      <Thermometer spent={spent} amount={budget.amount} periodStart={periodStart} periodEnd={periodEnd} />
```

- [ ] **Step 2: Přidej podřádek „z toho předplacené"**

Hned za `<Thermometer …/>` v `BudgetBar`:

```jsx
      {prepaid > 0 && (
        <div onClick={(e) => e.stopPropagation()}>
          <Link to={`/prepaid?category=${budget.category_id}&period=${period}`}
            className="budget-subcat-toggle" style={{ textDecoration: 'none' }}
            title="Klik: čerpání předplacených balíčků, ze kterých je částka">
            z toho předplacené: {formatCurrency(prepaid)}
          </Link>
        </div>
      )}
```

Do importů souboru přidej `Link`:

```jsx
import { useNavigate, Link } from 'react-router-dom';
```

(Pokud už soubor `useNavigate` importuje z `react-router-dom`, jen doplň `Link` do stejného importu.)

- [ ] **Step 3: Přepni `BudgetSummary` na `budget_spent`**

```jsx
  const totalSpent = budgets.reduce((s, b) => s + (b.budget_spent ?? b.spent), 0);
```

- [ ] **Step 4: Přidej sekci Předplacené balíčky**

Do `DashboardPage` přidej stav vedle ostatních (za `const [categories, setCategories] = useState([]);`, řádek 166):

```jsx
  const [packages, setPackages] = useState([]);
```

Vytáhni načtení do funkce nad `useEffect` (řádek 197), aby ji šlo volat i po čerpání:

```jsx
  // Balíčky i rozpočty se po odtiknutí jednotky musí načíst spolu — čerpání mění
  // obojí (zbytek balíčku i `budget_spent` kategorie).
  function loadPrepaidAndBudgets(p) {
    return Promise.all([
      fetch(`/api/prepaid?status=active&period=${p}`).then(r => r.json()),
      fetch(`/api/budgets?period=${p}`).then(r => r.json()),
    ]).then(([prep, buds]) => {
      setPackages(prep.packages || []);
      setBudgets((buds.budgets || []).filter(b => !b.category_type || b.category_type === 1));
    });
  }
```

Do `Promise.all` v `useEffect` (řádek 200-203) přidej čtvrtý fetch a rozšiř destrukturaci:

```jsx
    Promise.all([
      fetch(`/api/stats/overview?period=${period}`).then(r => r.json()),
      fetch(`/api/budgets?period=${period}`).then(r => r.json()),
      fetch('/api/categories').then(r => r.json()),
      fetch(`/api/prepaid?status=active&period=${period}`).then(r => r.json()),
    ]).then(([stats, buds, cats, prep]) => {
```

a do těla `.then` za `setCategories(cats);`:

```jsx
      setPackages(prep.packages || []);
```

Sekci vlož za `</section>` bloku Typ 1 (řádek 268), před sekci Drahé věci:

```jsx
          {packages.length > 0 && (
            <section className="section">
              <h2 className="section-title">Předplacené balíčky</h2>
              <div className="prepaid-list">
                {packages.map(p => (
                  <PrepaidPackageCard key={p.id} pkg={p} compact
                    onChanged={() => loadPrepaidAndBudgets(period)} />
                ))}
              </div>
            </section>
          )}
```

Import komponenty:

```jsx
import PrepaidPackageCard from '../components/PrepaidPackageCard';
```

- [ ] **Step 5: Ověř build a klientské testy**

Run: `cd client && npm run build && cd .. && node --test client/src/utils/*.test.js`
Expected: build projde, klientské testy PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/DashboardPage.jsx
git commit -m "feat(prepaid): cerpani balicku v mesicnich rozpoctech + sekce s tlacitkem +1"
```

---

### Task 10: Založení balíčku z Transakcí

**Files:**
- Modify: `client/src/pages/TransactionsPage.jsx` (editační řádek kolem `:890-900`)

**Interfaces:**
- Consumes: `POST /api/prepaid` (Task 3)

- [ ] **Step 1: Přidej stav a odeslání**

Do `TransactionsPage` (k ostatním `useState` na začátku komponenty):

```jsx
  const [prepaidFor, setPrepaidFor] = useState(null);   // transakce, ze které zakládáme balíček
  const [prepaidData, setPrepaidData] = useState({ name: '', category_id: '', units_total: '', valid_until: '' });
```

A funkci (vedle `saveEdit`):

```jsx
  async function createPrepaid() {
    const r = await fetch('/api/prepaid', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        transaction_id: prepaidFor.id,
        name: prepaidData.name,
        category_id: prepaidData.category_id,
        units_total: prepaidData.units_total,
        valid_until: prepaidData.valid_until || null,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { alert(body.error || 'Balíček se nepodařilo založit.'); return; }
    setPrepaidFor(null);
    setEditId(null);
    load();   // stejné znovunačtení seznamu jako po uložení editace
  }
```

Pokud se funkce pro znovunačtení seznamu v souboru jmenuje jinak než `load`, použij tu existující (hledej, co volá `saveEdit` po úspěchu).

- [ ] **Step 2: Přidej tlačítko do editačního řádku**

Do bloku tlačítek editačního řádku (`Zrušit` / `Uložit`, kolem řádku 893) přidej jako první:

```jsx
                  <button className="btn btn-ghost" type="button"
                    disabled={!(tx.amount < 0)}
                    title={tx.amount < 0 ? 'Z této platby udělat předplacený balíček' : 'Balíček lze založit jen z výdaje'}
                    onClick={() => {
                      setPrepaidFor(tx);
                      setPrepaidData({
                        name: tx.description || 'Předplacený balíček',
                        category_id: tx.category_id || '',
                        units_total: '',
                        valid_until: '',
                      });
                    }}>
                    Předplacený balíček
                  </button>
```

- [ ] **Step 3: Přidej formulář balíčku**

Pod `tx-edit-grid` (uvnitř `tx-edit-row`, před blokem tlačítek) přidej:

```jsx
                {prepaidFor?.id === tx.id && (
                  <div className="tx-edit-grid" style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: 11 }}>Název balíčku</label>
                      <input className="input" value={prepaidData.name}
                        onChange={e => setPrepaidData(d => ({ ...d, name: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: 11 }}>Kategorie čerpání</label>
                      <select className="input" value={prepaidData.category_id}
                        onChange={e => setPrepaidData(d => ({ ...d, category_id: e.target.value }))}>
                        <option value="">— vyber —</option>
                        {categories.filter(c => c.type === 1 && !c.system_role).map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: 11 }}>Počet jednotek</label>
                      <input className="input" type="number" min="1" step="1" value={prepaidData.units_total}
                        onChange={e => setPrepaidData(d => ({ ...d, units_total: e.target.value }))}
                        placeholder="10" style={{ maxWidth: 120 }} />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: 11 }}>Platí do (nepovinné)</label>
                      <input className="input" type="date" value={prepaidData.valid_until}
                        onChange={e => setPrepaidData(d => ({ ...d, valid_until: e.target.value }))}
                        style={{ maxWidth: 160 }} />
                    </div>
                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost" type="button" onClick={() => setPrepaidFor(null)}>Zrušit balíček</button>
                      <button className="btn btn-primary" type="button"
                        disabled={!prepaidData.category_id || !(parseFloat(prepaidData.units_total) > 0)}
                        onClick={createPrepaid}>Založit balíček</button>
                    </div>
                    <div className="text-muted" style={{ gridColumn: '1 / -1', fontSize: 11 }}>
                      Platba se přesune do kategorie „Nákup předplacených balíčků" a v měsíčních
                      rozpočtech se projeví až podle odtikaných jednotek.
                    </div>
                  </div>
                )}
```

- [ ] **Step 4: Ověř build**

Run: `cd client && npm run build`
Expected: build projde bez chyby.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/TransactionsPage.jsx
git commit -m "feat(prepaid): zalozeni balicku primo z transakce"
```

---

### Task 11: Bilance Schůzky — řádek nákupu balíčků

**Files:**
- Modify: `client/src/utils/meetingBalance.js:22-52`
- Modify: `client/src/pages/ReportPage.jsx:239-248` a `:359` (nový řádek bilance)
- Modify: `client/src/pages/SavingsPage.jsx:43-50`
- Test: `client/src/utils/meetingBalance.test.js`

**Interfaces:**
- Consumes: `stats.prepaid_purchase.outflow` (Task 7)
- Produces: `surplusToSavings` a `computeMeetingSurplus` přijímají nový nepovinný parametr `prepaidPurchase` (default 0), který se odečítá; `computeMeetingSurplus` ho vrací ve výsledku.

- [ ] **Step 1: Napiš failing testy**

Do `client/src/utils/meetingBalance.test.js` (styl a importy opiš ze souboru):

```javascript
test('surplusToSavings odecte nakup predplacenych balicku', () => {
  const base = { totalIncome: 100000, totalFixed: 40000, fundTopup: 0, annualOffFund: 0, totalType1: 20000, totalType3: 0 };
  assert.equal(surplusToSavings(base), 40000);
  assert.equal(surplusToSavings({ ...base, prepaidPurchase: 5000 }), 35000);
});

test('computeMeetingSurplus vraci prepaidPurchase a zapocita ho do prebytku', () => {
  const r = computeMeetingSurplus({
    incomeSources: [{ id: 1, actual: 50000 }],
    fixedExpenses: [],
    budgetsType1: [{ spent: 10000, budget_spent: 12000, amount: 15000 }],
    byCategory: [],
    prepaidPurchase: 3000,
  });
  assert.equal(r.prepaidPurchase, 3000);
  assert.equal(r.totalType1, 10000, 'bilance jede z transakcniho spent, ne z budget_spent');
  assert.equal(r.surplus, 37000);
});
```

- [ ] **Step 2: Spusť testy, ověř že padají**

Run: `node --test client/src/utils/meetingBalance.test.js`
Expected: FAIL — přebytek 40000 místo 35000 (parametr se zatím neodečítá).

- [ ] **Step 3: Rozšiř `client/src/utils/meetingBalance.js`**

```javascript
export function surplusToSavings({ totalIncome, totalFixed, fundTopup, annualOffFund, prepaidPurchase, totalType1, totalType3 }) {
  return totalIncome - totalFixed - (fundTopup || 0) - (annualOffFund || 0)
    - (prepaidPurchase || 0) - totalType1 - totalType3;
}
```

V `computeMeetingSurplus` přidej parametr a propiš ho:

```javascript
export function computeMeetingSurplus({
  incomeSources = [],
  fixedExpenses = [],
  budgetsType1 = [],
  byCategory = [],
  fundTopup = 0,
  annualOffFund = 0,
  prepaidPurchase = 0,
} = {}) {
```

```javascript
  const surplus = surplusToSavings({
    totalIncome, totalFixed, fundTopup, annualOffFund, prepaidPurchase, totalType1, totalType3,
  });
  return { totalIncome, totalFixed, fundTopup, annualOffFund, prepaidPurchase, totalType1, totalType3, surplus };
```

A do komentáře nad `surplusToSavings` doplň větu:

```javascript
// `prepaidPurchase` = nákup předplacených balíčků (technická kategorie
// prepaid_purchase). Skutečný odliv v měsíci platby; čerpání balíčku do bilance
// nevstupuje — to je rozpočtový pohled (`budget_spent`), tady by se počítalo dvakrát.
```

**Kritické:** `totalType1` musí dál sčítat `b.spent`, **ne** `b.budget_spent` — jinak by se rozpuštěné čerpání promítlo do bilance a spolu s řádkem nákupu by se stejné peníze započítaly dvakrát.

- [ ] **Step 4: Spusť testy, ověř že prochází**

Run: `node --test client/src/utils/meetingBalance.test.js`
Expected: PASS

- [ ] **Step 5: Přidej řádek do bilance v `ReportPage.jsx`**

K ostatním agregátům (za řádek 240):

```jsx
  const prepaidRow = stats?.prepaid_purchase || null;
```

Do volání `computeMeetingSurplus` (řádek 241-248) přidej:

```jsx
    prepaidPurchase: prepaidRow?.outflow || 0,
```

A za blok „Roční výdaje mimo fond" (za řádek 359), před blok `fundTopupRow`:

```jsx
            {/* Nákup předplacených balíčků — jednorázový odliv v měsíci platby.
                Samotné čerpání balíčku je vidět jen v Měsíčních rozpočtech. */}
            {prepaidRow?.category_id && prepaidRow.outflow !== 0 && (
              <Link to={txLink(`category_ids=${prepaidRow.category_id}&direction=out`)}
                className="report-bilance-row"
                style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                title="Klik: platby za předplacené balíčky v tomto období">
                <span>{prepaidRow.name}</span>
                <span>− {formatCurrency(prepaidRow.outflow)}</span>
              </Link>
            )}
```

- [ ] **Step 6: Propiš parametr i do `SavingsPage.jsx`**

Do volání `computeMeetingSurplus` (řádek 43-50) přidej:

```jsx
    prepaidPurchase: stats?.prepaid_purchase?.outflow || 0,
```

Bez toho by „plán" na Schůzce a na stránce Spořicí účet ukazoval jiné číslo.

- [ ] **Step 7: Ověř build a celou testovou sadu**

Run: `cd client && npm run build && cd .. && node --test client/src/utils/*.test.js && node --test 'src/**/*.test.js' --test-force-exit`
Expected: build projde, obě sady PASS.

- [ ] **Step 8: Commit a push na staging**

```bash
git add client/src/utils/meetingBalance.js client/src/utils/meetingBalance.test.js client/src/pages/ReportPage.jsx client/src/pages/SavingsPage.jsx
git commit -m "feat(prepaid): radek nakupu balicku v bilanci Schuzky"
git push origin staging
```

---

## Ruční ověření na staging (po nasazení)

1. V Transakcích otevři výdajovou platbu → „Předplacený balíček" → název, kategorie typ 1, 10 jednotek → Založit.
2. Transakce má nově kategorii „Nákup předplacených balíčků"; měsíční rozpočet původní kategorie o částku klesl.
3. Schůzka za měsíc platby: nový řádek „Nákup předplacených balíčků" s částkou; přebytek klesl o stejnou částku; sekce Účetní řádek **neobsahuje**.
4. Měsíční rozpočty: sekce „Předplacené balíčky", tlačítko +1 → teploměr kategorie povyskočí o cenu jednotky, podřádek „z toho předplacené" ukazuje stejnou částku a proklikne na `/prepaid`.
5. `/prepaid`: historie čerpání, smazání čerpání vrátí zbytek, „Uzavřít" s doúčtováním přidá zbytkové čerpání do aktuálního měsíce.
6. Zrušení balíčku vrátí platbu do původní kategorie.
