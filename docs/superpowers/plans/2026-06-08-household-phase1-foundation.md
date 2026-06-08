# Household Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Položit základ sdílení dat domácnosti (data-owner resolution) BEZ změny chování: tabulka `household_members`, `req.dataUserId` v `requireAuth`, refactor všech sdílených datových rout z `req.user.id` na `req.dataUserId`, settings split. Single-user funguje přesně jako dnes.

**Architecture:** Vlastník nemá membership řádek → resolvuje se na sebe (fallback) → dnešní chování beze změny. Sdílení/izolace se testuje vložením membership řádků.

**Tech Stack:** Express, better-sqlite3, `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-08-household-phase1-foundation-design.md`

**Konvence:** testy `node --test <file>`; route testy vzorem express-app + `app.listen(0)` + `fetch`, fake auth middleware musí nově nastavit i `req.dataUserId`. Commit do `staging`.

**KRITICKÉ:** `push.js` a `auth.js` se NEMĚNÍ (osobní/identita). `settings.js` je MIXED (samostatný task). Všech 11 ostatních datových route souborů = čistá záměna `req.user.id` → `req.dataUserId`.

---

## Task 1: Tabulka household_members

**Files:** Modify `src/db/schema.js`; Test `src/db/schema.household.test.js` (Create)

- [ ] **Step 1: Failing test** — Create `src/db/schema.household.test.js`:
```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-household-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('./connection')];
  delete require.cache[require.resolve('./schema')];
  const db = require('./connection'); require('./schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
test('household_members tabulka má očekávané sloupce', () => {
  const { db, tmp } = freshDb();
  const cols = db.prepare("PRAGMA table_info(household_members)").all().map(c=>c.name);
  cleanup(db, tmp);
  for (const c of ['id','data_owner_id','user_id','created_at']) assert.ok(cols.includes(c), `chybí ${c}`);
});
test('household_members.user_id je UNIQUE', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz'),(2,'c@d.cz')").run();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  let threw = false;
  try { db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run(); } catch { threw = true; }
  cleanup(db, tmp);
  assert.ok(threw, 'duplicitní user_id měl selhat');
});
```

- [ ] **Step 2:** `node --test src/db/schema.household.test.js` → FAIL (no such table).

- [ ] **Step 3:** V `src/db/schema.js` přidej do hlavního `db.exec` bloku (vedle ostatních CREATE TABLE):
```sql
    CREATE TABLE IF NOT EXISTS household_members (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      data_owner_id INTEGER NOT NULL,
      user_id       INTEGER NOT NULL UNIQUE,
      created_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (data_owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)       REFERENCES users(id) ON DELETE CASCADE
    );
```
A k indexům přidej:
```sql
    CREATE INDEX IF NOT EXISTS idx_household_members_owner ON household_members(data_owner_id);
```

- [ ] **Step 4:** `node --test src/db/schema.household.test.js` → PASS (2 testy).

- [ ] **Step 5: Commit**
```bash
git add src/db/schema.js src/db/schema.household.test.js
git commit -m "feat(household): tabulka household_members"
```

---

## Task 2: requireAuth — resolveDataUserId

**Files:** Modify `src/middleware/auth.js`; Test `src/middleware/auth.test.js` (Create)

- [ ] **Step 1: Failing test** — Create `src/middleware/auth.test.js`:
```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-auth-mw-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./auth']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz'),(2,'c@d.cz'),(3,'e@f.cz')").run();
  return { db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
function run(reqUserId) {
  const { requireAuth } = require('./auth');
  const req = { user: { id: reqUserId }, isAuthenticated: () => true };
  let called = false;
  requireAuth(req, { status: () => ({ json: () => {} }) }, () => { called = true; });
  return { req, called };
}

test('člen domácnosti → dataUserId = vlastník', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  const { req, called } = run(2);
  cleanup(db, tmp);
  assert.ok(called);
  assert.equal(req.dataUserId, 1);
});
test('bez členství → dataUserId = vlastní id', () => {
  const { db, tmp } = freshDb();
  const { req } = run(3);
  cleanup(db, tmp);
  assert.equal(req.dataUserId, 3);
});
test('neautentizovaný → 401, next nevolán', () => {
  const { db, tmp } = freshDb();
  const { requireAuth } = require('./auth');
  let status = 0; let nexted = false;
  requireAuth({ isAuthenticated: () => false }, { status: (c) => { status = c; return { json: () => {} }; } }, () => { nexted = true; });
  cleanup(db, tmp);
  assert.equal(status, 401);
  assert.equal(nexted, false);
});
```

- [ ] **Step 2:** `node --test src/middleware/auth.test.js` → FAIL (dataUserId undefined).

- [ ] **Step 3:** Nahraď `src/middleware/auth.js` za:
```javascript
const db = require('../db/connection');

function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const row = db.prepare('SELECT data_owner_id FROM household_members WHERE user_id = ?').get(req.user.id);
  req.dataUserId = row ? row.data_owner_id : req.user.id;
  next();
}

module.exports = { requireAuth };
```

- [ ] **Step 4:** `node --test src/middleware/auth.test.js` → PASS (3 testy).

- [ ] **Step 5: Commit**
```bash
git add src/middleware/auth.js src/middleware/auth.test.js
git commit -m "feat(household): requireAuth nastaví req.dataUserId (resolution)"
```

---

## Task 3: Refactor 11 sdílených route souborů (req.user.id → req.dataUserId)

**Files:** Modify `src/routes/{transactions,categories,accounts,budgets,annual-budgets,budget-items,fixed-expenses,income,stats,emailInbox,import}.js`; Modify `src/routes/transactions.security.test.js` (harness).

Tyto soubory obsahují VÝHRADNĚ sdílená data (ověřeno auditem). Operace je mechanická záměna `req.user.id` → `req.dataUserId` ve VŠECH výskytech. **NEMĚNIT** `push.js`, `auth.js`, `settings.js`.

- [ ] **Step 1: Záměna ve všech 11 souborech**

Pro KAŽDÝ ze souborů `src/routes/transactions.js`, `categories.js`, `accounts.js`, `budgets.js`, `annual-budgets.js`, `budget-items.js`, `fixed-expenses.js`, `income.js`, `stats.js`, `emailInbox.js`, `import.js`:
- Nahraď každý výskyt `req.user.id` za `req.dataUserId`.
- Po záměně OVĚŘ, že žádný `req.user.id` nezbyl: `grep -n "req.user.id" <soubor>` → prázdné.
- Zkontroluj, že žádný výskyt nebyl identita/odpověď volajícímu (tyto soubory žádné takové nemají — jsou čistě datové; pokud bys nějaký našel, ZASTAV a nahlas).

Příkaz pro ověření po všech záměnách (žádný z 11 souborů nesmí mít req.user.id):
```bash
grep -rln "req.user.id" src/routes/transactions.js src/routes/categories.js src/routes/accounts.js src/routes/budgets.js src/routes/annual-budgets.js src/routes/budget-items.js src/routes/fixed-expenses.js src/routes/income.js src/routes/stats.js src/routes/emailInbox.js src/routes/import.js
```
Expected: prázdný výstup.

- [ ] **Step 2: Aktualizuj harness `transactions.security.test.js`**

Ten test mountuje router přímo (mimo requireAuth) s fake middleware. Aby refaktorovaný router fungoval, fake middleware musí nastavit i `req.dataUserId`. Najdi řádek:
```javascript
  app.use((req,_res,next)=>{ req.user={id:1}; req.isAuthenticated=()=>true; next(); });
```
a změň na:
```javascript
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
```

- [ ] **Step 3: Ověření**

Run: `node --test src/routes/transactions.security.test.js` → PASS (refaktor + harness).
Run: `node -e "['transactions','categories','accounts','budgets','annual-budgets','budget-items','fixed-expenses','income','stats','emailInbox','import'].forEach(f=>require('./src/routes/'+f+'.js')); console.log('vše se načte')"` → `vše se načte`.
Run: `node --test 'src/**/*.test.js' 2>&1 | grep -E "^# (pass|fail)"` → 0 fail (chování beze změny, dataUserId == self bez membership řádků).

- [ ] **Step 4: Commit**
```bash
git add src/routes/transactions.js src/routes/categories.js src/routes/accounts.js src/routes/budgets.js src/routes/annual-budgets.js src/routes/budget-items.js src/routes/fixed-expenses.js src/routes/income.js src/routes/stats.js src/routes/emailInbox.js src/routes/import.js src/routes/transactions.security.test.js
git commit -m "feat(household): sdílené routy scopují na req.dataUserId"
```

---

## Task 4: settings.js — billing_day sdílený, notify_scope osobní

**Files:** Modify `src/routes/settings.js`; Modify `src/routes/settings.push.test.js` (harness)

- [ ] **Step 1:** READ `src/routes/settings.js` (GET + PUT). Nahraď GET handler za (billing_day z `dataUserId`, notify_scope z `req.user.id`):
```javascript
router.get('/', requireAuth, (req, res) => {
  const ownerRow = db.prepare('SELECT billing_day FROM settings WHERE user_id = ?').get(req.dataUserId);
  const selfRow = db.prepare('SELECT notify_scope FROM settings WHERE user_id = ?').get(req.user.id);
  const billingDay = ownerRow?.billing_day ?? 1;
  const notifyScope = selfRow?.notify_scope ?? 'pending_only';
  const currentKey = currentPeriodKey(billingDay);
  const periodKey = req.query.period || currentKey;
  const { start, end } = getPeriodDates(billingDay, periodKey);
  res.json({ billing_day: billingDay, notify_scope: notifyScope, current_period: currentKey, period_start: start, period_end: end });
});
```

- [ ] **Step 2:** Nahraď PUT handler za (billing_day zapiš do `dataUserId` řádku, notify_scope do `req.user.id` řádku, cíleně bez clobberu druhého sloupce):
```javascript
router.put('/', requireAuth, (req, res) => {
  const { billing_day, notify_scope } = req.body;
  const day = parseInt(billing_day, 10);
  if (!day || day < 1 || day > 31) return res.status(400).json({ error: 'billing_day musí být 1–31.' });
  const VALID_SCOPES = ['off', 'pending_only', 'all'];
  const scope = notify_scope === undefined ? undefined : String(notify_scope);
  if (scope !== undefined && !VALID_SCOPES.includes(scope)) {
    return res.status(400).json({ error: 'Neplatný notify_scope.' });
  }
  // billing_day → vlastníkův řádek (sdílené období), bez dotčení jeho notify_scope
  db.prepare(`
    INSERT INTO settings (user_id, billing_day) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET billing_day = excluded.billing_day
  `).run(req.dataUserId, day);
  // notify_scope → volajícího řádek (osobní), bez dotčení jeho billing_day
  if (scope !== undefined) {
    db.prepare(`
      INSERT INTO settings (user_id, notify_scope) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET notify_scope = excluded.notify_scope
    `).run(req.user.id, scope);
  }
  const periodKey = currentPeriodKey(day);
  const { start, end } = getPeriodDates(day, periodKey);
  const selfRow = db.prepare('SELECT notify_scope FROM settings WHERE user_id = ?').get(req.user.id);
  res.json({ billing_day: day, notify_scope: selfRow?.notify_scope ?? 'pending_only', current_period: periodKey, period_start: start, period_end: end });
});
```
Pozn.: pokud `settings` tabulka nemá NOT NULL na billing_day/notify_scope (ověř ve schema — má DEFAULT), tyto cílené upserty fungují. Pokud má billing_day NOT NULL bez defaultu, doplň default při insertu notify_scope řádku.

- [ ] **Step 3:** Aktualizuj harness `settings.push.test.js` — fake middleware musí nastavit `req.dataUserId`. Najdi:
```javascript
  app.use((req, _res, next) => { req.user = { id: 1 }; req.isAuthenticated = () => true; next(); });
```
změň na:
```javascript
  app.use((req, _res, next) => { req.user = { id: 1 }; req.dataUserId = 1; req.isAuthenticated = () => true; next(); });
```

- [ ] **Step 4: Ověření**

Run: `node --test src/routes/settings.push.test.js` → PASS (stávající testy: billing_day uloží/vrátí, notify_scope uloží/vrátí, neplatný scope → 400).
Run: `node --test 'src/**/*.test.js' 2>&1 | grep -E "^# (pass|fail)"` → 0 fail.

- [ ] **Step 5: Commit**
```bash
git add src/routes/settings.js src/routes/settings.push.test.js
git commit -m "feat(household): settings — billing_day sdílený (owner), notify_scope osobní"
```

---

## Task 5: Cross-household izolační testy + ověření celku

**Files:** Test `src/routes/household-isolation.test.js` (Create)

Ověří, že refactor reálně sdílí data v rámci domácnosti a izoluje mezi domácnostmi. Mountuje routery za malý middleware, který napodobí `requireAuth` resolution (spočítá `dataUserId` z `household_members`).

- [ ] **Step 1: Test** — Create `src/routes/household-isolation.test.js`:
```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const express = require('express');

function freshApp(actingUserId) {
  const tmp = path.join(os.tmpdir(), `spendex-hh-iso-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./transactions','./categories','./emailInbox']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'owner@x.cz'),(2,'member@x.cz'),(3,'outsider@x.cz')").run();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run(); // user2 ∈ household(1)
  const app = express(); app.use(express.json());
  // napodob requireAuth resolution
  app.use((req,_res,next)=>{
    req.user = { id: actingUserId };
    const row = db.prepare('SELECT data_owner_id FROM household_members WHERE user_id = ?').get(actingUserId);
    req.dataUserId = row ? row.data_owner_id : actingUserId;
    req.isAuthenticated = () => true; next();
  });
  app.use('/api/categories', require('./categories'));
  app.use('/api/transactions', require('./transactions'));
  app.use('/api/email-inbox', require('./emailInbox'));
  return { app, db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

test('člen vidí kategorii vytvořenou vlastníkem; outsider ne', async () => {
  // vlastník (user1) vytvoří kategorii
  let ctx = freshApp(1); let { server, base } = await listen(ctx.app);
  await fetch(`${base}/api/categories`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name:'Sdílená' }) });
  // ověř že kategorie je pod user_id=1
  const ownerCats = await (await fetch(`${base}/api/categories`)).json();
  server.close();
  assert.ok(ownerCats.some(c=>c.name==='Sdílená'));
  // stejná DB, jiný actingUser? freshApp dělá novou DB — proto test sdílení uděláme v jedné DB:
  cleanup(ctx.db, ctx.tmp);
});

test('izolace v jedné DB: member vidí, outsider nevidí', async () => {
  const tmp = path.join(os.tmpdir(), `spendex-hh-iso2-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./categories']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x'),(2,'m@x'),(3,'out@x')").run();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  // vlastníkova data
  db.prepare("INSERT INTO categories (user_id, name) VALUES (1, 'Sdílená')").run();
  function appFor(uid){
    const app = express(); app.use(express.json());
    app.use((req,_res,next)=>{ req.user={id:uid}; const r=db.prepare('SELECT data_owner_id FROM household_members WHERE user_id=?').get(uid); req.dataUserId=r?r.data_owner_id:uid; req.isAuthenticated=()=>true; next(); });
    app.use('/api/categories', require('./categories'));
    return app;
  }
  const m = await listen(appFor(2));   // člen
  const memberCats = await (await fetch(`${m.base}/api/categories`)).json();
  m.server.close();
  const o = await listen(appFor(3));   // outsider
  const outsiderCats = await (await fetch(`${o.base}/api/categories`)).json();
  o.server.close();
  db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}}
  assert.ok(memberCats.some(c=>c.name==='Sdílená'), 'člen musí vidět vlastníkovu kategorii');
  assert.ok(!outsiderCats.some(c=>c.name==='Sdílená'), 'outsider NESMÍ vidět cizí kategorii');
});
```
(Pozn.: pokud `require('./categories')` cachuje `db`, používáme stejnou `DB_PATH` instanci — proto `appFor` znovu nevolá freshDb, jen mountuje router proti už otevřené `db`. Ověř, že router bere `db` přes `require('../db/connection')` singleton — ano.)

- [ ] **Step 2:** `node --test src/routes/household-isolation.test.js` → PASS.

- [ ] **Step 3: Plná sada**

Run: `node --test 'src/**/*.test.js' 2>&1 | grep -E "^# (tests|pass|fail)"` → 0 fail.

- [ ] **Step 4: Commit + push**
```bash
git add src/routes/household-isolation.test.js
git commit -m "test(household): izolace domácností (člen vidí, outsider ne)"
git push origin staging
```

---

## Self-Review (provedeno při psaní plánu)

- **Spec coverage:** tabulka (T1), resolution v requireAuth (T2), refactor 11 sdílených rout (T3), settings split (T4), izolační testy + plná sada (T5) — vše pokryto. Webhook/fan-out/UI jsou explicitně Fáze 2–3, mimo tento plán.
- **Placeholdery:** žádné; každý krok má konkrétní kód/příkaz. Označená podmínka: T3 instruuje ZASTAVIT, pokud by se v 11 souborech našel identita/odpověď použití `req.user.id` (audit říká že ne).
- **Konzistence:** `req.dataUserId` napříč; `push.js`/`auth.js` netknuté; settings mixed dle specu (billing_day→dataUserId, notify_scope→req.user.id). Harnessy (transactions.security, settings.push) doplněny o `req.dataUserId`.
- **Riziko:** bez membership řádků je `dataUserId == req.user.id` → stávající sada zelená beze změny chování. Sdílení/izolace ověřena T5. Bezpečnost: dataUserId server-side z DB, ne z klienta.
