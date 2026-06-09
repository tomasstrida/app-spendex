# Textová pravidla kategorizace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Umožnit uživateli spravovat textová kategorizační pravidla (pattern → kategorie) v aplikaci místo zadrátovaného seed souboru.

**Architecture:** Oživit existující tabulku `category_rules` (rozšířenou o `amount_*` sloupce). Runtime kategorizace (`emailIngest.js`, `import.js`) přestane brát `textOverrides` ze seedu a vezme je z DB přes nový helper `loadUserRules`. Seed se jednorázově idempotentně migruje do DB při startu. CRUD endpointy `/api/rules` + nová frontend stránka „Pravidla". Pravidla platí jen pro nově importované transakce.

**Tech Stack:** Node.js + Express, better-sqlite3, React + Vite, `node:test`.

Spec: `docs/superpowers/specs/2026-06-09-textova-pravidla-kategorizace-design.md`

---

### Task 1: Schema — rozšíření `category_rules` + seed migrace

**Files:**
- Modify: `src/db/schema.js` (migrations pole ~ř.283, a nová seed sekce po migrations loop ~ř.307)

- [ ] **Step 1: Přidat ALTER migrace pro amount sloupce**

V `src/db/schema.js` do pole `migrations` (před `for (const sql of migrations)`) přidat dva řádky:

```js
    'ALTER TABLE category_rules ADD COLUMN amount_max_abs REAL',
    'ALTER TABLE category_rules ADD COLUMN amount_min_abs REAL',
```

- [ ] **Step 2: Přidat idempotentní seed migraci po migrations loopu**

Na začátku `src/db/schema.js` přidat require (k ostatním requirům nahoře souboru):

```js
const seedRules = require('../../scripts/seed/rules');
```

Hned ZA blokem `for (const sql of migrations) { ... }` (musí běžet po ALTER) přidat:

```js
  // Seed textových pravidel do category_rules pro uživatele, kteří ještě žádná nemají
  // (idempotentní — běží jen pro uživatele s prázdnou sadou pravidel).
  const usersWithoutRules = db.prepare(
    'SELECT id FROM users WHERE id NOT IN (SELECT DISTINCT user_id FROM category_rules)'
  ).all();
  if (usersWithoutRules.length > 0) {
    const catByName = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?');
    const insRule = db.prepare(
      'INSERT INTO category_rules (user_id, category_id, pattern, amount_max_abs, amount_min_abs) VALUES (?, ?, ?, ?, ?)'
    );
    for (const u of usersWithoutRules) {
      for (const o of seedRules.textOverrides) {
        const cat = catByName.get(u.id, o.category);
        if (cat) insRule.run(u.id, cat.id, o.pattern, o.amount_max_abs ?? null, o.amount_min_abs ?? null);
      }
    }
  }
```

- [ ] **Step 3: Ověřit, že celá testovací sada pořád běží (schema se aplikuje při každém initSchema)**

Run: `node --test 'src/**/*.test.js' 2>&1 | tail -10`
Expected: stejný počet pass jako před změnou, 0 fail (existující testy netestují textOverrides v emailIngest).

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.js
git commit -m "feat(rules): schema category_rules + amount sloupce + seed migrace"
```

---

### Task 2: Helper `loadUserRules`

**Files:**
- Create: `src/utils/load-user-rules.js`
- Test: `src/utils/load-user-rules.test.js`

- [ ] **Step 1: Napsat failing test**

`src/utils/load-user-rules.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-lur-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection', '../db/schema']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return db;
}

test('loadUserRules: tvar, mapování kategorie a řazení (amount podmínky první)', () => {
  const db = freshDb();
  const loadUserRules = require('./load-user-rules');
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (10, 1, 'Restaurace a kávičky'), (11, 1, 'Sport')").run();
  // bez amount (vloženo první → vyšší id by bylo později)
  db.prepare("INSERT INTO category_rules (id, user_id, category_id, pattern) VALUES (1, 1, 11, 'MAX FITNESS')").run();
  // s amount podmínkou (vloženo druhé, ale musí být PRVNÍ ve výstupu)
  db.prepare("INSERT INTO category_rules (id, user_id, category_id, pattern, amount_max_abs) VALUES (2, 1, 10, 'SHELL', 200)").run();

  const out = loadUserRules(db, 1);
  assert.equal(out.length, 2);
  // amount-pravidlo první
  assert.deepEqual(out[0], { pattern: 'SHELL', category: 'Restaurace a kávičky', amount_max_abs: 200 });
  // bez amount druhé, bez amount klíčů
  assert.deepEqual(out[1], { pattern: 'MAX FITNESS', category: 'Sport' });
});

test('loadUserRules: pravidlo na smazanou kategorii se nezobrazí (JOIN), izolace usera', () => {
  const db = freshDb();
  const loadUserRules = require('./load-user-rules');
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@x'), (2, 'b@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (10, 1, 'Sport')").run();
  db.prepare("INSERT INTO category_rules (user_id, category_id, pattern) VALUES (1, 10, 'A'), (2, 999, 'B')").run();
  const out = loadUserRules(db, 2);
  assert.equal(out.length, 0); // user 2 má pravidlo na neexistující kategorii 999 → JOIN ho vyřadí
});
```

- [ ] **Step 2: Spustit test, ověřit selhání**

Run: `node --test src/utils/load-user-rules.test.js`
Expected: FAIL — `Cannot find module './load-user-rules'`.

- [ ] **Step 3: Implementovat helper**

`src/utils/load-user-rules.js`:

```js
'use strict';
// Načte textová kategorizační pravidla uživatele z DB ve tvaru, který očekává
// applyRules v `rules.textOverrides`. Pravidla s podmínkou na částku jdou první
// (specifičtější výjimky jako „benzinky < 200"), pak podle pořadí vložení.
function loadUserRules(db, userId) {
  const rows = db.prepare(`
    SELECT r.pattern, r.amount_max_abs, r.amount_min_abs, c.name AS category
    FROM category_rules r
    JOIN categories c ON c.id = r.category_id
    WHERE r.user_id = ?
    ORDER BY (r.amount_max_abs IS NOT NULL OR r.amount_min_abs IS NOT NULL) DESC, r.id ASC
  `).all(userId);
  return rows.map(r => {
    const o = { pattern: r.pattern, category: r.category };
    if (r.amount_max_abs != null) o.amount_max_abs = r.amount_max_abs;
    if (r.amount_min_abs != null) o.amount_min_abs = r.amount_min_abs;
    return o;
  });
}
module.exports = loadUserRules;
```

- [ ] **Step 4: Spustit test, ověřit úspěch**

Run: `node --test src/utils/load-user-rules.test.js`
Expected: PASS (2 testy).

- [ ] **Step 5: Commit**

```bash
git add src/utils/load-user-rules.js src/utils/load-user-rules.test.js
git commit -m "feat(rules): helper loadUserRules (DB → textOverrides)"
```

---

### Task 3: Napojení `emailIngest.js` na DB-pravidla

**Files:**
- Modify: `src/services/emailIngest.js` (funkce `categorize`, ř.21-27)
- Test: `src/services/emailIngest.test.js` (přidat 1 test)

- [ ] **Step 1: Napsat failing test (DB pravidlo se aplikuje při e-mailovém importu)**

Do `src/services/emailIngest.test.js` přidat nový test (struktura podle stávajících v souboru — vytvoří temp DB, usera s e-mailem, účet, kategorie). Vzor existujících testů v souboru používá `ingestEmail(db, { userEmail, text })`. Přidat:

```js
test('e-mailový import: DB textové pravidlo zařadí kartovou platbu (ne fallback)', () => {
  const { db, ingestEmail } = setup(); // setup() = stávající helper v souboru (zkopíruj jeho použití z okolních testů)
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (20, 1, 'Restaurace a kávičky')").run();
  db.prepare("INSERT INTO category_rules (user_id, category_id, pattern) VALUES (1, 20, 'ZIZKAVARNA')").run();
  const mail = [
    'zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 163,90 CZK.',
    'Platba kartou (nezaúčtováno) v ZIZKAVARNA, PRAHA, 10',
    'Karta: 516844******6062',
    'Datum provedení: 09.06.2026',
    'Kód transakce: 26926404233',
  ].join('\n');
  const r = ingestEmail(db, { userEmail: 'o@x', text: mail });
  // karta 6062 musí být přiřazena uživateli, jinak skončí v awaiting_card — viz pozn. níže
  assert.equal(r.status, 'imported');
  const tx = db.prepare("SELECT category_id FROM transactions WHERE external_id LIKE '26926404233%'").get();
  assert.equal(tx.category_id, 20); // Restaurace a kávičky přes DB pravidlo
});
```

POZNÁMKA pro implementátora: zkontroluj, jak okolní testy zakládají uživatele/účet a jak řeší `cards`/`awaiting_card` routing (platba kartou s `card_last4`). Pokud je v DB jen solo uživatel (bez `household_members`), karta se auto-přiřadí vlastníkovi a tx se importuje — viz `emailIngest.js:77-82`. Použij stejný setup jako test „awaiting_card" v souboru, ale BEZ scénáře neznámé karty (tj. solo user). Uprav `setup()`/inserty tak, aby test odpovídal realitě souboru — nehádej jméno helperu, použij to, co soubor reálně má.

- [ ] **Step 2: Spustit test, ověřit selhání**

Run: `node --test src/services/emailIngest.test.js`
Expected: FAIL — `tx.category_id` je `null`/Ostatní místo 20 (categorize zatím čte jen seedRules, kde „ZIZKAVARNA" pattern není).

- [ ] **Step 3: Napojit loadUserRules v `categorize`**

V `src/services/emailIngest.js` nahoře přidat require:

```js
const loadUserRules = require('../utils/load-user-rules');
```

Funkci `categorize` (ř.21-27) upravit — předat `userId` a sestavit rules s DB textOverrides. Aktuální signatura: `categorize(db, userId, tx, account)`. Tělo změnit z:

```js
  const catName = applyRules(tx, account ? { account_number: account.account_number } : null, seedRules);
```

na:

```js
  const rules = { ...seedRules, textOverrides: loadUserRules(db, userId) };
  const catName = applyRules(tx, account ? { account_number: account.account_number } : null, rules);
```

(Volající `classifyAndStore` a `releaseHeldCard` už `categorize(db, userId, ...)` volají správně — beze změny.)

- [ ] **Step 4: Spustit testy, ověřit úspěch**

Run: `node --test src/services/emailIngest.test.js`
Expected: PASS (všechny stávající + nový).

- [ ] **Step 5: Commit**

```bash
git add src/services/emailIngest.js src/services/emailIngest.test.js
git commit -m "feat(rules): e-mailový import čte textová pravidla z DB"
```

---

### Task 4: Napojení `import.js` (CSV) na DB-pravidla

**Files:**
- Modify: `src/routes/import.js` (effectiveRules, ř.126-129)

- [ ] **Step 1: Přidat require helperu**

V `src/routes/import.js` k ostatním requirům nahoře:

```js
const loadUserRules = require('../utils/load-user-rules');
```

- [ ] **Step 2: Použít DB textOverrides v effectiveRules**

Blok `effectiveRules` (ř.126-129) změnit z:

```js
  const effectiveRules = {
    ...seedRules,
    abCategoryMap: { ...seedRules.abCategoryMap, ...userMapName },
  };
```

na:

```js
  const effectiveRules = {
    ...seedRules,
    textOverrides: loadUserRules(db, req.dataUserId),
    abCategoryMap: { ...seedRules.abCategoryMap, ...userMapName },
  };
```

- [ ] **Step 3: Ověřit, že testy importu pořád procházejí**

Run: `node --test 'src/**/*.test.js' 2>&1 | tail -8`
Expected: 0 fail.

- [ ] **Step 4: Commit**

```bash
git add src/routes/import.js
git commit -m "feat(rules): CSV import čte textová pravidla z DB"
```

---

### Task 5: CRUD router `/api/rules`

**Files:**
- Create: `src/routes/rules.js`
- Modify: `src/index.js` (mount, k ostatním `app.use('/api/...')`)
- Test: `src/routes/rules.test.js`

- [ ] **Step 1: Napsat failing test (CRUD + ownership)**

`src/routes/rules.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

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

test('rules CRUD: create, list, patch, delete', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  // create
  let res = await fetch(`${base}/api/rules`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'ZIZKAVARNA', category_id:10 }) });
  assert.equal(res.status, 200);
  const created = await res.json();
  assert.equal(created.pattern, 'ZIZKAVARNA');
  // list
  res = await fetch(`${base}/api/rules`); const list = await res.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].category_name, 'Sport');
  // patch
  res = await fetch(`${base}/api/rules/${created.id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'ZIZKA', category_id:10, amount_max_abs:300 }) });
  assert.equal(res.status, 200);
  const patched = await res.json();
  assert.equal(patched.pattern, 'ZIZKA');
  assert.equal(patched.amount_max_abs, 300);
  // delete
  res = await fetch(`${base}/api/rules/${created.id}`, { method:'DELETE' });
  assert.equal(res.status, 200);
  res = await fetch(`${base}/api/rules`); assert.equal((await res.json()).length, 0);
  server.close();
});

test('rules: nelze přiřadit cizí kategorii', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/rules`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'X', category_id:11 }) }); // 11 patří userovi 2
  assert.equal(res.status, 400);
  server.close();
});

test('rules: prázdný pattern odmítnut', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/rules`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ pattern:'   ', category_id:10 }) });
  assert.equal(res.status, 400);
  server.close();
});
```

- [ ] **Step 2: Spustit test, ověřit selhání**

Run: `node --test src/routes/rules.test.js`
Expected: FAIL — `Cannot find module './rules'`.

- [ ] **Step 3: Implementovat router**

`src/routes/rules.js`:

```js
const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

// Ověří, že kategorie patří uživateli (vrací true/false)
function ownsCategory(userId, categoryId) {
  return !!db.prepare('SELECT 1 FROM categories WHERE id = ? AND user_id = ?').get(categoryId, userId);
}

// Volitelná částka: '' / undefined → null; jinak kladné číslo nebo 400
function parseAmount(v) {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

// GET /api/rules
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.pattern, r.category_id, r.amount_max_abs, r.amount_min_abs,
           c.name AS category_name, c.color AS category_color
    FROM category_rules r
    JOIN categories c ON c.id = r.category_id
    WHERE r.user_id = ?
    ORDER BY (r.amount_max_abs IS NOT NULL OR r.amount_min_abs IS NOT NULL) DESC, r.id ASC
  `).all(req.dataUserId);
  res.json(rows);
});

// POST /api/rules
router.post('/', requireAuth, (req, res) => {
  const pattern = (req.body.pattern || '').trim();
  const categoryId = parseInt(req.body.category_id);
  if (!pattern || !categoryId) return res.status(400).json({ error: 'Vyplň text a kategorii.' });
  if (!ownsCategory(req.dataUserId, categoryId)) return res.status(400).json({ error: 'Neplatná kategorie.' });
  const max = parseAmount(req.body.amount_max_abs);
  const min = parseAmount(req.body.amount_min_abs);
  if (!max.ok || !min.ok) return res.status(400).json({ error: 'Neplatná částka.' });
  const info = db.prepare(
    'INSERT INTO category_rules (user_id, category_id, pattern, amount_max_abs, amount_min_abs) VALUES (?, ?, ?, ?, ?)'
  ).run(req.dataUserId, categoryId, pattern, max.value, min.value);
  const row = db.prepare('SELECT * FROM category_rules WHERE id = ?').get(info.lastInsertRowid);
  res.json(row);
});

// PATCH /api/rules/:id
router.patch('/:id', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM category_rules WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!existing) return res.status(404).json({ error: 'Pravidlo nenalezeno.' });
  const pattern = (req.body.pattern ?? existing.pattern).trim();
  const categoryId = req.body.category_id != null ? parseInt(req.body.category_id) : existing.category_id;
  if (!pattern || !categoryId) return res.status(400).json({ error: 'Vyplň text a kategorii.' });
  if (!ownsCategory(req.dataUserId, categoryId)) return res.status(400).json({ error: 'Neplatná kategorie.' });
  const max = parseAmount(req.body.amount_max_abs);
  const min = parseAmount(req.body.amount_min_abs);
  if (!max.ok || !min.ok) return res.status(400).json({ error: 'Neplatná částka.' });
  db.prepare('UPDATE category_rules SET pattern = ?, category_id = ?, amount_max_abs = ?, amount_min_abs = ? WHERE id = ?')
    .run(pattern, categoryId, max.value, min.value, existing.id);
  res.json(db.prepare('SELECT * FROM category_rules WHERE id = ?').get(existing.id));
});

// DELETE /api/rules/:id
router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id FROM category_rules WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Pravidlo nenalezeno.' });
  db.prepare('DELETE FROM category_rules WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
```

POZNÁMKA: `PATCH` v testu posílá `amount_max_abs:300` a očekává ho zpět; když pole v body chybí, `parseAmount(undefined)` → null (pole se vynuluje). To je vědomé chování (úprava = plný stav formuláře).

- [ ] **Step 4: Mount router v `src/index.js`**

K blokům `app.use('/api/...')` (vedle `accounts`) přidat:

```js
app.use('/api/rules', require('./routes/rules'));
```

- [ ] **Step 5: Spustit test, ověřit úspěch**

Run: `node --test src/routes/rules.test.js`
Expected: PASS (3 testy).

- [ ] **Step 6: Commit**

```bash
git add src/routes/rules.js src/routes/rules.test.js src/index.js
git commit -m "feat(rules): CRUD endpointy /api/rules"
```

---

### Task 6: Frontend — stránka „Pravidla"

**Files:**
- Create: `client/src/pages/RulesPage.jsx`
- Modify: `client/src/App.jsx` (import + Route)
- Modify: `client/src/components/Sidebar.jsx` (položka menu + import ikony)
- Modify: `client/src/i18n.js` (texty)

- [ ] **Step 1: Přidat i18n texty**

V `client/src/i18n.js` do objektu `nav` přidat klíč (vedle `categories`):

```js
    rules: 'Pravidla',
```

- [ ] **Step 2: Vytvořit stránku**

`client/src/pages/RulesPage.jsx`:

```jsx
import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import Layout from '../components/Layout';

const EMPTY = { pattern: '', category_id: '', amount_max_abs: '', amount_min_abs: '' };

export default function RulesPage() {
  const [rules, setRules] = useState([]);
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [adv, setAdv] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const [r, c] = await Promise.all([fetch('/api/rules'), fetch('/api/categories')]);
    setRules(await r.json());
    setCats(await c.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  function reset() { setForm(EMPTY); setEditId(null); setAdv(false); setErr(''); }

  async function save() {
    setErr('');
    const body = {
      pattern: form.pattern.trim(),
      category_id: form.category_id ? Number(form.category_id) : null,
      amount_max_abs: form.amount_max_abs === '' ? null : Number(form.amount_max_abs),
      amount_min_abs: form.amount_min_abs === '' ? null : Number(form.amount_min_abs),
    };
    const url = editId ? `/api/rules/${editId}` : '/api/rules';
    const res = await fetch(url, { method: editId ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { setErr((await res.json()).error || 'Chyba.'); return; }
    reset(); load();
  }

  function startEdit(r) {
    setEditId(r.id);
    setForm({
      pattern: r.pattern, category_id: String(r.category_id),
      amount_max_abs: r.amount_max_abs ?? '', amount_min_abs: r.amount_min_abs ?? '',
    });
    setAdv(r.amount_max_abs != null || r.amount_min_abs != null);
  }

  async function remove(id) {
    if (!confirm('Smazat pravidlo?')) return;
    await fetch(`/api/rules/${id}`, { method: 'DELETE' });
    if (editId === id) reset();
    load();
  }

  const catName = id => cats.find(c => c.id === id)?.name || '—';
  const catColor = id => cats.find(c => c.id === id)?.color || '#888';

  return (
    <Layout>
      <h1 className="page-title">Pravidla</h1>
      <p className="text-muted" style={{ marginBottom: 16, fontSize: 13 }}>
        Když popis, poznámka nebo obchodní místo platby obsahuje zadaný text, přiřadí se kategorie.
        Pravidla se uplatní na nově importované platby.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 2, minWidth: 200, margin: 0 }}>
            <label className="form-label">Text v platbě</label>
            <input className="input" value={form.pattern} placeholder="např. ZIZKAVARNA"
              onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))} />
          </div>
          <div className="form-group" style={{ flex: 2, minWidth: 200, margin: 0 }}>
            <label className="form-label">Kategorie</label>
            <select className="input" value={form.category_id}
              onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
              <option value="">— vyber —</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={save}>
            {editId ? <><Check size={14} /> Uložit</> : <><Plus size={14} /> Přidat</>}
          </button>
          {editId && <button className="btn btn-ghost" onClick={reset}><X size={14} /> Zrušit</button>}
        </div>
        <button className="btn btn-ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={() => setAdv(a => !a)}>
          {adv ? 'Skrýt' : 'Pokročilé'} (omezení částkou)
        </button>
        {adv && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: 11 }}>Jen do částky (Kč)</label>
              <input className="input" type="number" min="0" value={form.amount_max_abs} style={{ maxWidth: 140 }}
                onChange={e => setForm(f => ({ ...f, amount_max_abs: e.target.value }))} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: 11 }}>Od částky (Kč)</label>
              <input className="input" type="number" min="0" value={form.amount_min_abs} style={{ maxWidth: 140 }}
                onChange={e => setForm(f => ({ ...f, amount_min_abs: e.target.value }))} />
            </div>
          </div>
        )}
        {err && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{err}</div>}
      </div>

      <div className="card">
        {rules.length === 0 && <div className="text-muted" style={{ fontSize: 13 }}>Zatím žádná pravidla.</div>}
        {rules.map(r => (
          <div key={r.id} className="rule-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ flex: 2, fontWeight: 500 }}>{r.pattern}</span>
            <span style={{ flex: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.category_color || catColor(r.category_id) }} />
              {r.category_name || catName(r.category_id)}
            </span>
            <span className="text-muted" style={{ flex: 1, fontSize: 12 }}>
              {r.amount_max_abs != null && `≤ ${r.amount_max_abs} Kč`}
              {r.amount_min_abs != null && ` ≥ ${r.amount_min_abs} Kč`}
            </span>
            <button className="btn btn-ghost btn-icon" onClick={() => startEdit(r)} title="Upravit"><Pencil size={14} /></button>
            <button className="btn btn-ghost btn-icon" onClick={() => remove(r.id)} title="Smazat"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </Layout>
  );
}
```

- [ ] **Step 3: Přidat routu v `App.jsx`**

Import (k ostatním stránkám):

```jsx
import RulesPage from './pages/RulesPage';
```

Route (za `/categories`):

```jsx
            <Route path="/rules"        element={<R el={<RulesPage />} />} />
```

- [ ] **Step 4: Přidat položku do `Sidebar.jsx`**

Do importu ikon z `lucide-react` přidat `ListFilter` (pokud už není importovaná jiná vhodná). Do skupiny `sectionConfig` (vedle `categories`) přidat:

```jsx
      { to: '/rules', icon: ListFilter, label: t.nav.rules },
```

- [ ] **Step 5: Build frontendu, ověřit že prochází**

Run: `cd client && npm run build 2>&1 | tail -5`
Expected: `✓ built` bez chyb.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/RulesPage.jsx client/src/App.jsx client/src/components/Sidebar.jsx client/src/i18n.js
git commit -m "feat(rules): frontend stránka Pravidla"
```

---

### Task 7: Finální ověření a deploy

- [ ] **Step 1: Spustit celou testovací sadu**

Run: `node --test 'src/**/*.test.js' 2>&1 | tail -10`
Expected: 0 fail.

- [ ] **Step 2: Build klienta**

Run: `cd client && npm run build 2>&1 | tail -5`
Expected: `✓ built`.

- [ ] **Step 3: Push na staging**

```bash
git push origin staging
```

Ověřit na staging: nová stránka Pravidla, seed pravidla se migrovala (seznam není prázdný pro existujícího usera), přidání pravidla, test e-mailové platby s novým patternem.

- [ ] **Step 4: Po odsouhlasení uživatelem — deploy do produkce** (dle workflow: merge staging→main).

POZNÁMKA: Na produkci po deployi seed migrace naplní `category_rules` pro Toma i Martina ze seedu. Ověřit, že každý vidí svá pravidla a že existující kategorizace funguje beze změny.

---

## Self-review

- **Spec coverage:** §1 datový model → Task 1; §2 backend čte z DB → Task 2/3/4; §3 migrace → Task 1 Step 2; §4 CRUD → Task 5; §5 frontend → Task 6; §6 testy → rozprostřeno (Task 2/3/5) + Task 7. Vše pokryto.
- **Placeholders:** žádné TBD; jediná „doplň podle souboru" poznámka je u Task 3 Step 1 (setup helper emailIngest testu) — vědomá, protože přesná struktura helperu závisí na existujícím souboru, který implementátor má před sebou; uveden přesný odkaz na řádky a chování.
- **Type consistency:** `loadUserRules(db, userId)` konzistentně; `category_rules` sloupce `amount_max_abs`/`amount_min_abs` stejné napříč Task 1/2/5/6; tvar `{ pattern, category, amount_max_abs? }` shodný s tím, co `apply-rules.js` čte (`o.pattern`, `o.category`, `o.amount_max_abs`, `o.amount_min_abs`).
