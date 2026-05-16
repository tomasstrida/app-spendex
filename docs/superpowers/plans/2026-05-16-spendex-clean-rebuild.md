# Spendex čistý rebuild dat – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministicky a idempotentně přestavět produkční Spendex DB z verzované konfigurace: 24 kanonických kategorií, 3vrstvý systém pravidel + L0 detekce interních převodů, zachovaná kurátorská čísla, import 1012 transakcí z AirBank CSV.

**Architecture:** Config-as-code v `scripts/seed/*` (čistá data) + čistá funkce `scripts/lib/apply-rules.js` (kategorizace, unit-testovaná bez DB) + orchestrátor `scripts/rebuild.cjs` (VACUUM záloha → atomická transakce wipe+seed+import → verifikace → dry-run default, COMMIT jen s `CONFIRM=1`).

**Tech Stack:** Node.js v22 (`better-sqlite3`, vestavěný `node:test`), existující `src/utils/csvParser.js`, SQLite. Žádné nové závislosti.

**Spec:** `docs/superpowers/specs/2026-05-16-spendex-clean-rebuild-design.md`

**Kontext pro implementátora (čti, než začneš):**
- Produkční DB: jeden uživatel, `user_id = 1` (tomas.strida@gmail.com). Všechny seed/INSERT používají `user_id = 1`.
- Prod běží na Railway, DB na volume `/data/data.db` (env `DB_PATH`). Přístup výhradně přes `railway ssh --service app-spendex --environment production "..."`. Railway ssh **nepřenáší stdin** – soubory se nahrávají base64 v argv (viz Task 7). `sqlite3` CLI v kontejneru NENÍ – vše přes `node` + `better-sqlite3` z `/app`.
- DB je ve WAL módu. Plain `cp data.db` = nevalidní záloha (4 KB hlavička). Konzistentní kopie jen přes `VACUUM INTO`.
- `categories` má UNIQUE index `idx_categories_user_name (user_id, name)` (již nasazen v prod) – seed kategorií proto nesmí mít duplicitní názvy.
- CSV adresář: `/Users/tomas/AI/projekt-finance/Airbank-export-komplet-ucty` (10 souborů, únor–14.5.2026). Lokálně dostupné.
- Parser `src/utils/csvParser.js` export `parseAirBankCSV(text)` → pole objektů `{date, amount, currency, description, note, ab_category, direction, external_id, tx_time, tx_type, counterparty_account, entered_by, place}`.
- Práce probíhá ve větvi `staging`. Commituj průběžně. Push až na pokyn / na konci.

---

## Přesné DB schéma (cílové tabulky)

```
categories(id PK, user_id, name, color DEF '#6366f1', icon DEF 'tag', created_at,
           type INT DEF 1, typical_price REAL, frequency_months INT)  UNIQUE(user_id,name)
accounts(id PK, user_id, account_number, name, role DEF 'spending', created_at)  UNIQUE(user_id,account_number)
budgets(id PK, user_id, category_id, month, amount, created_at)  UNIQUE(user_id,category_id,month)
fixed_expenses(id PK, user_id, name, amount, note, sort_order, created_at)
annual_budgets(id PK, user_id, category_id, amount, created_at)
budget_items(id PK, user_id, category_id, name, amount, window_start, window_end, created_at)
income(id PK, user_id, person, amount, period, note, created_at)  UNIQUE(user_id,person,period)
transactions(id PK, user_id, category_id, amount, currency DEF 'CZK', date, description,
             note, source DEF 'manual', external_id, created_at, tx_time, tx_type,
             counterparty_account, entered_by, place, account_id)  UNIQUE(user_id,external_id)
airbank_category_mappings(id PK, user_id, ab_category, category_id)  UNIQUE(user_id,ab_category)
category_rules(id PK, user_id, category_id, pattern, created_at)
```

## File Structure

| Soubor | Odpovědnost |
|---|---|
| `scripts/seed/categories.js` | 24 kategorií `{name, type}` |
| `scripts/seed/accounts.js` | 10 účtů `{account_number, name, role}` |
| `scripts/seed/budgets.js` | default měsíční budgety `{category, amount}` (13×) |
| `scripts/seed/fixed-expenses.js` | 8 fixních výdajů `{name, amount, sort_order}` |
| `scripts/seed/annual.js` | `annualBudgets[]` + `budgetItems[]` |
| `scripts/seed/income.js` | 4 příjmy `{person, amount, period}` |
| `scripts/seed/rules.js` | `ownAccountNumbers`, `accountRules`, `abCategoryMap`, `textOverrides`, konstanty kategorií |
| `scripts/lib/apply-rules.js` | čistá funkce `applyRules(tx, account, rules)` → název kategorie |
| `scripts/lib/apply-rules.test.js` | `node:test` unit testy |
| `scripts/rebuild.cjs` | orchestrátor (záloha, wipe, seed, import, verifikace, dry-run) |

---

## Task 1: Seed data soubory

**Files:**
- Create: `scripts/seed/categories.js`, `scripts/seed/accounts.js`, `scripts/seed/budgets.js`, `scripts/seed/fixed-expenses.js`, `scripts/seed/annual.js`, `scripts/seed/income.js`
- Test: `scripts/seed/seed.test.js`

- [ ] **Step 1: Napiš `scripts/seed/categories.js`**

```javascript
'use strict';
// 24 kanonických kategorií. type: 1=měsíční, 2=roční/sezónní, 3=fond.
module.exports = [
  { name: 'Jídlo a běžné nákupy', type: 1 },
  { name: 'Auto Moto - PHM', type: 1 },
  { name: 'Sport', type: 1 },
  { name: 'Nákupy bydlení', type: 1 },
  { name: 'Oblečení', type: 1 },
  { name: 'Zábava', type: 1 },
  { name: 'Restaurace a kávičky', type: 1 },
  { name: 'Dárky', type: 1 },
  { name: 'Beauty', type: 1 },
  { name: 'Terapie', type: 1 },
  { name: 'Y - Lítačka', type: 2 },
  { name: 'Y - Auto Moto - Servis', type: 2 },
  { name: 'Y - Tom cvíčo', type: 2 },
  { name: 'Licence', type: 2 },
  { name: 'Tom osobní', type: 1 },
  { name: 'Martin osobní', type: 1 },
  { name: 'Y - Beach volejbal', type: 2 },
  { name: 'Y - Léky, PrEP, Optika', type: 2 },
  { name: 'Y - Pojistky', type: 2 },
  { name: 'Drahé věci', type: 1 },
  { name: 'Ostatní', type: 1 },
  { name: 'Příjmy', type: 1 },
  { name: 'Převody', type: 1 },
  { name: 'Pravidelné platby', type: 1 },
];
```

- [ ] **Step 2: Napiš `scripts/seed/accounts.js`**

```javascript
'use strict';
module.exports = [
  { account_number: '1679014023', name: 'Společný', role: 'spending' },
  { account_number: '1679014058', name: 'zz-Hromadné akce', role: 'spending' },
  { account_number: '1679014074', name: 'Nepravidelné', role: 'spending' },
  { account_number: '1679014111', name: 'Licence', role: 'spending' },
  { account_number: '1679014066', name: 'Harmonicka-najem', role: 'fixed' },
  { account_number: '1679014138', name: 'Hlavní', role: 'ignored' },
  { account_number: '1679014031', name: 'Tom-OSVC', role: 'ignored' },
  { account_number: '1679014015', name: 'Tom-AirBank', role: 'ignored' },
  { account_number: '1679014082', name: 'Spořicí-účet-1', role: 'ignored' },
  { account_number: '1679014103', name: 'Dane-doplatek', role: 'ignored' },
];
```

- [ ] **Step 3: Napiš `scripts/seed/budgets.js`** (default měsíční, jen typ 1 s částkou)

```javascript
'use strict';
// month='default' budgety. Drahé věci = 0 (zobrazí se bar bez alokace).
module.exports = [
  { category: 'Jídlo a běžné nákupy', amount: 20000 },
  { category: 'Auto Moto - PHM', amount: 8500 },
  { category: 'Sport', amount: 1200 },
  { category: 'Nákupy bydlení', amount: 1000 },
  { category: 'Oblečení', amount: 3000 },
  { category: 'Zábava', amount: 4500 },
  { category: 'Restaurace a kávičky', amount: 10000 },
  { category: 'Dárky', amount: 1000 },
  { category: 'Beauty', amount: 3000 },
  { category: 'Terapie', amount: 3000 },
  { category: 'Tom osobní', amount: 1000 },
  { category: 'Martin osobní', amount: 1000 },
  { category: 'Drahé věci', amount: 0 },
];
```

- [ ] **Step 4: Napiš `scripts/seed/fixed-expenses.js`**

```javascript
'use strict';
module.exports = [
  { name: 'Y - Léky optika', amount: 4000, sort_order: 1 },
  { name: 'Y - Lítačka', amount: 600, sort_order: 2 },
  { name: 'Y - Servis auto moto', amount: 2500, sort_order: 3 },
  { name: 'Y - Beach a cvíčo', amount: 3800, sort_order: 4 },
  { name: 'Y - Pojistky', amount: 600, sort_order: 5 },
  { name: 'Y - Licence', amount: 6000, sort_order: 6 },
  { name: 'Nájem + zálohy Stodola', amount: 45000, sort_order: 7 },
  { name: 'Spoření', amount: 25000, sort_order: 8 },
];
```

- [ ] **Step 5: Napiš `scripts/seed/annual.js`**

```javascript
'use strict';
// annualBudgets: roční strop na kategorii. budgetItems: sezónní položky s okny (měsíce 1-12).
module.exports = {
  annualBudgets: [
    { category: 'Y - Auto Moto - Servis', amount: 30000 },
    { category: 'Y - Tom cvíčo', amount: 33000 },
    { category: 'Licence', amount: 72000 },
    { category: 'Y - Léky, PrEP, Optika', amount: 20000 },
    { category: 'Y - Pojistky', amount: 7200 },
  ],
  budgetItems: [
    { category: 'Y - Lítačka', name: 'Lítačka Tom', amount: 3650, window_start: 4, window_end: 5 },
    { category: 'Y - Lítačka', name: 'Lítačka Martin', amount: 3650, window_start: 8, window_end: 9 },
    { category: 'Y - Beach volejbal', name: 'Beach léto 2026', amount: 10500, window_start: 5, window_end: 9 },
    { category: 'Y - Beach volejbal', name: 'Beach zima 2026', amount: 21000, window_start: 9, window_end: 12 },
  ],
};
```

- [ ] **Step 6: Napiš `scripts/seed/income.js`**

```javascript
'use strict';
module.exports = [
  { person: 'Martin', amount: 23000, period: '2026-02' },
  { person: 'Společně', amount: 156000, period: '2026-01' },
  { person: 'Sudo', amount: 21000, period: '2026-02' },
  { person: 'Tom', amount: 126000, period: '2026-02' },
];
```

- [ ] **Step 7: Napiš validační test `scripts/seed/seed.test.js`**

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const categories = require('./categories');
const accounts = require('./accounts');
const budgets = require('./budgets');
const fixed = require('./fixed-expenses');
const annual = require('./annual');
const income = require('./income');

const catNames = new Set(categories.map(c => c.name));

test('24 unikátních kategorií', () => {
  assert.equal(categories.length, 24);
  assert.equal(catNames.size, 24);
});

test('typy kategorií jsou 1, 2 nebo 3', () => {
  for (const c of categories) assert.ok([1, 2, 3].includes(c.type), c.name);
});

test('10 účtů s validní rolí', () => {
  assert.equal(accounts.length, 10);
  for (const a of accounts) assert.ok(['spending', 'fixed', 'ignored'].includes(a.role), a.name);
});

test('budgety odkazují existující kategorie', () => {
  assert.equal(budgets.length, 13);
  for (const b of budgets) assert.ok(catNames.has(b.category), b.category);
});

test('annual a budget_items odkazují existující kategorie', () => {
  for (const a of annual.annualBudgets) assert.ok(catNames.has(a.category), a.category);
  for (const i of annual.budgetItems) {
    assert.ok(catNames.has(i.category), i.category);
    assert.ok(i.window_start >= 1 && i.window_end <= 12 && i.window_start <= i.window_end, i.name);
  }
});

test('fixed_expenses a income mají správný tvar', () => {
  assert.equal(fixed.length, 8);
  assert.equal(income.length, 4);
  for (const i of income) assert.match(i.period, /^\d{4}-\d{2}$/);
});
```

- [ ] **Step 8: Spusť test, ověř PASS**

Run: `node --test scripts/seed/seed.test.js`
Expected: všechny testy PASS (6 testů).

- [ ] **Step 9: Commit**

```bash
git add scripts/seed/categories.js scripts/seed/accounts.js scripts/seed/budgets.js scripts/seed/fixed-expenses.js scripts/seed/annual.js scripts/seed/income.js scripts/seed/seed.test.js
git commit -m "feat: seed config pro čistý rebuild (24 kategorií, účty, budgety, fixní, roční, příjmy)"
```

---

## Task 2: Pravidla konfigurace + čistá funkce kategorizace (TDD)

**Files:**
- Create: `scripts/seed/rules.js`, `scripts/lib/apply-rules.js`
- Test: `scripts/lib/apply-rules.test.js`

- [ ] **Step 1: Napiš `scripts/seed/rules.js`**

```javascript
'use strict';
// L0: protistrana ∈ vlastní účty → Převody. L1: účet → kategorie.
// L2: AB kategorie → Spendex. L3: textový pattern (popis/note) → kategorie.
module.exports = {
  internalTransferCategory: 'Převody',
  fallbackCategory: 'Ostatní',

  ownAccountNumbers: [
    '1679014015', '1679014023', '1679014031', '1679014058', '1679014066',
    '1679014074', '1679014082', '1679014103', '1679014111', '1679014138',
  ],

  accountRules: {
    '1679014111': 'Licence', // účet Licence → vše Licence
  },

  abCategoryMap: {
    'Jídlo': 'Jídlo a běžné nákupy',
    'Nakupy Jidlo': 'Jídlo a běžné nákupy',
    'Lékárna': 'Jídlo a běžné nákupy',
    'Nákupy': 'Jídlo a běžné nákupy',
    'Restaurace': 'Restaurace a kávičky',
    'Doprava': 'Auto Moto - PHM',
    'Sport': 'Sport',
    'Zábava': 'Zábava',
    'Bydlení': 'Nákupy bydlení',
    'Licence Apple apod': 'Licence',
    'Drahe-veci': 'Drahé věci',
    'Zdravotní': 'Terapie',
    'Terapie': 'Terapie',
    'Služby': 'Beauty',
    'Dárky': 'Dárky',
    'Tom osobni': 'Tom osobní',
    'Pravidelne mesicni': 'Pravidelné platby',
    'Pojištění': 'Y - Pojistky',
    'Sociální': 'Ostatní',
    'Splátky': 'Ostatní',
    'Výběr hotovosti': 'Ostatní',
    'OSVC': 'Ostatní',
    'Nezařazeno': 'Ostatní',
    'Vzdelavani': 'Ostatní',
    'Příchozí úhrada': 'Příjmy',
  },

  // pořadí = priorita (první shoda vyhrává)
  textOverrides: [
    { pattern: 'MAX FITNESS', category: 'Sport' },
    { pattern: 'MAXFITNESS', category: 'Sport' },
    { pattern: 'PIDLitacka', category: 'Y - Lítačka' },
    { pattern: 'PID Litacka', category: 'Y - Lítačka' },
    { pattern: 'Klinika Infekcnich', category: 'Y - Léky, PrEP, Optika' },
    { pattern: 'PrEP', category: 'Y - Léky, PrEP, Optika' },
    { pattern: 'ROHLIK', category: 'Jídlo a běžné nákupy' },
    { pattern: 'ROHLÍK', category: 'Jídlo a běžné nákupy' },
  ],
};
```

- [ ] **Step 2: Napiš failující testy `scripts/lib/apply-rules.test.js`**

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const applyRules = require('./apply-rules');
const rules = require('../seed/rules');

const acc = (n) => ({ account_number: n, name: 'x', role: 'spending' });

test('L0 interní převod (protistrana = vlastní účet) → Převody, přebíjí vše', () => {
  const tx = { counterparty_account: '1679014138/3030', ab_category: 'Příchozí úhrada', description: 'ROHLIK', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Převody');
});

test('L0 normalizace: leading zeros a mezery v čísle protistrany', () => {
  const tx = { counterparty_account: ' 0001679014074 / 2010 ', ab_category: 'Doprava', description: '', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Převody');
});

test('L3 text-override přebíjí účet i AB kategorii', () => {
  const tx = { counterparty_account: 'CZ9920100000002400000000', ab_category: 'Zábava', description: 'MAX FITNESS Praha', note: '' };
  assert.equal(applyRules(tx, acc('1679014111'), rules), 'Sport'); // ne Licence (účet), ne Zábava (AB)
});

test('L3 PrEP override z note', () => {
  const tx = { counterparty_account: '', ab_category: 'Drahe-veci', description: 'Klinika', note: 'PrEP davka' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Y - Léky, PrEP, Optika');
});

test('L1 účetní pravidlo (Licence účet) když není L0/L3', () => {
  const tx = { counterparty_account: 'EXTERNAL999', ab_category: 'Nezařazeno', description: 'Apple', note: '' };
  assert.equal(applyRules(tx, acc('1679014111'), rules), 'Licence');
});

test('L2 AB kategorie když není L0/L3/L1', () => {
  const tx = { counterparty_account: 'EXTERNAL999', ab_category: 'Restaurace', description: 'Pizza', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Restaurace a kávičky');
});

test('L2 Příchozí úhrada (externí) → Příjmy', () => {
  const tx = { counterparty_account: 'EXTERNAL999', ab_category: 'Příchozí úhrada', description: 'STRIPE', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Příjmy');
});

test('L2 Pojištění → Y - Pojistky', () => {
  const tx = { counterparty_account: 'EXT', ab_category: 'Pojištění', description: 'Allianz', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Y - Pojistky');
});

test('fallback → Ostatní pro neznámou AB kategorii', () => {
  const tx = { counterparty_account: 'EXT', ab_category: 'NeznamaXY', description: 'cosi', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Ostatní');
});

test('prázdná protistrana neaktivuje L0', () => {
  const tx = { counterparty_account: '', ab_category: 'Sport', description: '', note: '' };
  assert.equal(applyRules(tx, acc('1679014023'), rules), 'Sport');
});
```

- [ ] **Step 3: Spusť testy, ověř FAIL**

Run: `node --test scripts/lib/apply-rules.test.js`
Expected: FAIL – `Cannot find module './apply-rules'`.

- [ ] **Step 4: Implementuj `scripts/lib/apply-rules.js`**

```javascript
'use strict';
// Čistá funkce: (tx, account, rules) → název kategorie.
// Precedence: L0 Převody → L3 text → L1 účet → L2 AB → fallback.

function normalizeAccount(raw) {
  if (!raw) return '';
  return String(raw).split('/')[0].replace(/\s/g, '').replace(/^0+/, '');
}

function applyRules(tx, account, rules) {
  // L0 – interní převod
  const cp = normalizeAccount(tx.counterparty_account);
  if (cp && rules.ownAccountNumbers.includes(cp)) {
    return rules.internalTransferCategory;
  }

  // L3 – text override (popis + note, case-insensitive substring)
  const hay = `${tx.description || ''} ${tx.note || ''}`.toLowerCase();
  for (const o of rules.textOverrides) {
    if (hay.includes(o.pattern.toLowerCase())) return o.category;
  }

  // L1 – účetní pravidlo
  if (account && rules.accountRules[account.account_number]) {
    return rules.accountRules[account.account_number];
  }

  // L2 – AB kategorie
  const ab = (tx.ab_category || '').trim();
  if (rules.abCategoryMap[ab]) return rules.abCategoryMap[ab];

  // fallback
  return rules.fallbackCategory;
}

module.exports = applyRules;
```

- [ ] **Step 5: Spusť testy, ověř PASS**

Run: `node --test scripts/lib/apply-rules.test.js`
Expected: 10 testů PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed/rules.js scripts/lib/apply-rules.js scripts/lib/apply-rules.test.js
git commit -m "feat: 3vrstvá pravidla kategorizace + L0 detekce interních převodů (TDD)"
```

---

## Task 3: Orchestrátor `rebuild.cjs`

**Files:**
- Create: `scripts/rebuild.cjs`

- [ ] **Step 1: Napiš `scripts/rebuild.cjs`**

```javascript
'use strict';
/**
 * Čistý rebuild Spendex DB z verzované konfigurace.
 * Env: DB_PATH (povinné), CSV_DIR (povinné), DRY_RUN (default '1'), CONFIRM ('1' = commit).
 * Bez CONFIRM=1 se transakce vrátí (ROLLBACK) a vytiskne jen report.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { parseAirBankCSV } = require('../src/utils/csvParser');
const applyRules = require('./lib/apply-rules');

const categories = require('./seed/categories');
const accounts = require('./seed/accounts');
const budgets = require('./seed/budgets');
const fixedExpenses = require('./seed/fixed-expenses');
const annual = require('./seed/annual');
const income = require('./seed/income');
const rules = require('./seed/rules');

const DB_PATH = process.env.DB_PATH;
const CSV_DIR = process.env.CSV_DIR;
const CONFIRM = process.env.CONFIRM === '1';
const USER_ID = 1;

if (!DB_PATH || !CSV_DIR) {
  console.error('DB_PATH a CSV_DIR jsou povinné.');
  process.exit(1);
}

// ── Záloha (jen při ostrém běhu) ─────────────────────────────────────────────
if (CONFIRM) {
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const backup = path.join(path.dirname(DB_PATH), `backup-rebuild-${ts}.db`);
  const bdb = new Database(DB_PATH);
  bdb.exec(`VACUUM INTO '${backup}'`);
  bdb.close();
  const check = new Database(backup, { readonly: true });
  const n = check.prepare('SELECT COUNT(*) n FROM transactions').get().n;
  check.close();
  console.log(`📦 Záloha: ${backup} (transactions: ${n})`);
}

const db = new Database(DB_PATH);

// ── CSV soubor pro každý účet (auto-detekce dle čísla v názvu) ────────────────
const csvFiles = {};
for (const f of fs.readdirSync(CSV_DIR)) {
  const m = f.match(/airbank_(\d+)/);
  if (m && f.endsWith('.csv')) csvFiles[m[1]] = path.join(CSV_DIR, f);
}

const report = {};

db.exec('BEGIN');
try {
  // 1. WIPE v FK-bezpečném pořadí
  for (const t of ['budget_items', 'annual_budgets', 'budgets', 'category_rules',
    'airbank_category_mappings', 'transactions', 'fixed_expenses', 'income',
    'accounts', 'categories']) {
    db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(USER_ID);
  }

  // 2. SEED kategorie
  const insCat = db.prepare('INSERT INTO categories (user_id, name, type) VALUES (?, ?, ?)');
  for (const c of categories) insCat.run(USER_ID, c.name, c.type);
  const catId = {};
  for (const r of db.prepare('SELECT id, name FROM categories WHERE user_id = ?').all(USER_ID)) {
    catId[r.name] = r.id;
  }
  const needCat = (name) => {
    if (!catId[name]) throw new Error(`Seed odkazuje neexistující kategorii: ${name}`);
    return catId[name];
  };

  // 3. SEED účty
  const insAcc = db.prepare('INSERT INTO accounts (user_id, account_number, name, role) VALUES (?, ?, ?, ?)');
  for (const a of accounts) insAcc.run(USER_ID, a.account_number, a.name, a.role);
  const accByNum = {};
  for (const r of db.prepare('SELECT id, account_number FROM accounts WHERE user_id = ?').all(USER_ID)) {
    accByNum[r.account_number] = r.id;
  }

  // 4. SEED budgety (default)
  const insBud = db.prepare("INSERT INTO budgets (user_id, category_id, month, amount) VALUES (?, ?, 'default', ?)");
  for (const b of budgets) insBud.run(USER_ID, needCat(b.category), b.amount);

  // 5. SEED fixní výdaje
  const insFx = db.prepare('INSERT INTO fixed_expenses (user_id, name, amount, sort_order) VALUES (?, ?, ?, ?)');
  for (const f of fixedExpenses) insFx.run(USER_ID, f.name, f.amount, f.sort_order);

  // 6. SEED roční budgety + položky
  const insAnn = db.prepare('INSERT INTO annual_budgets (user_id, category_id, amount) VALUES (?, ?, ?)');
  for (const a of annual.annualBudgets) insAnn.run(USER_ID, needCat(a.category), a.amount);
  const insItem = db.prepare('INSERT INTO budget_items (user_id, category_id, name, amount, window_start, window_end) VALUES (?, ?, ?, ?, ?, ?)');
  for (const i of annual.budgetItems) insItem.run(USER_ID, needCat(i.category), i.name, i.amount, i.window_start, i.window_end);

  // 7. SEED příjmy
  const insInc = db.prepare('INSERT INTO income (user_id, person, amount, period) VALUES (?, ?, ?, ?)');
  for (const i of income) insInc.run(USER_ID, i.person, i.amount, i.period);

  // 8. SEED pravidla do DB (L2 → airbank_category_mappings, L3 → category_rules)
  const insMap = db.prepare('INSERT INTO airbank_category_mappings (user_id, ab_category, category_id) VALUES (?, ?, ?)');
  for (const [ab, cat] of Object.entries(rules.abCategoryMap)) insMap.run(USER_ID, ab, needCat(cat));
  const insRule = db.prepare('INSERT INTO category_rules (user_id, category_id, pattern) VALUES (?, ?, ?)');
  for (const o of rules.textOverrides) insRule.run(USER_ID, needCat(o.category), o.pattern);

  // 9. IMPORT transakcí
  const insTx = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (user_id, category_id, amount, currency, date, description, note, source,
       external_id, tx_time, tx_type, counterparty_account, entered_by, place, account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank', ?, ?, ?, ?, ?, ?, ?)
  `);
  let imported = 0;
  const byCat = {};
  for (const a of accounts) {
    const file = csvFiles[a.account_number];
    if (!file) { report[`CSV chybí: ${a.name}`] = a.account_number; continue; }
    const txs = parseAirBankCSV(fs.readFileSync(file, 'utf-8'));
    const accId = accByNum[a.account_number];
    for (const t of txs) {
      const catName = applyRules(t, a, rules);
      const cId = needCat(catName);
      const extId = t.external_id ? `${t.external_id}-${a.account_number}` : null;
      const res = insTx.run(USER_ID, cId, t.amount, t.currency, t.date,
        t.description, t.note || '', extId, t.tx_time || null, t.tx_type || null,
        t.counterparty_account || null, t.entered_by || null, t.place || null, accId);
      if (res.changes > 0) { imported++; byCat[catName] = (byCat[catName] || 0) + 1; }
    }
  }
  report['importováno'] = imported;
  report['dle kategorie'] = byCat;

  // 10. VERIFIKACE
  const q1 = db.prepare('SELECT COUNT(*) n, ROUND(SUM(amount)) net FROM transactions WHERE user_id=?').get(USER_ID);
  const prevody = db.prepare("SELECT COUNT(*) n FROM transactions t JOIN categories c ON c.id=t.category_id WHERE t.user_id=? AND c.name='Převody'").get(USER_ID).n;
  const dead = db.prepare('SELECT COUNT(*) n FROM transactions t WHERE t.user_id=? AND t.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.id=t.category_id)').get(USER_ID).n;
  report['verifikace'] = {
    categories: db.prepare('SELECT COUNT(*) n FROM categories WHERE user_id=?').get(USER_ID).n,
    accounts: db.prepare('SELECT COUNT(*) n FROM accounts WHERE user_id=?').get(USER_ID).n,
    transactions: q1.n,
    net: q1.net,
    prevody: prevody,
    fixed_expenses: db.prepare('SELECT COUNT(*) n FROM fixed_expenses WHERE user_id=?').get(USER_ID).n,
    income: db.prepare('SELECT COUNT(*) n FROM income WHERE user_id=?').get(USER_ID).n,
    dead_category_fk: dead,
  };

  if (CONFIRM) { db.exec('COMMIT'); console.log('✅ COMMIT (ostrý běh)'); }
  else { db.exec('ROLLBACK'); console.log('🧪 ROLLBACK (dry-run; pro ostrý běh nastav CONFIRM=1)'); }
} catch (e) {
  db.exec('ROLLBACK');
  console.error('❌ CHYBA, ROLLBACK:', e.message);
  db.close();
  process.exit(1);
}

db.close();
console.log(JSON.stringify(report, null, 2));
```

- [ ] **Step 2: Syntax check**

Run: `node -c scripts/rebuild.cjs`
Expected: žádný výstup (OK).

- [ ] **Step 3: Commit**

```bash
git add scripts/rebuild.cjs
git commit -m "feat: rebuild.cjs orchestrátor (záloha, wipe, seed, import, verifikace, dry-run)"
```

---

## Task 4: Lokální dry-run na kopii prod DB

**Files:** žádné (operační ověření)

- [ ] **Step 1: Stáhni konzistentní kopii prod DB lokálně**

```bash
railway ssh --service app-spendex --environment production "cd /app && node -e \"require('better-sqlite3')('/data/data.db').exec(\\\"VACUUM INTO '/tmp/rebuild-test.db'\\\")\" && base64 /tmp/rebuild-test.db && rm -f /tmp/rebuild-test.db" 2>&1 | tail -1 > /tmp/proddb.b64
```
Pozn.: `VACUUM INTO` selže, pokud cíl existuje – proto `rm -f` na konci. Pokud výstup není čistý base64 (jeden řádek), zopakuj; větší DB může vyžadovat chunkování (viz Task 7 obrácený postup: `railway ssh "... base64 ..."` po částech). Očekávaná velikost ~2–3 MB.

- [ ] **Step 2: Dekóduj lokálně**

```bash
base64 -d /tmp/proddb.b64 > /tmp/rebuild-test.db
node -e "const d=require('/Users/tomas/app-spendex/node_modules/better-sqlite3')('/tmp/rebuild-test.db',{readonly:true}); console.log('tx:', d.prepare('SELECT COUNT(*) n FROM transactions').get().n);"
```
Expected: `tx: 1012` (nebo aktuální počet prod).

- [ ] **Step 3: Spusť rebuild v DRY-RUN proti kopii**

```bash
cd /Users/tomas/app-spendex && DB_PATH=/tmp/rebuild-test.db CSV_DIR=/Users/tomas/AI/projekt-finance/Airbank-export-komplet-ucty node scripts/rebuild.cjs
```
Expected: `🧪 ROLLBACK (dry-run...)` a JSON report s:
- `verifikace.categories` = 24
- `verifikace.accounts` = 10
- `verifikace.transactions` ≈ 1012
- `verifikace.prevody` ≈ 202
- `verifikace.fixed_expenses` = 8
- `verifikace.income` = 4
- `verifikace.dead_category_fk` = 0
- `dle kategorie` – žádná kategorie mimo 24 ze seedu; „Ostatní" by nemělo být dominantní (kontrola hrubého mapování)

- [ ] **Step 4: Porovnej net vs CSV inventory**

```bash
cd /Users/tomas/app-spendex && node -e '
const fs=require("fs"),path=require("path");
const {parseAirBankCSV}=require("./src/utils/csvParser");
const dir="/Users/tomas/AI/projekt-finance/Airbank-export-komplet-ucty";
let n=0,s=0;
for(const f of fs.readdirSync(dir).filter(x=>x.endsWith(".csv"))){
  for(const t of parseAirBankCSV(fs.readFileSync(path.join(dir,f),"utf-8"))){ n++; s+=t.amount; }
}
console.log("CSV pohybů:",n,"| Σ amount:",Math.round(s));
'
```
Expected: `CSV pohybů: 1012 | Σ amount: -36783` – musí odpovídat `verifikace.transactions` a `verifikace.net` z kroku 3 (tolerance zaokrouhlení ±2 Kč).

- [ ] **Step 5: Pokud cokoliv nesedí – STOP**

Neprováděj ostrý běh. Zaznamenej rozdíl, vrať se k Task 2 (pravidla) nebo Task 3 (orchestrátor). Dry-run je bezpečný (ROLLBACK), opakuj dokud verifikace nesedí.

- [ ] **Step 6: Úklid**

```bash
rm -f /tmp/proddb.b64 /tmp/rebuild-test.db /tmp/rebuild-test.db-wal /tmp/rebuild-test.db-shm
```

- [ ] **Step 7: Commit (jen pokud byly opravy v seed/rules/rebuild)**

```bash
git add -A scripts/
git commit -m "fix: doladění pravidel/seedu dle dry-run verifikace"
```

---

## Task 5: Uživatelský review reportu dry-run

**Files:** žádné

- [ ] **Step 1: Předlož uživateli JSON report z Task 4 / Step 3**

Zobraz: počty, net, prevody, a `dle kategorie` rozpad. Explicitně se zeptej:
„Sedí počty a rozpad transakcí dle kategorií? Spustit ostrý běh na produkci?"

- [ ] **Step 2: Čekej na schválení**

Bez explicitního „ano, spusť na prod" NEPOKRAČUJ na Task 6. Tohle je destruktivní operace na produkci (wipe všech tabulek), proto vyžaduje výslovné potvrzení nad rámec původního schválení specu.

---

## Task 6: Ostrý běh na produkci

**Files:** žádné (operační)

Předpoklad: schválení z Task 5.

- [ ] **Step 1: Nahraj scripts/ bundle na prod (base64 v argv, ne stdin)**

```bash
cd /Users/tomas/app-spendex
tar -czf /tmp/rebuild-bundle.tar.gz scripts/seed scripts/lib scripts/rebuild.cjs src/utils/csvParser.js
rm -f /tmp/rb_*
base64 -i /tmp/rebuild-bundle.tar.gz | split -b 16k - /tmp/rb_
railway ssh --service app-spendex --environment production "rm -f /tmp/rb.b64; echo cleared" 2>&1 | tail -1
for c in /tmp/rb_*; do
  CH=$(cat "$c")
  railway ssh --service app-spendex --environment production "echo '$CH' >> /tmp/rb.b64 && wc -c < /tmp/rb.b64" 2>&1 | tail -1
done
```
Pozn.: base64 abeceda neobsahuje apostrof → single-quote wrap v argv je bezpečný. `railway ssh` nepřenáší stdin, proto chunky v argv.

- [ ] **Step 2: Rozbal na prod do /app (kvůli node_modules a require ../src)**

```bash
railway ssh --service app-spendex --environment production "
  cd /app && base64 -d /tmp/rb.b64 > /tmp/rb.tgz &&
  tar -xzf /tmp/rb.tgz -C /app &&
  ls scripts/seed scripts/lib scripts/rebuild.cjs && echo EXTRACTED
" 2>&1 | tail -5
```
Expected: výpis souborů + `EXTRACTED`. (Tar přepíše `/app/scripts/*` a `/app/src/utils/csvParser.js` aktuální verzí – shodná s gitem.)

- [ ] **Step 3: Dry-run na prod (ověření v prod prostředí, stále ROLLBACK)**

```bash
railway ssh --service app-spendex --environment production "
  cd /app && DB_PATH=/data/data.db CSV_DIR=/tmp/csv node scripts/rebuild.cjs
" 2>&1 | tail -40
```
Pozn.: CSV musí být na prod v `/tmp/csv`. Nahraj je stejným chunk postupem jako Step 1 (bundle `scripts/` i CSV lze spojit do jednoho tar). Expected: `🧪 ROLLBACK` + report stejných čísel jako lokální dry-run (Task 4).

- [ ] **Step 4: Ostrý běh s CONFIRM=1**

```bash
railway ssh --service app-spendex --environment production "
  cd /app && DB_PATH=/data/data.db CSV_DIR=/tmp/csv CONFIRM=1 node scripts/rebuild.cjs
" 2>&1 | tail -45
```
Expected: `📦 Záloha: /data/backup-rebuild-<ts>.db`, `✅ COMMIT (ostrý běh)`, report s `verifikace.dead_category_fk: 0`, categories 24, accounts 10, transactions ≈1012.

- [ ] **Step 5: Nezávislá post-verifikace (čtení z prod DB)**

```bash
railway ssh --service app-spendex --environment production "cd /app && node -e \"
const d=require('better-sqlite3')('/data/data.db',{readonly:true});
const dup=d.prepare('SELECT COUNT(*) n FROM (SELECT name FROM categories WHERE user_id=1 GROUP BY name HAVING COUNT(*)>1)').get().n;
const c=d.prepare('SELECT COUNT(*) n FROM categories WHERE user_id=1').get().n;
const t=d.prepare('SELECT COUNT(*) n, ROUND(SUM(amount)) net FROM transactions WHERE user_id=1').get();
const {getPeriodDates}=require('/app/src/utils/period');
let out=[];
for(const p of ['2026-02','2026-03','2026-04','2026-05']){
  const {start,end}=getPeriodDates(1,p);
  const r=d.prepare(\\\"SELECT COUNT(*) n, ROUND(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END)) sp FROM transactions t WHERE user_id=1 AND date>=? AND date<=? AND (account_id IS NULL OR EXISTS(SELECT 1 FROM accounts a WHERE a.id=t.account_id AND a.role='spending'))\\\").get(start,end);
  out.push(p+': '+r.n+'tx/'+r.sp+'Kc');
}
console.log('dup_names:',dup,'| categories:',c,'| tx:',t.n,'| net:',t.net);
console.log(out.join('  '));
\"" 2>&1 | tail -3
```
Expected: `dup_names: 0`, `categories: 24`, `tx` ≈1012, `net` ≈ -36783, a nenulové spending částky per období.

- [ ] **Step 6: Úklid prod helperů (zálohu ponech)**

```bash
railway ssh --service app-spendex --environment production "rm -f /tmp/rb.b64 /tmp/rb.tgz; rm -rf /tmp/csv; ls /data/backup-rebuild-*.db" 2>&1 | tail -1
rm -f /tmp/rb_* /tmp/rebuild-bundle.tar.gz
```

---

## Task 7: Commit + push + úklid

- [ ] **Step 1: Ověř git stav**

Run: `git status --short`
Expected: čisté `scripts/` (vše commitnuté v Tasks 1–4); spec/plan commitnuté dříve.

- [ ] **Step 2: Push na staging**

```bash
git push origin staging
```

- [ ] **Step 3: Hlášení uživateli**

Shrň: verze (z pre-commit hooku), výsledky post-verifikace (Task 6/Step 5), umístění zálohy `/data/backup-rebuild-<ts>.db`. Připomeň, že produkce je čistá; nepushuj do `main` bez výslovného „push do prod".

---

## Self-Review (provedeno autorem plánu)

**Spec coverage:**
- §2 architektura → Task 1–3 (seed/, lib/, rebuild.cjs) ✓
- §3 taxonomie 24 kat. → Task 1 Step 1 + seed.test ✓
- §4 pravidla L0–L3 + precedence → Task 2 (rules.js, apply-rules.js, 10 testů pokrývají L0/L1/L2/L3/fallback/normalizaci) ✓
- §5 tok (záloha/wipe/seed/import/verifikace/dry-run) → Task 3 + Task 6 ✓
- §6 zachovaná data (budgets/fixed/annual/income) → Task 1 Steps 3–6 ✓
- §7 testy (unit + integrační dry-run) → Task 2 + Task 4 ✓
- §8 mimo rozsah (tracker, admin UI) → nezahrnuto záměrně ✓
- §9 rizika (záloha, dry-run default, atomická txn) → Task 3 (VACUUM jen s CONFIRM, BEGIN/ROLLBACK), Task 5 gate ✓

**Placeholder scan:** žádné TBD/TODO; veškerý kód i příkazy konkrétní.

**Type consistency:** `applyRules(tx, account, rules)` signatura shodná v apply-rules.js, testech i rebuild.cjs. Klíče `rules.*` (ownAccountNumbers, accountRules, abCategoryMap, textOverrides, internalTransferCategory, fallbackCategory) konzistentní mezi rules.js a apply-rules.js. Názvy kategorií v budgets.js/annual.js/rules.js jsou podmnožinou categories.js (validuje seed.test.js Step 7 + `needCat()` v rebuild.cjs vyhodí chybu při neshodě).

**Známé omezení:** Hrubé mapování AB kategorií se doladí iterativně přidáním `textOverrides` po review dry-run reportu (Task 5) – návrh to umožňuje bez schématických změn (spec §4, §9).
