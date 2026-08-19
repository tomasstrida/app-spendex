# Automatické zařazení opakujících se plateb podle protiúčtu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rozpoznat opakující se platby podle čísla protiúčtu (kde text popisu není stabilní, např. „DPH 2026/07"), nabídnout uživateli založení pravidla ke schválení, a po schválení nechat budoucí platby na stejný protiúčet zařazovat automaticky bez zásahu do review fronty.

**Architecture:** Rozšíření stávající textové kategorizační vrstvy (`category_rules` / `apply-rules.js`) o matchování podle `counterparty_account`, doplněné statistickým candidate-finderem (coverage+purity nad historií, stejný princip jako offline `suggest-rules-from-history.cjs`, ale klíčovaný přes protiúčet). Návrhy se ukládají do nové tabulky `rule_suggestions` a nabízí se ze dvou míst — reaktivně po ručním zařazení v review frontě a dávkově na stránce Pravidla.

**Tech Stack:** Node.js + Express, better-sqlite3, React (Vite), `node --test`.

## Global Constraints

- Migrace do `initSchema()` v `src/db/schema.js`, `ALTER TABLE`/`CREATE TABLE IF NOT EXISTS` v try/catch bloku (existující vzor, žádný migrační framework).
- Identita čísla účtu = kompletní `[předčíslí-]číslo/kódbanky`, jen mezery se ořezávají (`normalizeAccount`), exact match — nikdy prefix/substring.
- Coverage práh ≥ 3 historické transakce, purity práh ≥ 90 % — stejné výchozí hodnoty jako `scripts/suggest-rules-from-history.cjs`.
- Notifikace po auto-zařazení podle nového pravidla beze změny respektuje stávající `settings.notify_scope` (žádná speciální výjimka).
- Žádné re-navrhování po zamítnutí (`rule_suggestions.status = 'dismissed'` je trvalé).
- Testy přes `node --test 'src/**/*.test.js'` (ne `src/` samotné — visí, viz existující gotcha).

---

## File Structure

Nové soubory:
- `src/utils/normalize-account.js` — sdílená normalizace čísla účtu (extrakce z `apply-rules.js`)
- `src/utils/counterparty-rule-candidates.js` — čistá funkce: scoring kandidátů (coverage/purity) nad historií transakcí
- `src/services/ruleSuggestions.js` — perzistence `rule_suggestions` (upsert/get/list)

Upravené soubory:
- `src/db/schema.js` — nové sloupce `category_rules.match_counterparty_account`/`match_account_id` + tabulka `rule_suggestions`
- `src/utils/apply-rules.js` — matchování podle protiúčtu vedle textu
- `src/utils/load-user-rules.js` — načtení nových sloupců
- `src/services/emailIngest.js` — `categorize()` předá `account.id` do `applyRules`
- `src/routes/emailInbox.js` — `/approve` po zařazení spustí detekci a vrátí `newSuggestion`
- `src/routes/rules.js` — nové endpointy `GET/POST /suggestions*`
- `client/src/pages/RulesPage.jsx` — sekce „Návrhy pravidel"
- `client/src/pages/ImportPage.jsx` — inline banner po schválení review položky

---

### Task 1: Sdílená normalizace čísla účtu

**Files:**
- Create: `src/utils/normalize-account.js`
- Modify: `src/utils/apply-rules.js`
- Test: `src/utils/apply-rules.test.js` (musí projít beze změny — čistý refaktor)

**Interfaces:**
- Produces: `normalizeAccount(raw: string|null|undefined): string` — exportovaná default funkce, používá ji Task 4 i Task 5.

- [ ] **Step 1: Vytvoř `src/utils/normalize-account.js`**

```js
'use strict';
// Identita účtu = kompletní číslo [předčíslí-]číslo/kódbanky; ořezávají se jen mezery.
function normalizeAccount(raw) {
  if (!raw) return '';
  return String(raw).replace(/\s/g, '');
}
module.exports = normalizeAccount;
```

- [ ] **Step 2: Uprav `src/utils/apply-rules.js`, ať používá sdílenou funkci**

Nahraď lokální definici `normalizeAccount` (řádky 5-9) importem:

```js
'use strict';
// Čistá funkce: (tx, account, rules) → { category, subcategory_id }.
// Precedence: L0 Převody → L3 text/protiúčet → L1 účet → L2 AB → fallback.
const normalizeAccount = require('./normalize-account');

function applyRules(tx, account, rules) {
  // L0 – interní převod
  const cp = normalizeAccount(tx.counterparty_account);
  if (cp && rules.ownAccountNumbers.includes(cp)) {
    return { category: rules.internalTransferCategory, subcategory_id: null };
  }

  // L3 – text override (popis + note, case-insensitive substring).
  // Volitelné amount_max_abs / amount_min_abs zužují match podle absolutní částky
  // (užitečné pro „benzinky < 200 Kč = občerstvení, ne PHM" apod.).
  const hay = `${tx.description || ''} ${tx.note || ''} ${tx.place || ''}`.toLowerCase();
  const absAmount = Math.abs(tx.amount);
  for (const o of rules.textOverrides) {
    if (!hay.includes(o.pattern.toLowerCase())) continue;
    if (o.amount_max_abs != null && absAmount > o.amount_max_abs) continue;
    if (o.amount_min_abs != null && absAmount < o.amount_min_abs) continue;
    return { category: o.category, subcategory_id: o.subcategory_id ?? null };
  }

  // L1 – účetní pravidlo
  if (account && rules.accountRules[account.account_number]) {
    return { category: rules.accountRules[account.account_number], subcategory_id: null };
  }

  // L2 – AB kategorie
  const ab = (tx.ab_category || '').trim();
  if (rules.abCategoryMap[ab]) return { category: rules.abCategoryMap[ab], subcategory_id: null };

  // fallback
  return { category: rules.fallbackCategory, subcategory_id: null };
}

module.exports = applyRules;
```

(Tohle je mezikrok — funkčně identické chování jako dnes, jen sdílená normalizace. Matchování podle protiúčtu přidává Task 4.)

- [ ] **Step 3: Spusť existující testy, ověř že nic nespadlo**

Run: `node --test src/utils/apply-rules.test.js`
Expected: všech 17 testů PASS beze změny.

- [ ] **Step 4: Commit**

```bash
git add src/utils/normalize-account.js src/utils/apply-rules.js
git commit -m "refactor: sdilena normalizace cisla uctu (normalize-account.js)"
```

---

### Task 2: Schema — nové sloupce a tabulka rule_suggestions

**Files:**
- Modify: `src/db/schema.js` (migrations pole, cca řádek 309-417)
- Test: `src/db/schema.test.js`

**Interfaces:**
- Produces: sloupce `category_rules.match_counterparty_account TEXT`, `category_rules.match_account_id INTEGER`; tabulka `rule_suggestions(id, user_id, counterparty_account, category_id, subcategory_id, coverage_count, purity, status, created_at, resolved_at)` s `UNIQUE(user_id, counterparty_account)`. Používá Task 5 (candidate finder), Task 3 (ruleSuggestions service), Task 6 (routes).

- [ ] **Step 1: Napiš test na nové sloupce a tabulku**

Přidej do `src/db/schema.test.js` (za poslední test v souboru):

```js
test('migrace: category_rules má match_counterparty_account + match_account_id', () => {
  const tmp = path.join(os.tmpdir(), `spendex-crmatch-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  const { initSchema } = require('../db/schema');
  initSchema();
  const cols = db.prepare("PRAGMA table_info(category_rules)").all().map(c => c.name);
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.ok(cols.includes('match_counterparty_account'), `chybí match_counterparty_account; má: ${cols.join(',')}`);
  assert.ok(cols.includes('match_account_id'), `chybí match_account_id; má: ${cols.join(',')}`);
});

test('migrace vytvoří tabulku rule_suggestions s UNIQUE(user_id, counterparty_account)', () => {
  const tmp = path.join(os.tmpdir(), `spendex-rulesugg-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  const { initSchema } = require('../db/schema');
  initSchema();
  const cols = db.prepare("PRAGMA table_info(rule_suggestions)").all().map(c => c.name);
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (5,1,'Ostatní')").run();
  db.prepare(`INSERT INTO rule_suggestions (user_id, counterparty_account, category_id, coverage_count, purity)
              VALUES (1, '705-77628031/0710', 5, 3, 1.0)`).run();
  let threw = false;
  try {
    db.prepare(`INSERT INTO rule_suggestions (user_id, counterparty_account, category_id, coverage_count, purity)
                VALUES (1, '705-77628031/0710', 5, 4, 1.0)`).run();
  } catch { threw = true; }
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.deepEqual(
    cols.sort(),
    ['category_id', 'coverage_count', 'created_at', 'counterparty_account', 'id', 'purity',
     'resolved_at', 'status', 'subcategory_id', 'user_id'].sort()
  );
  assert.ok(threw, 'druhý INSERT se stejným (user_id, counterparty_account) měl selhat na UNIQUE');
});
```

- [ ] **Step 2: Spusť testy, ověř že selhávají (sloupce/tabulka ještě neexistují)**

Run: `node --test src/db/schema.test.js`
Expected: FAIL — `no such column: match_counterparty_account` / `no such table: rule_suggestions`.

- [ ] **Step 3: Přidej migrace do `src/db/schema.js`**

Do pole `migrations` (za poslední položku `'CREATE INDEX IF NOT EXISTS idx_apple_receipt_account ...'`, před uzavírací `];` na řádku 418), přidej:

```js
    // Rozšíření category_rules o matchování podle protiúčtu (vedle textového patternu).
    // match_counterparty_account NULL = pravidlo matchuje jen textem jako dnes.
    // match_account_id NULL = bez omezení na konkrétní vlastní účet.
    'ALTER TABLE category_rules ADD COLUMN match_counterparty_account TEXT',
    'ALTER TABLE category_rules ADD COLUMN match_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL',
    // Návrhy pravidel podle opakujícího se protiúčtu (candidate finder je v
    // src/utils/counterparty-rule-candidates.js). UNIQUE brání duplicitním
    // návrhům pro stejný protiúčet napříč reaktivním i dávkovým triggerem.
    `CREATE TABLE IF NOT EXISTS rule_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      counterparty_account TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      subcategory_id INTEGER,
      coverage_count INTEGER NOT NULL,
      purity REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
      FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE SET NULL,
      UNIQUE(user_id, counterparty_account)
    )`,
```

- [ ] **Step 4: Spusť testy znovu, ověř PASS**

Run: `node --test src/db/schema.test.js`
Expected: všechny testy PASS.

- [ ] **Step 5: Spusť celou backend sadu pro jistotu, že migrace nerozbila nic jiného**

Run: `node --test 'src/**/*.test.js'`
Expected: PASS (stejný počet jako před změnou + 2 nové).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.js src/db/schema.test.js
git commit -m "feat(db): category_rules protiucet + tabulka rule_suggestions"
```

---

### Task 3: `load-user-rules.js` — načtení nových sloupců

**Files:**
- Modify: `src/utils/load-user-rules.js`
- Test: `src/utils/load-user-rules.test.js`

**Interfaces:**
- Consumes: sloupce `category_rules.match_counterparty_account`/`match_account_id` z Task 2.
- Produces: `loadUserRules(db, userId)` vrací objekty s volitelnými klíči `match_counterparty_account`, `match_account_id` (jen když nejsou `NULL`) — konzumuje Task 4 (`apply-rules.js`).

- [ ] **Step 1: Napiš test**

Přidej do `src/utils/load-user-rules.test.js`:

```js
test('loadUserRules: pravidlo s match_counterparty_account/match_account_id se propíše do výstupu', () => {
  const db = freshDb();
  const loadUserRules = require('./load-user-rules');
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (20, 1, 'Y_Uctovani')").run();
  db.prepare("INSERT INTO accounts (id, user_id, account_number, name) VALUES (7, 1, '1679014031/3030', 'Tom-OSVC')").run();
  db.prepare(`INSERT INTO category_rules (id, user_id, category_id, pattern, match_counterparty_account, match_account_id)
              VALUES (3, 1, 20, '', '705-77628031/0710', 7)`).run();

  const out = loadUserRules(db, 1);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    pattern: '', category: 'Y_Uctovani',
    match_counterparty_account: '705-77628031/0710', match_account_id: 7,
  });
});
```

- [ ] **Step 2: Spusť test, ověř FAIL**

Run: `node --test src/utils/load-user-rules.test.js`
Expected: FAIL — `out[0]` nemá `match_counterparty_account`/`match_account_id`.

- [ ] **Step 3: Uprav `src/utils/load-user-rules.js`**

```js
'use strict';
// Načte textová/protiúčtová kategorizační pravidla uživatele z DB ve tvaru, který
// očekává applyRules v `rules.textOverrides`. Pravidla s podmínkou na částku jdou
// první (specifičtější výjimky jako „benzinky < 200"), pak podle pořadí vložení.
function loadUserRules(db, userId) {
  const rows = db.prepare(`
    SELECT r.pattern, r.amount_max_abs, r.amount_min_abs, r.subcategory_id,
           r.match_counterparty_account, r.match_account_id, c.name AS category
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
    if (r.match_counterparty_account != null) o.match_counterparty_account = r.match_counterparty_account;
    if (r.match_account_id != null) o.match_account_id = r.match_account_id;
    return o;
  });
}
module.exports = loadUserRules;
```

- [ ] **Step 4: Spusť testy, ověř PASS (vč. obou existujících testů)**

Run: `node --test src/utils/load-user-rules.test.js`
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/load-user-rules.js src/utils/load-user-rules.test.js
git commit -m "feat: load-user-rules nacte match_counterparty_account/match_account_id"
```

---

### Task 4: `apply-rules.js` — matchování podle protiúčtu + `emailIngest.js` předá account.id

**Files:**
- Modify: `src/utils/apply-rules.js`
- Modify: `src/services/emailIngest.js:42` (volání `applyRules` v `categorize()`)
- Test: `src/utils/apply-rules.test.js`

**Interfaces:**
- Consumes: `normalizeAccount` z Task 1, tvar pravidel z Task 3 (`match_counterparty_account`, `match_account_id`).
- Produces: `applyRules(tx, account, rules)` kde `account` může nést `{ id, account_number }` (dřív jen `account_number`) — konzumují Task 5/6/7 nepřímo přes `categorize()`.

- [ ] **Step 1: Napiš testy**

Přidej do `src/utils/apply-rules.test.js`:

```js
test('L3 protiúčet: pravidlo s match_counterparty_account matchne přesné číslo', () => {
  const r = {
    ownAccountNumbers: [], internalTransferCategory: 'Převody',
    textOverrides: [{ pattern: '', category: 'Y_Uctovani', match_counterparty_account: '705-77628031/0710' }],
    accountRules: {}, abCategoryMap: {}, fallbackCategory: 'Ostatní',
  };
  const tx = { description: 'DPH 2026/08', note: '', counterparty_account: '705-77628031/0710', amount: -5000 };
  assert.equal(applyRules(tx, null, r).category, 'Y_Uctovani');
});

test('L3 protiúčet: jiné číslo protiúčtu nematchne, padá na fallback', () => {
  const r = {
    ownAccountNumbers: [], internalTransferCategory: 'Převody',
    textOverrides: [{ pattern: '', category: 'Y_Uctovani', match_counterparty_account: '705-77628031/0710' }],
    accountRules: {}, abCategoryMap: {}, fallbackCategory: 'Ostatní',
  };
  const tx = { description: 'DPH 2026/08', note: '', counterparty_account: 'JINY999/0100', amount: -5000 };
  assert.equal(applyRules(tx, null, r).category, 'Ostatní');
});

test('L3 protiúčet: mezery v protiúčtu se normalizují stejně jako v L0', () => {
  const r = {
    ownAccountNumbers: [], internalTransferCategory: 'Převody',
    textOverrides: [{ pattern: '', category: 'Y_Uctovani', match_counterparty_account: '705-77628031/0710' }],
    accountRules: {}, abCategoryMap: {}, fallbackCategory: 'Ostatní',
  };
  const tx = { description: '', note: '', counterparty_account: ' 705-77628031 / 0710 ', amount: -100 };
  assert.equal(applyRules(tx, null, r).category, 'Y_Uctovani');
});

test('L3 protiúčet + pattern zároveň = AND (obě podmínky musí sedět)', () => {
  const r = {
    ownAccountNumbers: [], internalTransferCategory: 'Převody',
    textOverrides: [{ pattern: 'DPH', category: 'Y_Uctovani', match_counterparty_account: '705-77628031/0710' }],
    accountRules: {}, abCategoryMap: {}, fallbackCategory: 'Ostatní',
  };
  const okTx = { description: 'DPH 2026/08', note: '', counterparty_account: '705-77628031/0710', amount: -100 };
  assert.equal(applyRules(okTx, null, r).category, 'Y_Uctovani');
  const wrongText = { description: 'Něco jiného', note: '', counterparty_account: '705-77628031/0710', amount: -100 };
  assert.equal(applyRules(wrongText, null, r).category, 'Ostatní');
});

test('L3 protiúčet: match_account_id omezí pravidlo jen na konkrétní vlastní účet', () => {
  const r = {
    ownAccountNumbers: [], internalTransferCategory: 'Převody',
    textOverrides: [{ pattern: '', category: 'Y_Uctovani', match_counterparty_account: 'EXT/0100', match_account_id: 7 }],
    accountRules: {}, abCategoryMap: {}, fallbackCategory: 'Ostatní',
  };
  const tx = { description: '', note: '', counterparty_account: 'EXT/0100', amount: -100 };
  assert.equal(applyRules(tx, { id: 7, account_number: 'x' }, r).category, 'Y_Uctovani');
  assert.equal(applyRules(tx, { id: 8, account_number: 'x' }, r).category, 'Ostatní');
  assert.equal(applyRules(tx, null, r).category, 'Ostatní');
});

test('pravidlo bez patternu i bez match_counterparty_account nikdy nesedí (obranná pojistka)', () => {
  const r = {
    ownAccountNumbers: [], internalTransferCategory: 'Převody',
    textOverrides: [{ pattern: '', category: 'X' }],
    accountRules: {}, abCategoryMap: {}, fallbackCategory: 'Ostatní',
  };
  const tx = { description: 'cokoliv', note: '', counterparty_account: 'EXT/0100', amount: -100 };
  assert.equal(applyRules(tx, null, r).category, 'Ostatní');
});
```

- [ ] **Step 2: Spusť testy, ověř FAIL**

Run: `node --test src/utils/apply-rules.test.js`
Expected: FAIL — nová pole se dnes ignorují, pravidlo bez `pattern` (`''`) dnes projde přes `hay.includes('')` (vždy true) a vrátí špatnou kategorii pro první čtyři nové testy i pro test s obrannou pojistkou.

- [ ] **Step 3: Uprav `src/utils/apply-rules.js` — L3 smyčka**

Nahraď L3 blok (mezi L0 a L1) za:

```js
  // L3 – text override a/nebo protiúčet (kombinovatelné = AND, když jsou obě).
  // Pravidlo bez patternu (prázdný string – counterparty-only) přeskočí textovou
  // podmínku; pravidlo bez match_counterparty_account přeskočí kontrolu protiúčtu.
  // Volitelné amount_max_abs / amount_min_abs zužují match podle absolutní částky.
  const hay = `${tx.description || ''} ${tx.note || ''} ${tx.place || ''}`.toLowerCase();
  const absAmount = Math.abs(tx.amount);
  for (const o of rules.textOverrides) {
    const hasText = !!o.pattern;
    const hasCounterparty = !!o.match_counterparty_account;
    if (!hasText && !hasCounterparty) continue; // pravidlo bez podmínky nikdy nesedí
    if (hasText && !hay.includes(o.pattern.toLowerCase())) continue;
    if (hasCounterparty && cp !== normalizeAccount(o.match_counterparty_account)) continue;
    if (o.match_account_id != null && (!account || account.id !== o.match_account_id)) continue;
    if (o.amount_max_abs != null && absAmount > o.amount_max_abs) continue;
    if (o.amount_min_abs != null && absAmount < o.amount_min_abs) continue;
    return { category: o.category, subcategory_id: o.subcategory_id ?? null };
  }
```

(`cp` je už spočítané výš v L0 bloku — beze změny.)

- [ ] **Step 4: Uprav `src/services/emailIngest.js:42` — předej `account.id`**

Najdi řádek:

```js
  const { category: catName, subcategory_id } = applyRules(tx, account ? { account_number: account.account_number } : null, rules);
```

Nahraď za:

```js
  const { category: catName, subcategory_id } = applyRules(tx, account ? { id: account.id, account_number: account.account_number } : null, rules);
```

- [ ] **Step 5: Spusť testy, ověř PASS**

Run: `node --test src/utils/apply-rules.test.js`
Expected: 23/23 PASS (17 původních + 6 nových).

- [ ] **Step 6: Spusť celou backend sadu**

Run: `node --test 'src/**/*.test.js'`
Expected: PASS (ověří, že úprava `emailIngest.js:42` nic nerozbila — `emailIngest` nemá vlastní `.test.js`, ale je pokrytý přes `routes/emailInbox.test.js` a routy importu).

- [ ] **Step 7: Commit**

```bash
git add src/utils/apply-rules.js src/utils/apply-rules.test.js src/services/emailIngest.js
git commit -m "feat: applyRules matchuje i podle protiuctu (match_counterparty_account/match_account_id)"
```

---

### Task 5: `counterparty-rule-candidates.js` — candidate finder

**Files:**
- Create: `src/utils/counterparty-rule-candidates.js`
- Test: `src/utils/counterparty-rule-candidates.test.js`

**Interfaces:**
- Consumes: `normalizeAccount` z Task 1; tabulky `transactions`, `accounts`, `category_rules.match_counterparty_account`, `rule_suggestions.status` z Task 2.
- Produces: `findCounterpartyRuleCandidates(db, userId, opts?): Array<{counterparty_account, category_id, subcategory_id, coverage_count, purity}>` — konzumuje Task 6 (`ruleSuggestions.js`), Task 7 (routes), Task 8 (emailInbox approve).

- [ ] **Step 1: Napiš testy**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-crc-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection', '../db/schema']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return db;
}

function seedBase(db) {
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (10, 1, 'Y_Uctovani'), (11, 1, 'Ostatni')").run();
  db.prepare("INSERT INTO accounts (id, user_id, account_number, name) VALUES (1, 1, '1679014031/3030', 'Tom-OSVC')").run();
}

test('najde kandidáta s coverage>=3 a purity>=90%', () => {
  const db = seedAndReturn();
  function seedAndReturn() { const d = freshDb(); seedBase(d); return d; }
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
                VALUES (1, 10, -5000, '2026-0${i + 1}-15', 'DPH', '705-77628031/0710')`).run();
  }
  const out = findCounterpartyRuleCandidates(db, 1);
  assert.equal(out.length, 1);
  assert.equal(out[0].counterparty_account, '705-77628031/0710');
  assert.equal(out[0].category_id, 10);
  assert.equal(out[0].coverage_count, 3);
  assert.equal(out[0].purity, 1);
});

test('coverage < 3 se nenabízí', () => {
  const db = freshDb(); seedBase(db);
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  for (let i = 0; i < 2; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
                VALUES (1, 10, -5000, '2026-0${i + 1}-15', 'DPH', '705-77628031/0710')`).run();
  }
  assert.equal(findCounterpartyRuleCandidates(db, 1).length, 0);
});

test('purity < 90% (nekonzistentní kategorizace) se nenabízí — zz-Hromadné akce scénář', () => {
  const db = freshDb(); seedBase(db);
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
              VALUES (1, 10, -100, '2026-01-01', 'A', 'ZZ/0100'), (1, 10, -100, '2026-02-01', 'B', 'ZZ/0100'),
                     (1, 11, -100, '2026-03-01', 'C', 'ZZ/0100')`).run();
  assert.equal(findCounterpartyRuleCandidates(db, 1).length, 0); // purity 2/3 = 66% < 90%
});

test('vlastní účet (L0 převod) se vynechá', () => {
  const db = freshDb(); seedBase(db);
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
                VALUES (1, 10, -100, '2026-0${i + 1}-01', 'X', '1679014031/3030')`).run();
  }
  assert.equal(findCounterpartyRuleCandidates(db, 1).length, 0);
});

test('protiúčet s existujícím pravidlem se vynechá', () => {
  const db = freshDb(); seedBase(db);
  db.prepare(`INSERT INTO category_rules (user_id, category_id, pattern, match_counterparty_account)
              VALUES (1, 10, '', '705-77628031/0710')`).run();
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
                VALUES (1, 10, -100, '2026-0${i + 1}-01', 'DPH', '705-77628031/0710')`).run();
  }
  assert.equal(findCounterpartyRuleCandidates(db, 1).length, 0);
});

test('protiúčet s dismissed návrhem se nenabízí znovu', () => {
  const db = freshDb(); seedBase(db);
  db.prepare(`INSERT INTO rule_suggestions (user_id, counterparty_account, category_id, coverage_count, purity, status)
              VALUES (1, '705-77628031/0710', 10, 3, 1.0, 'dismissed')`).run();
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
                VALUES (1, 10, -100, '2026-0${i + 1}-01', 'DPH', '705-77628031/0710')`).run();
  }
  assert.equal(findCounterpartyRuleCandidates(db, 1).length, 0);
});

test('onlyCounterpartyAccount omezí scan na jeden protiúčet', () => {
  const db = freshDb(); seedBase(db);
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
                VALUES (1, 10, -100, '2026-0${i + 1}-01', 'A', 'AAA/0100'), (1, 10, -100, '2026-0${i + 1}-02', 'B', 'BBB/0100')`).run();
  }
  const out = findCounterpartyRuleCandidates(db, 1, { onlyCounterpartyAccount: 'AAA/0100' });
  assert.equal(out.length, 1);
  assert.equal(out[0].counterparty_account, 'AAA/0100');
});

test('dominantní subcategory_id se dopočítá z transakcí v topCat', () => {
  const db = freshDb(); seedBase(db);
  db.prepare("INSERT INTO subcategories (id, user_id, category_id, name) VALUES (1, 1, 10, 'Sub A')").run();
  const { findCounterpartyRuleCandidates } = require('./counterparty-rule-candidates');
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, subcategory_id, amount, date, description, counterparty_account)
                VALUES (1, 10, 1, -100, '2026-0${i + 1}-01', 'DPH', '705-77628031/0710')`).run();
  }
  const out = findCounterpartyRuleCandidates(db, 1);
  assert.equal(out[0].subcategory_id, 1);
});
```

- [ ] **Step 2: Spusť test, ověř FAIL**

Run: `node --test src/utils/counterparty-rule-candidates.test.js`
Expected: FAIL — `Cannot find module './counterparty-rule-candidates'`.

- [ ] **Step 3: Vytvoř `src/utils/counterparty-rule-candidates.js`**

```js
'use strict';
// Detekce kandidátů na pravidlo podle PROTIÚČTU (ne textu) — stejný princip jako
// scripts/suggest-rules-from-history.cjs (coverage + purity), ale klíčováno přes
// counterparty_account. Používá se reaktivně (jeden protiúčet po ručním approve)
// i dávkově (celá historie ze stránky Pravidla).
const normalizeAccount = require('./normalize-account');

const MIN_COVERAGE = 3;
const MIN_PURITY = 0.90;

function findCounterpartyRuleCandidates(db, userId, { onlyCounterpartyAccount } = {}) {
  const cpFilter = onlyCounterpartyAccount ? normalizeAccount(onlyCounterpartyAccount) : null;
  const rows = db.prepare(`
    SELECT counterparty_account, category_id, subcategory_id
    FROM transactions
    WHERE user_id = @userId AND category_id IS NOT NULL
      AND counterparty_account IS NOT NULL AND counterparty_account != ''
      ${cpFilter ? 'AND counterparty_account = @cp' : ''}
  `).all({ userId, cp: cpFilter });

  const ownAccounts = new Set(
    db.prepare('SELECT account_number FROM accounts WHERE user_id = ?').all(userId)
      .map(a => normalizeAccount(a.account_number)).filter(Boolean)
  );
  const existingRuleAccounts = new Set(
    db.prepare(`SELECT match_counterparty_account FROM category_rules
                WHERE user_id = ? AND match_counterparty_account IS NOT NULL`).all(userId)
      .map(r => normalizeAccount(r.match_counterparty_account))
  );
  const resolvedAccounts = new Set(
    db.prepare(`SELECT counterparty_account FROM rule_suggestions
                WHERE user_id = ? AND status IN ('approved', 'dismissed')`).all(userId)
      .map(r => normalizeAccount(r.counterparty_account))
  );

  const groups = new Map(); // normalizovaný protiúčet -> pole řádků
  for (const r of rows) {
    const cp = normalizeAccount(r.counterparty_account);
    if (!groups.has(cp)) groups.set(cp, []);
    groups.get(cp).push(r);
  }

  const candidates = [];
  for (const [cp, list] of groups) {
    if (ownAccounts.has(cp) || existingRuleAccounts.has(cp) || resolvedAccounts.has(cp)) continue;
    const total = list.length;
    if (total < MIN_COVERAGE) continue;

    const catCounts = new Map();
    for (const r of list) catCounts.set(r.category_id, (catCounts.get(r.category_id) || 0) + 1);
    let topCat = null, topN = 0;
    for (const [catId, n] of catCounts) if (n > topN) { topN = n; topCat = catId; }
    const purity = topN / total;
    if (purity < MIN_PURITY) continue;

    const subCounts = new Map();
    for (const r of list) {
      if (r.category_id !== topCat || r.subcategory_id == null) continue;
      subCounts.set(r.subcategory_id, (subCounts.get(r.subcategory_id) || 0) + 1);
    }
    let topSub = null, topSubN = 0;
    for (const [subId, n] of subCounts) if (n > topSubN) { topSubN = n; topSub = subId; }

    candidates.push({
      counterparty_account: cp,
      category_id: topCat,
      subcategory_id: topSub,
      coverage_count: total,
      purity,
    });
  }
  return candidates;
}

module.exports = { findCounterpartyRuleCandidates, MIN_COVERAGE, MIN_PURITY };
```

- [ ] **Step 4: Spusť testy, ověř PASS**

Run: `node --test src/utils/counterparty-rule-candidates.test.js`
Expected: 8/8 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/counterparty-rule-candidates.js src/utils/counterparty-rule-candidates.test.js
git commit -m "feat: candidate finder pro navrhy pravidel podle protiuctu"
```

---

### Task 6: `ruleSuggestions.js` — perzistence návrhů

**Files:**
- Create: `src/services/ruleSuggestions.js`
- Test: `src/services/ruleSuggestions.test.js`

**Interfaces:**
- Consumes: kandidáty ve tvaru z Task 5.
- Produces: `upsertRuleSuggestions(db, userId, candidates): number[]` (ID pending návrhů), `getSuggestion(db, userId, id): row|undefined`, `listPendingSuggestions(db, userId): row[]` — konzumuje Task 7 (routes), Task 8 (emailInbox approve).

- [ ] **Step 1: Napiš testy**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-rs-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection', '../db/schema']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (10, 1, 'Y_Uctovani')").run();
  return db;
}

test('upsertRuleSuggestions: vytvoří nový pending návrh', () => {
  const db = freshDb();
  const { upsertRuleSuggestions, listPendingSuggestions } = require('./ruleSuggestions');
  const ids = upsertRuleSuggestions(db, 1, [
    { counterparty_account: '705-77628031/0710', category_id: 10, subcategory_id: null, coverage_count: 3, purity: 1 },
  ]);
  assert.equal(ids.length, 1);
  const list = listPendingSuggestions(db, 1);
  assert.equal(list.length, 1);
  assert.equal(list[0].category_name, 'Y_Uctovani');
  assert.equal(list[0].coverage_count, 3);
});

test('upsertRuleSuggestions: opakovaný scan aktualizuje existující pending řádek (ne duplicitu)', () => {
  const db = freshDb();
  const { upsertRuleSuggestions, listPendingSuggestions } = require('./ruleSuggestions');
  upsertRuleSuggestions(db, 1, [
    { counterparty_account: '705-77628031/0710', category_id: 10, subcategory_id: null, coverage_count: 3, purity: 1 },
  ]);
  upsertRuleSuggestions(db, 1, [
    { counterparty_account: '705-77628031/0710', category_id: 10, subcategory_id: null, coverage_count: 4, purity: 1 },
  ]);
  const list = listPendingSuggestions(db, 1);
  assert.equal(list.length, 1);
  assert.equal(list[0].coverage_count, 4);
});

test('upsertRuleSuggestions: dismissed/approved protiúčet se přeskočí (žádné re-navrhování)', () => {
  const db = freshDb();
  const { upsertRuleSuggestions, listPendingSuggestions } = require('./ruleSuggestions');
  const [id] = upsertRuleSuggestions(db, 1, [
    { counterparty_account: '705-77628031/0710', category_id: 10, subcategory_id: null, coverage_count: 3, purity: 1 },
  ]);
  db.prepare("UPDATE rule_suggestions SET status = 'dismissed' WHERE id = ?").run(id);
  const ids2 = upsertRuleSuggestions(db, 1, [
    { counterparty_account: '705-77628031/0710', category_id: 10, subcategory_id: null, coverage_count: 5, purity: 1 },
  ]);
  assert.equal(ids2.length, 0);
  assert.equal(listPendingSuggestions(db, 1).length, 0);
});

test('getSuggestion: vrátí řádek jen pro vlastníka', () => {
  const db = freshDb();
  const { upsertRuleSuggestions, getSuggestion } = require('./ruleSuggestions');
  const [id] = upsertRuleSuggestions(db, 1, [
    { counterparty_account: '705-77628031/0710', category_id: 10, subcategory_id: null, coverage_count: 3, purity: 1 },
  ]);
  assert.ok(getSuggestion(db, 1, id));
  assert.equal(getSuggestion(db, 999, id), undefined);
});
```

- [ ] **Step 2: Spusť test, ověř FAIL**

Run: `node --test src/services/ruleSuggestions.test.js`
Expected: FAIL — modul neexistuje.

- [ ] **Step 3: Vytvoř `src/services/ruleSuggestions.js`**

```js
'use strict';
// Perzistence návrhů pravidel (rule_suggestions). Scoring dělá
// src/utils/counterparty-rule-candidates.js — tohle je čistě zápis/čtení.

const SELECT_WITH_NAMES = `
  SELECT s.id, s.counterparty_account, s.category_id, s.subcategory_id,
         s.coverage_count, s.purity, s.status, s.created_at,
         c.name AS category_name, c.color AS category_color,
         sc.name AS subcategory_name
  FROM rule_suggestions s
  JOIN categories c ON c.id = s.category_id
  LEFT JOIN subcategories sc ON sc.id = s.subcategory_id
`;

// Uloží/aktualizuje kandidáty jako pending návrhy. Kandidát, jehož protiúčet už
// byl approved/dismissed, se přeskočí (trvalé rozhodnutí, žádné re-navrhování).
// Vrací ID nově vytvořených/aktualizovaných PENDING návrhů.
function upsertRuleSuggestions(db, userId, candidates) {
  const find = db.prepare('SELECT id, status FROM rule_suggestions WHERE user_id = ? AND counterparty_account = ?');
  const insert = db.prepare(`INSERT INTO rule_suggestions
      (user_id, counterparty_account, category_id, subcategory_id, coverage_count, purity)
      VALUES (?, ?, ?, ?, ?, ?)`);
  const update = db.prepare(`UPDATE rule_suggestions
      SET category_id = ?, subcategory_id = ?, coverage_count = ?, purity = ? WHERE id = ?`);
  const ids = [];
  for (const c of candidates) {
    const existing = find.get(userId, c.counterparty_account);
    if (existing && existing.status !== 'pending') continue;
    if (existing) {
      update.run(c.category_id, c.subcategory_id, c.coverage_count, c.purity, existing.id);
      ids.push(existing.id);
    } else {
      const info = insert.run(userId, c.counterparty_account, c.category_id, c.subcategory_id, c.coverage_count, c.purity);
      ids.push(Number(info.lastInsertRowid));
    }
  }
  return ids;
}

function getSuggestion(db, userId, id) {
  return db.prepare(`${SELECT_WITH_NAMES} WHERE s.id = ? AND s.user_id = ?`).get(id, userId);
}

function listPendingSuggestions(db, userId) {
  return db.prepare(`${SELECT_WITH_NAMES} WHERE s.user_id = ? AND s.status = 'pending' ORDER BY s.coverage_count DESC`).all(userId);
}

module.exports = { upsertRuleSuggestions, getSuggestion, listPendingSuggestions };
```

- [ ] **Step 4: Spusť testy, ověř PASS**

Run: `node --test src/services/ruleSuggestions.test.js`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/ruleSuggestions.js src/services/ruleSuggestions.test.js
git commit -m "feat: perzistence navrhu pravidel (rule_suggestions service)"
```

---

### Task 7: API endpointy `/api/rules/suggestions*`

**Files:**
- Modify: `src/routes/rules.js`
- Test: `src/routes/rules.test.js`

**Interfaces:**
- Consumes: `findCounterpartyRuleCandidates` (Task 5), `upsertRuleSuggestions`/`getSuggestion`/`listPendingSuggestions` (Task 6).
- Produces: `GET /api/rules/suggestions`, `POST /api/rules/suggestions/scan`, `POST /api/rules/suggestions/:id/approve`, `POST /api/rules/suggestions/:id/dismiss` — konzumuje Task 9 (`RulesPage.jsx`) a nepřímo Task 10 (banner v `ImportPage.jsx` volá `:id/approve`/`:id/dismiss`).

- [ ] **Step 1: Napiš testy**

Přidej do `src/routes/rules.test.js` (za existující testy, před koncem souboru):

```js
test('suggestions: scan najde kandidáta, approve založí category_rules pravidlo', async () => {
  const { app, db } = setup();
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
                VALUES (1, 10, -5000, '2026-0${i + 1}-15', 'DPH', '705-77628031/0710')`).run();
  }
  const { server, base } = await listen(app);

  let res = await fetch(`${base}/api/rules/suggestions/scan`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).found, 1);

  res = await fetch(`${base}/api/rules/suggestions`);
  const list = await res.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].counterparty_account, '705-77628031/0710');
  assert.equal(list[0].category_name, 'Sport'); // fixture kategorie id=10 se jmenuje Sport (viz setup())

  res = await fetch(`${base}/api/rules/suggestions/${list[0].id}/approve`, { method: 'POST' });
  assert.equal(res.status, 200);

  const rules = await (await fetch(`${base}/api/rules`)).json();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].pattern, '');

  res = await fetch(`${base}/api/rules/suggestions`);
  assert.equal((await res.json()).length, 0); // approved zmizí z pending listu
  server.close();
});

test('suggestions: dismiss zavře návrh bez založení pravidla', async () => {
  const { app, db } = setup();
  db.prepare(`INSERT INTO rule_suggestions (user_id, counterparty_account, category_id, coverage_count, purity)
              VALUES (1, '705-77628031/0710', 10, 3, 1.0)`).run();
  const { server, base } = await listen(app);
  const list = await (await fetch(`${base}/api/rules/suggestions`)).json();
  const res = await fetch(`${base}/api/rules/suggestions/${list[0].id}/dismiss`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal((await (await fetch(`${base}/api/rules/suggestions`)).json()).length, 0);
  assert.equal((await (await fetch(`${base}/api/rules`)).json()).length, 0);
  server.close();
});

test('suggestions: approve cizího návrhu vrací 404', async () => {
  const { app, db } = setup();
  db.prepare(`INSERT INTO rule_suggestions (user_id, counterparty_account, category_id, coverage_count, purity)
              VALUES (2, '705-77628031/0710', 11, 3, 1.0)`).run();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/rules/suggestions/1/approve`, { method: 'POST' });
  assert.equal(res.status, 404);
  server.close();
});
```

Poznámka: existující `setup()` v `rules.test.js` (viz řádek 9-20) nevrací `db` — je potřeba ho vrátit, ať testy mají přístup pro seed dat. Uprav `setup()`:

```js
function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-rules-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./rules']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x'),(2,'out@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (10,1,'Sport'),(11,2,'Cizí')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/rules', require('./rules'));
  return { db, app };
}
```

(Tohle je jen doplnění návratové hodnoty — signatury volání `setup()` v existujících testech `const { app } = setup();` zůstávají funkční, protože destructurují jen `app`.)

- [ ] **Step 2: Spusť testy, ověř FAIL**

Run: `node --test src/routes/rules.test.js`
Expected: FAIL — `/api/rules/suggestions*` vrací 404 (routa neexistuje).

- [ ] **Step 3: Přidej routy do `src/routes/rules.js`**

Na začátek souboru (za existující requiry, řádek 5) přidej:

```js
const { findCounterpartyRuleCandidates } = require('../utils/counterparty-rule-candidates');
const { upsertRuleSuggestions, getSuggestion, listPendingSuggestions } = require('../services/ruleSuggestions');
```

Před `module.exports = router;` na konci souboru přidej:

```js
// GET /api/rules/suggestions — pending návrhy pravidel (protiúčet → kategorie)
router.get('/suggestions', requireAuth, (req, res) => {
  res.json(listPendingSuggestions(db, req.dataUserId));
});

// POST /api/rules/suggestions/scan — projede celou historii, založí/aktualizuje pending návrhy
router.post('/suggestions/scan', requireAuth, (req, res) => {
  const candidates = findCounterpartyRuleCandidates(db, req.dataUserId);
  const ids = upsertRuleSuggestions(db, req.dataUserId, candidates);
  res.json({ ok: true, found: ids.length });
});

// POST /api/rules/suggestions/:id/approve — založí category_rules pravidlo z návrhu
router.post('/suggestions/:id/approve', requireAuth, (req, res) => {
  const s = getSuggestion(db, req.dataUserId, req.params.id);
  if (!s) return res.status(404).json({ error: 'Návrh nenalezen.' });
  if (s.status !== 'pending') return res.status(400).json({ error: 'Návrh už je vyřešený.' });
  const info = db.prepare(`INSERT INTO category_rules
      (user_id, category_id, pattern, match_counterparty_account, subcategory_id)
      VALUES (?, ?, '', ?, ?)`)
    .run(req.dataUserId, s.category_id, s.counterparty_account, s.subcategory_id);
  db.prepare("UPDATE rule_suggestions SET status = 'approved', resolved_at = datetime('now') WHERE id = ?").run(s.id);
  res.json({ ok: true, rule_id: Number(info.lastInsertRowid) });
});

// POST /api/rules/suggestions/:id/dismiss — trvale zamítne návrh, žádné re-navrhování
router.post('/suggestions/:id/dismiss', requireAuth, (req, res) => {
  const s = getSuggestion(db, req.dataUserId, req.params.id);
  if (!s) return res.status(404).json({ error: 'Návrh nenalezen.' });
  db.prepare("UPDATE rule_suggestions SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ?").run(s.id);
  res.json({ ok: true });
});
```

- [ ] **Step 4: Spusť testy, ověř PASS**

Run: `node --test src/routes/rules.test.js`
Expected: všechny testy PASS (existující CRUD + 3 nové).

- [ ] **Step 5: Zapoj routu do serveru — zkontroluj mount**

`src/index.js:72` už má `app.use('/api/rules', require('./routes/rules'));` — žádná změna potřeba, nové cesty jsou pod stejným routerem.

- [ ] **Step 6: Spusť celou backend sadu**

Run: `node --test 'src/**/*.test.js'`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/rules.js src/routes/rules.test.js
git commit -m "feat(api): endpointy pro navrhy pravidel (GET/POST suggestions)"
```

---

### Task 8: Reaktivní trigger v `/api/email-inbox/:id/approve`

**Files:**
- Modify: `src/routes/emailInbox.js`
- Test: `src/routes/emailInbox.test.js`

**Interfaces:**
- Consumes: `findCounterpartyRuleCandidates` (Task 5), `upsertRuleSuggestions`/`getSuggestion` (Task 6).
- Produces: response `POST /:id/approve` nově obsahuje `newSuggestion` (objekt nebo `null`) — konzumuje Task 10 (`ImportPage.jsx` banner).

- [ ] **Step 1: Napiš testy**

Přidej do `src/routes/emailInbox.test.js`:

```js
test('approve: po 3. platbě na stejný protiúčet vrátí newSuggestion', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (10, 1, 'Y_Uctovani')").run();
  // 2 historické transakce na stejný protiúčet, jiná kategorie zatím netřeba (purity 100% ze 3)
  for (let i = 0; i < 2; i++) {
    db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account)
                VALUES (1, 10, -5000, '2026-0${i + 1}-15', 'DPH', '705-77628031/0710')`).run();
  }
  db.prepare(`INSERT INTO email_inbox (user_id, parsed_json, status)
              VALUES (1, ?, 'pending')`)
    .run(JSON.stringify({ description: 'DPH 2026/03', amount: -5000, date: '2026-03-15', counterparty_account: '705-77628031/0710' }));
  const row = db.prepare("SELECT id FROM email_inbox WHERE status='pending'").get();

  const l = await listen(appFor(1));
  const res = await fetch(`${l.base}/api/email-inbox/${row.id}/approve`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category_id: 10 }),
  });
  const body = await res.json();
  l.server.close(); cleanup(db, tmp);

  assert.equal(res.status, 200);
  assert.ok(body.newSuggestion);
  assert.equal(body.newSuggestion.counterparty_account, '705-77628031/0710');
  assert.equal(body.newSuggestion.coverage_count, 3);
});

test('approve: bez opakování (jen 1 platba) newSuggestion je null', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (10, 1, 'Y_Uctovani')").run();
  db.prepare(`INSERT INTO email_inbox (user_id, parsed_json, status)
              VALUES (1, ?, 'pending')`)
    .run(JSON.stringify({ description: 'DPH 2026/03', amount: -5000, date: '2026-03-15', counterparty_account: '705-77628031/0710' }));
  const row = db.prepare("SELECT id FROM email_inbox WHERE status='pending'").get();

  const l = await listen(appFor(1));
  const res = await fetch(`${l.base}/api/email-inbox/${row.id}/approve`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category_id: 10 }),
  });
  const body = await res.json();
  l.server.close(); cleanup(db, tmp);

  assert.equal(body.newSuggestion, null);
});
```

- [ ] **Step 2: Spusť testy, ověř FAIL**

Run: `node --test src/routes/emailInbox.test.js`
Expected: FAIL — `body.newSuggestion` je `undefined`, ne objekt/`null`.

- [ ] **Step 3: Uprav `src/routes/emailInbox.js`**

Přidej import na začátek souboru (za `const { requireAuth } = require('../middleware/auth');`):

```js
const { findCounterpartyRuleCandidates } = require('../utils/counterparty-rule-candidates');
const { upsertRuleSuggestions, getSuggestion } = require('../services/ruleSuggestions');
```

V handleru `POST /:id/approve`, uprav konec (za `const result = db.transaction(...)()`):

```js
  const result = db.transaction(() => {
    const r = db.prepare(`INSERT OR IGNORE INTO transactions
        (user_id, category_id, amount, currency, date, description, note, source, external_id,
         tx_time, tx_type, counterparty_account, entered_by, place, account_id, ab_category)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank-email', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.dataUserId, categoryId || null, tx.amount, tx.currency, tx.date, tx.description,
           tx.note || '', row.external_id || null, tx.tx_time || null, tx.tx_type || null,
           tx.counterparty_account || null, tx.entered_by || null, tx.place || null,
           tx.account_id || null, tx.ab_category || null);
    // Idempotence: status nastavíme 'imported' i když INSERT OR IGNORE nic nevložil
    // (transakce už existuje, např. ze souběžného CSV importu se shodným external_id).
    // Cíl uživatele je splněn → položku z fronty odebíráme tak jako tak.
    db.prepare("UPDATE email_inbox SET status = 'imported' WHERE id = ?").run(row.id);
    return r;
  })();

  // Best-effort detekce opakující se platby podle protiúčtu — selhání nesmí
  // shodit zařazení platby (proto try/catch, stejný vzor jako tryMatchAppleReceipt).
  let newSuggestion = null;
  try {
    if (tx.counterparty_account) {
      const candidates = findCounterpartyRuleCandidates(db, req.dataUserId, {
        onlyCounterpartyAccount: tx.counterparty_account,
      });
      if (candidates.length > 0) {
        const [id] = upsertRuleSuggestions(db, req.dataUserId, candidates);
        if (id) newSuggestion = getSuggestion(db, req.dataUserId, id);
      }
    }
  } catch (e) {
    console.error('[rule-suggestions] detekce po approve:', e && e.message);
  }

  res.json({ ok: true, imported: result.changes > 0, newSuggestion });
```

- [ ] **Step 4: Spusť testy, ověř PASS**

Run: `node --test src/routes/emailInbox.test.js`
Expected: všechny testy PASS (existující + 2 nové).

- [ ] **Step 5: Spusť celou backend sadu**

Run: `node --test 'src/**/*.test.js'`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/emailInbox.js src/routes/emailInbox.test.js
git commit -m "feat: reaktivni navrh pravidla po rucnim zarazeni v review fronte"
```

---

### Task 9: `RulesPage.jsx` — sekce „Návrhy pravidel"

**Files:**
- Modify: `client/src/pages/RulesPage.jsx`

**Interfaces:**
- Consumes: `GET /api/rules/suggestions`, `POST /api/rules/suggestions/scan`, `POST /api/rules/suggestions/:id/approve`, `POST /api/rules/suggestions/:id/dismiss` (Task 7).

- [ ] **Step 1: Přidej stav a načítání**

V `RulesPage.jsx` uprav `useState` blok (za `const [query, setQuery] = useState('');`, řádek 18):

```js
  const [suggestions, setSuggestions] = useState([]);
  const [scanning, setScanning] = useState(false);
```

Uprav `load` (řádky 28-38):

```js
  const load = useCallback(async () => {
    try {
      const [r, c, s] = await Promise.all([
        fetch('/api/rules'), fetch('/api/categories'), fetch('/api/rules/suggestions'),
      ]);
      if (!r.ok || !c.ok) throw new Error('load');
      const [rj, cj, sj] = [await r.json(), await c.json(), s.ok ? await s.json() : []];
      setRules(Array.isArray(rj) ? rj : []);
      setCats(Array.isArray(cj) ? cj : []);
      setSuggestions(Array.isArray(sj) ? sj : []);
    } catch {
      setErr('Nepodařilo se načíst pravidla.');
    }
  }, []);
```

- [ ] **Step 2: Přidej akce pro návrhy**

Za funkci `remove` (řádky 104-110) přidej:

```js
  async function approveSuggestion(id) {
    const res = await fetch(`/api/rules/suggestions/${id}/approve`, { method: 'POST' });
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Chyba.'); return; }
    load();
  }

  async function dismissSuggestion(id) {
    const res = await fetch(`/api/rules/suggestions/${id}/dismiss`, { method: 'POST' });
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Chyba.'); return; }
    load();
  }

  async function scanHistory() {
    setScanning(true);
    try {
      const res = await fetch('/api/rules/suggestions/scan', { method: 'POST' });
      if (!res.ok) { setErr('Chyba při kontrole historie.'); return; }
      load();
    } finally { setScanning(false); }
  }
```

- [ ] **Step 3: Přidej JSX sekci**

V `return (...)`, za blok `{err && ...}` (řádek 123) a před formulářovou kartu (řádek 125 `<div ref={formRef} ...>`), vlož:

```jsx
      <div className="card" style={{ marginBottom: 16, maxWidth: 900 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>Návrhy pravidel</strong>{' '}
            <span className="text-muted" style={{ fontSize: 12 }}>
              podle opakujícího se čísla protiúčtu, ne textu
            </span>
          </div>
          <button className="btn btn-ghost" disabled={scanning} onClick={scanHistory}>
            {scanning ? 'Kontroluji…' : 'Zkontrolovat historii'}
          </button>
        </div>
        {suggestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {suggestions.map(s => (
              <div key={s.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, gap: 12,
              }}>
                <div style={{ fontSize: 13 }}>
                  Protiúčet <strong>{s.counterparty_account}</strong> → {s.category_name}
                  {s.subcategory_name && <span className="text-muted"> · {s.subcategory_name}</span>}
                  <span className="text-muted"> ({s.coverage_count}× plateb, {(s.purity * 100).toFixed(0)} % shoda)</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => approveSuggestion(s.id)}>
                    Založit
                  </button>
                  <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => dismissSuggestion(s.id)}>
                    Zamítnout
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

```

- [ ] **Step 4: Ověř v běžícím dev serveru**

Run: `npm run dev` (nebo existující dev skript projektu), otevři `/rules`.
Expected: sekce „Návrhy pravidel" se zobrazí s tlačítkem „Zkontrolovat historii"; po kliku (pokud historie obsahuje protiúčet s coverage≥3/purity≥90%, např. DPH na Tom-OSVC účtu) se objeví karta s tlačítky Založit/Zamítnout; Založit vytvoří řádek v tabulce pravidel níže (pattern prázdný, sloupec „Omezení" beze změny — protiúčet se v tabulce nezobrazuje, což je vědomě mimo scope tohoto úkolu).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/RulesPage.jsx
git commit -m "feat(ui): sekce Navrhy pravidel na strance Pravidla"
```

---

### Task 10: `ImportPage.jsx` — inline banner v review frontě

**Files:**
- Modify: `client/src/pages/ImportPage.jsx`

**Interfaces:**
- Consumes: `newSuggestion` z response `POST /api/email-inbox/:id/approve` (Task 8); `POST /api/rules/suggestions/:id/approve|dismiss` (Task 7).

- [ ] **Step 1: Přidej stav banneru**

V `EmailInbox()` (za `const [appleReceipts, setAppleReceipts] = useState([]);`, řádek 210) přidej:

```js
  const [suggestionBanner, setSuggestionBanner] = useState(null);
```

- [ ] **Step 2: Uprav `approve()`, ať čte `newSuggestion` z odpovědi**

Nahraď funkci `approve` (řádky 256-275):

```js
  async function approve(item, categoryId, originEl) {
    setBusy(item.id);
    try {
      const r = await fetch(`/api/email-inbox/${item.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: categoryId || null }),
      });
      if (!r.ok) return;
      const data = await r.json();
      // Oslavný feedback: konfety v barvě kategorie + pop, kartička odletí, pak refetch.
      const cat = cats.find(c => c.id === categoryId);
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (originEl) fireConfetti(originEl.getBoundingClientRect(), cat?.color);
      playPopSound();
      setCelebratingId(item.id);
      await new Promise(res => setTimeout(res, reduced ? 0 : 450));
      await load();
      setCelebratingId(null);
      if (data.newSuggestion) setSuggestionBanner(data.newSuggestion);
    } finally { setBusy(null); }
  }

  async function approveBannerSuggestion() {
    if (!suggestionBanner) return;
    await fetch(`/api/rules/suggestions/${suggestionBanner.id}/approve`, { method: 'POST' });
    setSuggestionBanner(null);
  }

  async function dismissBannerSuggestion() {
    if (!suggestionBanner) return;
    await fetch(`/api/rules/suggestions/${suggestionBanner.id}/dismiss`, { method: 'POST' });
    setSuggestionBanner(null);
  }
```

- [ ] **Step 3: Přidej JSX banner**

V `return (...)` sekce (řádek ~340, hned za `<h2 className="page-title" ...>...</h2>` blokem a před `{awaiting.map(item => {`), vlož:

```jsx
      {suggestionBanner && (
        <div className="alert alert-success" style={{
          marginBottom: 12, display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span>
            Tahle platba (protiúčet <strong>{suggestionBanner.counterparty_account}</strong>) se objevila
            už {suggestionBanner.coverage_count}× a pokaždé šla do kategorie{' '}
            <strong>{suggestionBanner.category_name}</strong>. Založit pravidlo, aby se příště zařadila automaticky?
          </span>
          <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={approveBannerSuggestion}>
              Založit
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={dismissBannerSuggestion}>
              Ne, díky
            </button>
          </span>
        </div>
      )}

```

- [ ] **Step 4: Ověř v běžícím dev serveru**

Run: dev server, otevři `/import`. Ručně zařaď 3 platby na stejný nový protiúčet do stejné kategorie (přes review frontu nebo test data).
Expected: po schválení 3. platby se objeví zelený banner s textem o opakující se platbě; klik „Založit" banner zavře a vytvoří pravidlo (ověřitelné na `/rules`); klik „Ne, díky" banner zavře bez vytvoření pravidla.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ImportPage.jsx
git commit -m "feat(ui): inline banner navrhu pravidla v review fronte importu"
```

---

## Self-Review

**Spec coverage:**
- A (datový model) → Task 1, 2, 4 ✓
- B (candidate finder) → Task 5 ✓
- C (reaktivní trigger) → Task 8, 10 ✓
- D (dávkový trigger) → Task 7, 9 ✓
- E (schválení/zamítnutí) → Task 7 ✓
- F (downstream routing/notifikace) → beze změny v `pushNotify.js`/`recategorizePending()` — pokryto Task 4 (jakmile pravidlo existuje, `applyRules` ho najde automaticky) ✓
- G (edge cases: chybějící protiúčet, nekonzistentní purity, OSVČ mimo scope) → pokryto testy Task 5 ✓
- Testy (spec bod 8) → Task 2-8 ✓

**Placeholder scan:** žádné TBD/TODO, všechny kroky mají konkrétní kód.

**Type/name consistency:** `findCounterpartyRuleCandidates` (Task 5) používá stejný název ve všech konzumentech (Task 6 test, Task 7, Task 8). `upsertRuleSuggestions`/`getSuggestion`/`listPendingSuggestions` (Task 6) používají stejné názvy v Task 7 i Task 8. `normalizeAccount` (Task 1) je default export, importovaný stejně v Task 4 i Task 5.

**Mimo scope (z designu, vědomě):** speciální notifikační výjimka pro recurring, re-navrhování po zamítnutí, plná statistická detekce frekvence/intervalu.
