# B-2 Licence subkategorie Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zavést spravovaný číselník subkategorií (per kategorie), plnit `transactions.subcategory_id` z textových pravidel, zobrazit rozpad Licence na subkategorie na Schůzce, v Měsíčních rozpočtech a v Transakcích.

**Architecture:** Nová tabulka `subcategories` (číselník per kategorie), FK `transactions.subcategory_id` a `category_rules.subcategory_id` na `subcategories(id)`. Kategorizační engine (`applyRules`) vrátí objekt `{category, subcategory_id}` místo stringu; dva konzumenti se upraví. Žádná globální parent hierarchie (vyloučeno v balíčku B).

**Tech Stack:** Node.js + Express + better-sqlite3 (CJS, backend); React + Vite (ESM, client/). Backend testy `node --test 'src/**/*.test.js'`, in-memory DB přes `DB_PATH` tmp + `initSchema()`; route testy express + fetch (vzor `src/routes/rules.test.js`).

## Global Constraints

- Migrace aditivní (ALTER/CREATE v `initSchema()` migrations pole, try/catch). Žádné mazání dat. Verze needituje se ručně (husky hook).
- `transactions.subcategory_id` a `category_rules.subcategory_id` jsou FK na **`subcategories(id)`** (ne categories), `ON DELETE SET NULL`.
- `subcategories`: UNIQUE `(user_id, category_id, name)`; ownership přes `req.dataUserId`.
- `applyRules` vrací `{ category, subcategory_id }`. `subcategory_id` je nenulové jen když matchnuvší L3 textové pravidlo ho má; L0/L1/L2/fallback → `null`.
- Subkategorie je jen analytický rozpad — žádné rozpočty na úrovni subkategorie.
- Retroaktivní migrace: aditivní (doplní jen NULL `subcategory_id`), dry-run default + `CONFIRM=1`; prod jen s explicitním potvrzením uživatele.
- Jazyk UI: čeština. Commity + push do `staging`.

---

### Task 1: Schema – tabulka subcategories + FK sloupce

**Files:**
- Modify: `src/db/schema.js` (migrations pole ~284–318)
- Test: `src/db/schema.test.js`

**Interfaces:**
- Produces: tabulka `subcategories(id, user_id, category_id, name, sort_order, created_at)` + UNIQUE index; sloupce `transactions.subcategory_id`, `category_rules.subcategory_id` (FK subcategories, ON DELETE SET NULL).

- [ ] **Step 1: Failing test**

Do `src/db/schema.test.js` přidej (použij `freshDb`/`cleanup` vzor v souboru):

```js
test('migrace: subcategories tabulka + subcategory_id FK sloupce existují', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (5,1,'Licence')").run();
  db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'ChatGPT')").run();
  const sub = db.prepare("SELECT id, name FROM subcategories WHERE name='ChatGPT'").get();
  // FK sloupce na transactions a category_rules existují (INSERT nevyhodí chybu)
  db.prepare("INSERT INTO transactions (user_id, amount, date, description, subcategory_id) VALUES (1,-100,'2026-07-01','OPENAI',?)").run(sub.id);
  db.prepare("INSERT INTO category_rules (user_id, category_id, pattern, subcategory_id) VALUES (1,5,'OPENAI',?)").run(sub.id);
  const tx = db.prepare("SELECT subcategory_id FROM transactions WHERE description='OPENAI'").get();
  cleanup(db, tmp);
  assert.equal(tx.subcategory_id, sub.id);
});
```

- [ ] **Step 2: Run, ověřit selhání**

Run: `node --test src/db/schema.test.js`
Expected: FAIL — `no such table: subcategories`.

- [ ] **Step 3: Přidat migrace**

Do pole `migrations` v `src/db/schema.js` (za poslední ALTER, před uzavřením `]`) přidej:

```js
    `CREATE TABLE IF NOT EXISTS subcategories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_subcat_user_cat_name ON subcategories(user_id, category_id, name)',
    'ALTER TABLE transactions ADD COLUMN subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE SET NULL',
    'ALTER TABLE category_rules ADD COLUMN subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE SET NULL',
```

- [ ] **Step 4: Run, ověřit průchod**

Run: `node --test src/db/schema.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.js src/db/schema.test.js
git commit -m "feat(subcat): schema – tabulka subcategories + subcategory_id FK sloupce"
```

---

### Task 2: applyRules → objekt {category, subcategory_id}

**Files:**
- Modify: `src/utils/apply-rules.js`, `src/utils/load-user-rules.js`, `src/routes/import.js` (~129,148–159), `src/services/emailIngest.js` (~7–24)
- Test: `src/utils/apply-rules.test.js` (přepsat aserce)

**Interfaces:**
- Consumes: `loadUserRules` textOverride objekty s volitelným `subcategory_id`.
- Produces: `applyRules(tx, account, rules) → { category: string, subcategory_id: number|null }`. Konzumenti čtou `.category` a `.subcategory_id`.

- [ ] **Step 1: Přepsat testy applyRules**

V `src/utils/apply-rules.test.js` uprav aserce ze stringu na objekt. Každé `assert.equal(applyRules(...), 'X')` → `assert.equal(applyRules(...).category, 'X')`. Přidej nový test pro subkategorii:

```js
test('L3 textové pravidlo se subcategory_id → vrátí subkategorii', () => {
  const r = { ...rules, textOverrides: [{ pattern: 'OPENAI', category: 'Licence', subcategory_id: 42 }] };
  const out = applyRules({ description: 'OPENAI', amount: -500 }, acc('9999'), r);
  assert.equal(out.category, 'Licence');
  assert.equal(out.subcategory_id, 42);
});

test('pravidlo bez subcategory → subcategory_id null', () => {
  const out = applyRules({ description: 'NĚCO', amount: -100 }, acc('9999'), rules);
  assert.equal(out.subcategory_id, null);
});
```

- [ ] **Step 2: Run, ověřit selhání**

Run: `node --test src/utils/apply-rules.test.js`
Expected: FAIL — applyRules vrací string, `.category`/`.subcategory_id` undefined.

- [ ] **Step 3: Přepsat applyRules**

V `src/utils/apply-rules.js` změň každý `return <string>` na objekt. L3 vrací subcategory z pravidla:

```js
function applyRules(tx, account, rules) {
  const cp = normalizeAccount(tx.counterparty_account);
  if (cp && rules.ownAccountNumbers.includes(cp)) {
    return { category: rules.internalTransferCategory, subcategory_id: null };
  }
  const hay = `${tx.description || ''} ${tx.note || ''} ${tx.place || ''}`.toLowerCase();
  const absAmount = Math.abs(tx.amount);
  for (const o of rules.textOverrides) {
    if (!hay.includes(o.pattern.toLowerCase())) continue;
    if (o.amount_max_abs != null && absAmount > o.amount_max_abs) continue;
    if (o.amount_min_abs != null && absAmount < o.amount_min_abs) continue;
    return { category: o.category, subcategory_id: o.subcategory_id ?? null };
  }
  if (account && rules.accountRules[account.account_number]) {
    return { category: rules.accountRules[account.account_number], subcategory_id: null };
  }
  const ab = (tx.ab_category || '').trim();
  if (rules.abCategoryMap[ab]) return { category: rules.abCategoryMap[ab], subcategory_id: null };
  return { category: rules.fallbackCategory, subcategory_id: null };
}
```

- [ ] **Step 4: loadUserRules přidá subcategory_id**

V `src/utils/load-user-rules.js` přidej `r.subcategory_id` do SELECTu a do výstupního objektu:

```js
  const rows = db.prepare(`
    SELECT r.pattern, r.amount_max_abs, r.amount_min_abs, r.subcategory_id, c.name AS category
    FROM category_rules r
    JOIN categories c ON c.id = r.category_id
    WHERE r.user_id = ?
    ORDER BY (r.amount_max_abs IS NOT NULL OR r.amount_min_abs IS NOT NULL) DESC, r.id ASC
  `).all(userId);
  return rows.map(r => {
    const o = { pattern: r.pattern, category: r.category };
    if (r.amount_max_abs != null) o.amount_max_abs = r.amount_max_abs;
    if (r.amount_min_abs != null) o.amount_min_abs = r.amount_min_abs;
    if (r.subcategory_id != null) o.subcategory_id = r.subcategory_id;
    return o;
  });
```

- [ ] **Step 5: Upravit konzumenty**

`src/routes/import.js` ~ř.148: `const catName = applyRules(...)` → `const { category: catName, subcategory_id } = applyRules(t, account, effectiveRules);`. Do `insert` (ř.86–91) přidej sloupec `subcategory_id` (za `category_id`) a do VALUES `?`; do `insert.run(...)` (ř.152–158) přidej `subcategory_id` jako odpovídající argument.

`src/services/emailIngest.js`: `TX_INSERT` (ř.7–11) + `insertTx` (ř.13–19) rozšiř o `subcategory_id`; `categorize` (ř.21–29) vrací i `subcategory_id` (`const { category, subcategory_id } = applyRules(...)`); `classifyAndStore` předá `subcategory_id` do `insertTx`.

- [ ] **Step 6: Run testy**

Run: `node --test src/utils/apply-rules.test.js && node --test 'src/**/*.test.js'`
Expected: apply-rules PASS; celá sada PASS (import/emailIngest destrukturace nerozbila nic).

- [ ] **Step 7: Commit**

```bash
git add src/utils/apply-rules.js src/utils/apply-rules.test.js src/utils/load-user-rules.js src/routes/import.js src/services/emailIngest.js
git commit -m "feat(subcat): applyRules vrací {category, subcategory_id}, plní se do transakcí"
```

---

### Task 3: Číselník subkategorií – CRUD route

**Files:**
- Create: `src/routes/subcategories.js`, `src/routes/subcategories.test.js`
- Modify: `src/index.js` (mount routeru)

**Interfaces:**
- Produces: `GET /api/subcategories?category_id=`, `POST`, `PATCH /:id`, `DELETE /:id`; vše ownership `dataUserId`.

- [ ] **Step 1: Failing route test**

Vytvoř `src/routes/subcategories.test.js` (vzor `src/routes/rules.test.js` – in-memory DB, express mount, fetch):

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-subcat-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./subcategories']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id,email) VALUES (1,'o@x')").run();
  db.prepare("INSERT INTO categories (id,user_id,name) VALUES (5,1,'Licence')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/subcategories', require('./subcategories'));
  return { db, app };
}
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

test('POST + GET podle category_id', async () => {
  const { app } = setup(); const { server, base } = await listen(app);
  const post = await fetch(`${base}/api/subcategories`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ category_id:5, name:'ChatGPT' }) });
  assert.equal(post.status, 201);
  const list = await (await fetch(`${base}/api/subcategories?category_id=5`)).json();
  assert.equal(list.length, 1); assert.equal(list[0].name, 'ChatGPT');
  server.close();
});

test('POST duplicitní název v kategorii → 409/400', async () => {
  const { app } = setup(); const { server, base } = await listen(app);
  await fetch(`${base}/api/subcategories`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ category_id:5, name:'ChatGPT' }) });
  const dup = await fetch(`${base}/api/subcategories`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ category_id:5, name:'ChatGPT' }) });
  assert.ok(dup.status >= 400);
  server.close();
});
```

- [ ] **Step 2: Run, ověřit selhání**

Run: `node --test src/routes/subcategories.test.js`
Expected: FAIL — `Cannot find module './subcategories'`.

- [ ] **Step 3: Vytvořit router**

Vytvoř `src/routes/subcategories.js` (vzor `src/routes/rules.js`):

```js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

function ownsCategory(userId, categoryId) {
  return !!db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(categoryId, userId);
}

router.get('/', requireAuth, (req, res) => {
  const catId = parseInt(req.query.category_id);
  if (!catId) return res.status(400).json({ error: 'Chybí category_id.' });
  res.json(db.prepare('SELECT * FROM subcategories WHERE user_id = ? AND category_id = ? ORDER BY sort_order ASC, name ASC').all(req.dataUserId, catId));
});

router.post('/', requireAuth, writeLimiter, (req, res) => {
  const categoryId = parseInt(req.body.category_id);
  const name = (req.body.name || '').trim();
  if (!categoryId || !name) return res.status(400).json({ error: 'Vyplň kategorii a název.' });
  if (!ownsCategory(req.dataUserId, categoryId)) return res.status(404).json({ error: 'Kategorie nenalezena.' });
  try {
    const r = db.prepare('INSERT INTO subcategories (user_id, category_id, name, sort_order) VALUES (?, ?, ?, ?)').run(req.dataUserId, categoryId, name, req.body.sort_order ?? 0);
    res.status(201).json(db.prepare('SELECT * FROM subcategories WHERE id = ?').get(r.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Subkategorie s tímto názvem už v kategorii existuje.' });
    throw e;
  }
});

router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM subcategories WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Nenalezeno.' });
  const name = req.body.name != null ? (req.body.name || '').trim() : row.name;
  if (!name) return res.status(400).json({ error: 'Název je povinný.' });
  try {
    db.prepare('UPDATE subcategories SET name = ?, sort_order = ? WHERE id = ?').run(name, req.body.sort_order ?? row.sort_order, row.id);
    res.json(db.prepare('SELECT * FROM subcategories WHERE id = ?').get(row.id));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Duplicitní název.' });
    throw e;
  }
});

router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM subcategories WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Nenalezeno.' });
  db.prepare('DELETE FROM subcategories WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
```

Mount v `src/index.js` (vedle ostatních `app.use('/api/...')`): `app.use('/api/subcategories', require('./routes/subcategories'));`

- [ ] **Step 4: Run, ověřit průchod**

Run: `node --test src/routes/subcategories.test.js`
Expected: PASS (2 testy).

- [ ] **Step 5: Commit**

```bash
git add src/routes/subcategories.js src/routes/subcategories.test.js src/index.js
git commit -m "feat(subcat): CRUD route /api/subcategories"
```

---

### Task 4: Pravidla – subcategory_id

**Files:**
- Modify: `src/routes/rules.js` (GET ~20–30, POST ~33–47, PATCH ~50–67)
- Test: `src/routes/rules.test.js`

**Interfaces:**
- Produces: `POST`/`PATCH /api/rules` přijmou `subcategory_id`; `GET` vrací `subcategory_id` + `subcategory_name`.

- [ ] **Step 1: Failing test**

Do `src/routes/rules.test.js` přidej test (setup souboru zakládá kategorii; přidej i subkategorii):

```js
test('POST pravidlo se subcategory_id ho uloží a GET vrátí', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const catId = db.prepare("SELECT id FROM categories WHERE user_id=1 LIMIT 1").get().id;
  const subId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,?, 'ChatGPT')").run(catId).lastInsertRowid;
  const res = await fetch(`${base}/api/rules`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'OPENAI', category_id:catId, subcategory_id:subId }) });
  assert.equal(res.status, 201);
  const list = await (await fetch(`${base}/api/rules`)).json();
  const rule = list.find(r => r.pattern === 'OPENAI');
  assert.equal(rule.subcategory_id, subId);
  assert.equal(rule.subcategory_name, 'ChatGPT');
  server.close();
});
```

(Pokud `setup()` v souboru nezakládá žádnou kategorii, uprav ho, aby jednu měl — podle stávajícího vzoru.)

- [ ] **Step 2: Run, ověřit selhání**

Run: `node --test src/routes/rules.test.js`
Expected: FAIL — `subcategory_id`/`subcategory_name` undefined.

- [ ] **Step 3: Rozšířit rules.js**

- GET SELECT (~ř.20–26): přidej `LEFT JOIN subcategories sc ON sc.id = r.subcategory_id` a do sloupců `r.subcategory_id, sc.name AS subcategory_name`.
- POST (~ř.43–45): přidej `subcategory_id` do INSERTu:
  ```js
  const subId = req.body.subcategory_id != null ? parseInt(req.body.subcategory_id) : null;
  db.prepare('INSERT INTO category_rules (user_id, category_id, pattern, amount_max_abs, amount_min_abs, subcategory_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.dataUserId, categoryId, pattern, max.value, min.value, subId);
  ```
- PATCH (~ř.64–65): přidej `subcategory_id = ?`:
  ```js
  const subId = 'subcategory_id' in req.body ? (req.body.subcategory_id != null ? parseInt(req.body.subcategory_id) : null) : existing.subcategory_id;
  db.prepare('UPDATE category_rules SET pattern = ?, category_id = ?, amount_max_abs = ?, amount_min_abs = ?, subcategory_id = ? WHERE id = ?')
    .run(pattern, categoryId, max.value, min.value, subId, existing.id);
  ```

- [ ] **Step 4: Run, ověřit průchod**

Run: `node --test src/routes/rules.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/rules.js src/routes/rules.test.js
git commit -m "feat(subcat): pravidla přijímají a vracejí subcategory_id"
```

---

### Task 5: Transakce – GET JOIN + PATCH subcategory_id

**Files:**
- Modify: `src/routes/transactions.js` (GET ~ř.12, PATCH ~154–176)
- Test: `src/routes/transactions.test.js` (nový, vzor rules.test.js)

**Interfaces:**
- Produces: GET transakcí vrací `subcategory_name`; PATCH přijme `subcategory_id`.

- [ ] **Step 1: Failing test**

Vytvoř `src/routes/transactions.test.js` (in-memory DB, mount `./transactions`):

```js
test('PATCH nastaví subcategory_id a GET vrátí subcategory_name', async () => {
  const { db, app } = setup();  // setup zakládá usera + kategorii Licence + tx
  const { server, base } = await listen(app);
  const subId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'ChatGPT')").run().lastInsertRowid;
  const txId = db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1,5,-500,'2026-07-01','OPENAI')").run().lastInsertRowid;
  const res = await fetch(`${base}/api/transactions/${txId}`, { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({ subcategory_id: subId }) });
  assert.equal(res.status, 200);
  const list = await (await fetch(`${base}/api/transactions?period=2026-07`)).json();
  const tx = (list.transactions || list).find(t => t.id === txId);
  assert.equal(tx.subcategory_name, 'ChatGPT');
  server.close();
});
```

(Setup přizpůsob dle skutečného tvaru GET odpovědi — ověř, zda vrací `{transactions: [...]}` nebo pole; uprav aserci.)

- [ ] **Step 2: Run, ověřit selhání**

Run: `node --test src/routes/transactions.test.js`
Expected: FAIL — `subcategory_name` undefined / PATCH neukládá subcategory_id.

- [ ] **Step 3: Rozšířit transactions.js**

- GET základní SELECT (ř.12): přidej `LEFT JOIN subcategories sc ON t.subcategory_id = sc.id` a `sc.name as subcategory_name` do sloupců.
- PATCH (~ř.157 destrukturace, ~165–176 UPDATE): přidej `subcategory_id` do destrukturace `req.body`, do UPDATE `subcategory_id = ?` a do argumentů `subcategory_id !== undefined ? (subcategory_id != null ? parseInt(subcategory_id) : null) : tx.subcategory_id`.

- [ ] **Step 4: Run, ověřit průchod**

Run: `node --test src/routes/transactions.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/transactions.js src/routes/transactions.test.js
git commit -m "feat(subcat): transakce vrací subcategory_name a PATCH přijme subcategory_id"
```

---

### Task 6: Stats – rozpad by_subcategory

**Files:**
- Modify: `src/routes/stats.js` (~ř.30–45 byCategory, ~135–148 response)
- Test: `src/routes/stats.test.js` (nový)

**Interfaces:**
- Produces: `/api/stats/overview` vrací `by_subcategory` = pole `{ category_id, subcategory_id, name, spent }` za období (jen kde `subcategory_id` není NULL), se stejným SPENDING_FILTER jako `by_category`.

- [ ] **Step 1: Failing test**

Vytvoř `src/routes/stats.test.js` — vlož usera, kategorii, subkategorii, 2 transakce se subcategory_id, ověř `by_subcategory` součet za období. (Setup dle rules.test.js; mount `./stats`, endpoint `/api/stats/overview?period=2026-07`.)

```js
test('by_subcategory sečte výdaje per subkategorie v období', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const subId = db.prepare("INSERT INTO subcategories (user_id, category_id, name) VALUES (1,5,'ChatGPT')").run().lastInsertRowid;
  db.prepare("INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description) VALUES (1,5,?,-300,'2026-07-03','OPENAI'),(1,5,?,-200,'2026-07-10','OPENAI')").run(subId, subId);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  const row = (stats.by_subcategory || []).find(r => r.subcategory_id === subId);
  assert.equal(row.spent, 500);
  server.close();
});
```

- [ ] **Step 2: Run, ověřit selhání**

Run: `node --test src/routes/stats.test.js`
Expected: FAIL — `by_subcategory` undefined.

- [ ] **Step 3: Přidat by_subcategory dotaz**

V `src/routes/stats.js` za `byCategory` dotaz (ř.45) přidej paralelní dotaz (reuse `SPENDING_FILTER` z ř.15–19):

```js
  const bySubcategory = db.prepare(`
    SELECT t.subcategory_id, sc.category_id, sc.name,
      COALESCE(SUM(-t.amount), 0) as spent
    FROM transactions t
    JOIN subcategories sc ON sc.id = t.subcategory_id
    WHERE t.user_id = ? AND t.date >= ? AND t.date <= ? ${SPENDING_FILTER}
    GROUP BY t.subcategory_id
    ORDER BY spent DESC
  `).all(req.dataUserId, start, end);
```

Do `res.json({...})` (ř.135–148) přidej `by_subcategory: bySubcategory`.

- [ ] **Step 4: Run, ověřit průchod**

Run: `node --test src/routes/stats.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/stats.js src/routes/stats.test.js
git commit -m "feat(subcat): stats vrací rozpad by_subcategory"
```

---

### Task 7: Frontend – správa číselníku na Kategorie

**Files:**
- Modify: `client/src/pages/CategoriesPage.jsx` (renderItem ~259–296; nová modal komponenta dle vzoru IconPicker ~29–95)

**Interfaces:**
- Consumes: `/api/subcategories` (GET/POST/PATCH/DELETE).

- [ ] **Step 1: Přidat akci + modal**

V `CategoriesPage.jsx`:
- Do řádku kategorie (`renderItem`, akce ~ř.288–294) přidej tlačítko „Subkategorie" (ikona `Layers` z lucide), otevře modal pro danou kategorii.
- Vytvoř komponentu `SubcategoryModal({ category, onClose })` podle vzoru `IconPicker` (overlay `icon-modal-overlay`/`icon-modal`, stopPropagation): načte `GET /api/subcategories?category_id=`, seznam s inline přejmenováním + smazáním, pole „Přidat subkategorii" (POST). Po akci reload seznamu.

Kompletní minimální modal:

```jsx
function SubcategoryModal({ category, onClose }) {
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const load = () => fetch(`/api/subcategories?category_id=${category.id}`).then(r => r.json()).then(setItems);
  useEffect(() => { load(); }, [category.id]);
  const add = async (e) => { e.preventDefault(); if (!name.trim()) return;
    const res = await fetch('/api/subcategories', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ category_id: category.id, name: name.trim() }) });
    if (res.ok) { setName(''); load(); } else { alert((await res.json()).error || 'Chyba'); } };
  const del = async (id) => { await fetch(`/api/subcategories/${id}`, { method:'DELETE' }); load(); };
  return (
    <div className="icon-modal-overlay" onClick={onClose}>
      <div className="icon-modal" onClick={e => e.stopPropagation()}>
        <h3>Subkategorie – {category.name}</h3>
        {items.map(s => (
          <div key={s.id} className="report-budget-row">
            <span className="report-budget-name">{s.name}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => del(s.id)}>Smazat</button>
          </div>
        ))}
        <form onSubmit={add} style={{ display:'flex', gap:8, marginTop:8 }}>
          <input className="input" placeholder="Nová subkategorie" value={name} onChange={e => setName(e.target.value)} />
          <button className="btn btn-primary" type="submit">Přidat</button>
        </form>
        <button className="btn btn-ghost" style={{ marginTop:8 }} onClick={onClose}>Zavřít</button>
      </div>
    </div>
  );
}
```

Stav v `CategoriesPage`: `const [subcatFor, setSubcatFor] = useState(null);` + render `{subcatFor && <SubcategoryModal category={subcatFor} onClose={() => setSubcatFor(null)} />}`.

- [ ] **Step 2: Build**

Run: `cd client && npm run build`
Expected: OK.

- [ ] **Step 3: Vizuální ověření**

Otevřít Kategorie → u Licence „Subkategorie" → přidat ChatGPT/Claude/…, přejmenovat, smazat. Ověř přes `/verify`.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/CategoriesPage.jsx
git commit -m "feat(subcat): správa číselníku subkategorií na stránce Kategorie"
```

---

### Task 8: Frontend – Pravidla dropdown subkategorie

**Files:**
- Modify: `client/src/pages/RulesPage.jsx` (EMPTY ~ř.5, formulář ~128–137, save ~43–63, startEdit ~65–82)

**Interfaces:**
- Consumes: `/api/subcategories?category_id=`; posílá `subcategory_id` do `/api/rules`.

- [ ] **Step 1: Přidat dropdown**

V `RulesPage.jsx`:
- `EMPTY` (ř.5): přidej `subcategory_id: ''`.
- Stav pro subkategorie vybrané kategorie: `const [subcats, setSubcats] = useState([]);` a `useEffect` který při změně `form.category_id` načte `GET /api/subcategories?category_id=` (prázdné pole když není kategorie).
- Za `<select>` kategorie (ř.128–137) přidej dropdown „Subkategorie" (volitelný, prázdná volba + `subcats.map`); disabled/prázdný když kategorie nemá subkategorie.
- `save()` body (ř.47–52): přidej `subcategory_id: form.subcategory_id || null`.
- `startEdit` (ř.65–82): přidej `subcategory_id: rule.subcategory_id ? String(rule.subcategory_id) : ''`.
- Tabulka pravidel (ř.231–242): u kategorie zobraz i `· subcategory_name` když je.

- [ ] **Step 2: Build**

Run: `cd client && npm run build`
Expected: OK.

- [ ] **Step 3: Vizuální ověření**

Pravidla → nové pravidlo OPENAI → kategorie Licence → dropdown nabídne ChatGPT → uložit → v seznamu vidět „Licence · ChatGPT". Ověř přes `/verify`.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/RulesPage.jsx
git commit -m "feat(subcat): dropdown subkategorie ve formuláři pravidla"
```

---

### Task 9: Frontend – Transakce sloupec + edit + filtr

**Files:**
- Modify: `client/src/pages/TransactionsPage.jsx` (ALL_COLS ~10–22, renderCell ~791–836, colsToGrid ~775–788, quick-edit ~712–744, edit řádek ~653–663 + saveEdit ~315–339 + startEdit ~302–313)

**Interfaces:**
- Consumes: `subcategory_name` z GET transakcí; `/api/subcategories?category_id=`; posílá `subcategory_id` do PATCH.

- [ ] **Step 1: Sloupec + edit**

V `TransactionsPage.jsx`:
- `ALL_COLS` (ř.15, za `category_name`): `{ key: 'subcategory_name', label: 'Subkategorie', default: false }`.
- `renderCell` (~ř.802): case `'subcategory_name'` → `tx.subcategory_name || '—'`.
- `colsToGrid` (~ř.781): šířka `subcategory_name: '140px'`.
- Edit řádek (~ř.653): za `<select>` kategorie přidej `<select>` subkategorie (nabídne subkategorie kategorie transakce — načti přes `/api/subcategories?category_id=${editData.category_id}` při editaci; prázdné když kategorie nemá subkategorie). `startEdit` (~ř.306): `subcategory_id`. `saveEdit` body (~ř.316): `subcategory_id`.
- (Volitelně) quick-edit sub-select — může počkat; pro tento task stačí edit řádek.

- [ ] **Step 2: Filtr subkategorie**

Přidej k filtru možnost filtrovat podle subkategorie (rozšíření query param `subcategory_id` — backend GET musí filtr podporovat; pokud není v Task 5, přidej do transactions.js GET WHERE `subcategory_id = ?` když `req.query.subcategory_id`). Minimálně: dropdown/chips subkategorií vybrané kategorie ve filtru. Pokud je to nad rámec rozumného rozsahu jednoho tasku, uveď to jako concern a implementuj filtr přes URL param bez plného chip UI.

- [ ] **Step 3: Build + vizuál**

Run: `cd client && npm run build` → OK. Pak vizuálně: sloupec Subkategorie (zapnout v nastavení sloupců), edit transakce nastaví subkategorii, filtr funguje. Ověř přes `/verify`.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/TransactionsPage.jsx src/routes/transactions.js
git commit -m "feat(subcat): Transakce – sloupec, editace a filtr subkategorie"
```

---

### Task 10: Frontend – rozpad na Schůzce a v Měsíčních rozpočtech

**Files:**
- Modify: `client/src/pages/ReportPage.jsx` (Měsíční výdaje ~535–590), `client/src/pages/DashboardPage.jsx` (BudgetBar ~42–70, render ~217–220)

**Interfaces:**
- Consumes: `by_subcategory` z `/api/stats/overview`.

- [ ] **Step 1: Schůzka rozklik**

V `ReportPage.jsx`: `by_subcategory = stats?.by_subcategory || []`. V sekci Měsíční výdaje u řádku kategorie, která má v `by_subcategory` položky (filtruj podle `category_id`), přidej rozklik (expand state per kategorie) → pod řádkem seznam subkategorií (`name` + `formatCurrency(spent)`), volitelně „celkem". Řádek dostane indikátor rozkliknutí (▸/▾).

- [ ] **Step 2: Měsíční rozpočty rozpad**

V `DashboardPage.jsx`: do `BudgetBar` (nebo pod něj v render smyčce ~217) přidej pro kategorii se subkategoriemi (data z `by_subcategory` filtrovaná `category_id`) rozpad – malý seznam subkategorií pod teploměrem. Reuse `formatCurrency`.

- [ ] **Step 3: Build + vizuál**

Run: `cd client && npm run build` → OK. Vizuálně: Schůzka – Licence řádek jde rozkliknout na ChatGPT/Claude/…; Měsíční rozpočty – pod teploměrem Licence rozpad. Ověř přes `/verify`.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ReportPage.jsx client/src/pages/DashboardPage.jsx
git commit -m "feat(subcat): rozpad subkategorií na Schůzce a v Měsíčních rozpočtech"
```

---

### Task 11: Retroaktivní migrační skript

**Files:**
- Create: `scripts/migrate-subcategories.cjs`

**Interfaces:**
- Produces: skript, který doplní `transactions.subcategory_id` podle textových pravidel, jen kde je dnes NULL.

- [ ] **Step 1: Napsat skript**

Vytvoř `scripts/migrate-subcategories.cjs` podle vzoru `scripts/migrate-email-note-to-description.cjs`:
- Env `DB_PATH` (povinné, guard), `CONFIRM=1` (jinak dry-run).
- Načti pravidla se `subcategory_id` (reuse `loadUserRules` + `applyRules`, nebo přímý SELECT pravidel se subcategory).
- Kandidáti: `SELECT * FROM transactions WHERE user_id=? AND subcategory_id IS NULL AND category_id IS NOT NULL`.
- Pro každou tx aplikuj `applyRules(tx, account, rules)`; pokud vrátí `subcategory_id`, priprav update.
- Dry-run: vypiš počet + ukázku, `if (!CONFIRM) process.exit(0)`.
- Ostrý běh: `db.transaction` s `UPDATE transactions SET subcategory_id = ? WHERE id = ?` (jen kde je dnes NULL). Nemaže nic.

```js
'use strict';
// Retroaktivní doplnění transactions.subcategory_id podle textových pravidel.
// Env: DB_PATH (povinné), CONFIRM=1 pro ostrý zápis (jinak dry-run). USER_ID (volitelné).
// Aditivní: doplní jen NULL subcategory_id, nikdy nemaže.
const path = require('path');
const Database = require('better-sqlite3');
const applyRules = require(path.join(__dirname, '../src/utils/apply-rules'));
const loadUserRules = require(path.join(__dirname, '../src/utils/load-user-rules'));
const seedRules = require(path.join(__dirname, 'seed/rules'));

const DB_PATH = process.env.DB_PATH;
const CONFIRM = process.env.CONFIRM === '1';
if (!DB_PATH) { console.error('Chybí DB_PATH'); process.exit(1); }
const db = new Database(DB_PATH);

const users = process.env.USER_ID ? [{ id: +process.env.USER_ID }] : db.prepare('SELECT id FROM users').all();
let planned = 0;
const updates = [];
for (const u of users) {
  const rules = { ...seedRules, textOverrides: loadUserRules(db, u.id) };
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND subcategory_id IS NULL AND category_id IS NOT NULL').all(u.id);
  for (const t of txs) {
    const account = t.account_id ? db.prepare('SELECT account_number FROM accounts WHERE id = ?').get(t.account_id) : null;
    const { subcategory_id } = applyRules(t, account, rules);
    if (subcategory_id != null) { updates.push({ id: t.id, subcategory_id }); planned++; }
  }
}
console.log(`Kandidátů k doplnění subcategory_id: ${planned}`);
console.log(updates.slice(0, 10));
if (!CONFIRM) { console.log('Dry-run (CONFIRM=1 pro zápis).'); process.exit(0); }
const upd = db.prepare('UPDATE transactions SET subcategory_id = ? WHERE id = ? AND subcategory_id IS NULL');
const tx = db.transaction(() => { for (const u of updates) upd.run(u.subcategory_id, u.id); });
tx();
console.log(`Zapsáno: ${updates.length}`);
```

- [ ] **Step 2: Ověřit dry-run lokálně**

Run: `DB_PATH=./data.db node scripts/migrate-subcategories.cjs`
Expected: vypíše počet kandidátů + ukázku, NEzapíše (dry-run). (Lokálně bez subkategorií/pravidel = 0 kandidátů, to je OK — ověřuje jen, že skript běží.)

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-subcategories.cjs
git commit -m "feat(subcat): retroaktivní migrace subcategory_id (dry-run/CONFIRM)"
```

Pozn.: prod spuštění (`railway ssh` + CONFIRM=1) až po nasazení kódu a s explicitním potvrzením uživatele — NENÍ součástí implementace plánu.

---

## Závěrečné kroky

- [ ] **Celá backend sada:** `node --test 'src/**/*.test.js'` → vše PASS.
- [ ] **Client build:** `cd client && npm run build` → OK.
- [ ] **Push do staging:** `git push origin staging`. Nahlásit verzi. Po vizuální kontrole na pokyn merge do `main`. Retroaktivní migraci na prod až po nasazení, s potvrzením.

## Self-Review

**Spec coverage:**
- subcategories tabulka + FK sloupce → Task 1 ✓
- applyRules objekt + plnění → Task 2 ✓
- číselník CRUD → Task 3 (route) + Task 7 (UI) ✓
- pravidla subcategory → Task 4 (route) + Task 8 (UI) ✓
- transakce sloupec+filtr+edit → Task 5 (backend) + Task 9 (UI) ✓
- rozpad Schůzka + Měsíční rozpočty → Task 6 (stats) + Task 10 (UI) ✓
- retroaktivní migrace → Task 11 ✓
- Non-goals (Apple, budgety subkat) → dodrženo ✓

**Placeholder scan:** Task 5/9 mají poznámky „ověř skutečný tvar" a „pokud nad rámec, uveď concern" — to jsou legitimní implementer-checkpointy u nejistého tvaru odpovědi/rozsahu, ne prázdné placeholdery; každý krok má konkrétní kód nebo přesná místa.

**Type consistency:** `applyRules → {category, subcategory_id}` definováno v Task 2, konzumováno v Task 2 (import/emailIngest) a Task 11 (migrace) shodně. `subcategory_id` FK na subcategories konzistentní napříč Task 1/4/5.
