# Hledáč duplicitních transakcí — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Samostatná stránka „Duplicity", která kdykoli proskenuje DB uživatele, seskupí podezřelé duplicity ve dvou úrovních (Pravděpodobné / Možné) a umožní bezpečně vybrat a smazat, s pojistkou „ve skupině zůstane ≥1".

**Architecture:** Čistá detekční funkce v `src/utils/duplicates.js` (testovatelná nad tmp DB) → tenký `GET /api/transactions/duplicates` → nová `DuplicatesPage.jsx`. Mazání přes existující `DELETE /api/transactions {ids}`, rozšířený o opt-in pojistku `guardDuplicateGroups` (běžné mazání na Transakcích nedotčeno).

**Tech Stack:** Node.js + Express + better-sqlite3, `node:test` (`node --test`), React + Vite, lucide-react, react-router-dom.

**Spec:** `docs/superpowers/specs/2026-05-19-hledac-duplicit-design.md`

**Konvence:** testy `node:test` + tmp DB přes `process.env.DB_PATH` (vzor `src/utils/income.test.js`). Po každém tasku commit + push do `staging` (projektový workflow). Husky auto-bumpuje VERSION/package.json — očekávané.

---

### Task 1: Detekční util `src/utils/duplicates.js`

**Files:**
- Create: `src/utils/duplicates.js`
- Create: `src/utils/duplicates.test.js`

- [ ] **Step 1: Napsat failing testy**

Vytvoř `src/utils/duplicates.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-dup-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
}
function ins(db, row) {
  db.prepare(`INSERT INTO transactions
    (user_id, amount, currency, date, description, external_id, account_id, source)
    VALUES (@user_id,@amount,'CZK',@date,@description,@external_id,@account_id,'airbank')`).run(row);
}

test('probable: stejný rawRef + stejný účet (2×) → skupina; různé účty (interní převod) → NE', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'Hlavní')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (11,1,'Společný')").run();
  // import-dup: stejný rawRef 999, stejný účet 10 → probable
  ins(db,{user_id:1,amount:-100,date:'2026-04-01',description:'X',external_id:'999-1679014138',account_id:10});
  ins(db,{user_id:1,amount:-100,date:'2026-04-01',description:'X',external_id:'999',account_id:10});
  // interní převod: stejný rawRef 777, různé účty → NESMÍ být probable
  ins(db,{user_id:1,amount:-50,date:'2026-04-02',description:'Převod',external_id:'777-acc10',account_id:10});
  ins(db,{user_id:1,amount:50,date:'2026-04-02',description:'Převod',external_id:'777-acc11',account_id:11});

  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);

  assert.equal(r.probable.length, 1);
  assert.equal(r.probable[0].rows.length, 2);
  const ids = r.probable[0].rows.map(x => x.external_id).sort();
  assert.deepEqual(ids, ['999', '999-1679014138']);
});

test('possible: stejné date+description+amount+account (2×) → skupina; jiná částka → NE', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'Hlavní')").run();
  ins(db,{user_id:1,amount:-200,date:'2026-04-05',description:'Kafe',external_id:'a',account_id:10});
  ins(db,{user_id:1,amount:-200,date:'2026-04-05',description:'Kafe',external_id:'b',account_id:10});
  ins(db,{user_id:1,amount:-201,date:'2026-04-05',description:'Kafe',external_id:'c',account_id:10});

  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);

  assert.equal(r.possible.length, 1);
  assert.equal(r.possible[0].rows.length, 2);
  assert.equal(r.possible[0].rows.every(x => x.amount === -200), true);
});

test('izolace per user: cizí uživatel se nemíchá', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO users (id, email) VALUES (2,'c@d.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (20,2,'H')").run();
  ins(db,{user_id:1,amount:-1,date:'2026-04-01',description:'X',external_id:'5-10',account_id:10});
  ins(db,{user_id:2,amount:-1,date:'2026-04-01',description:'X',external_id:'5-20',account_id:20});
  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);
  assert.equal(r.probable.length, 0);
  assert.equal(r.possible.length, 0);
});

test('wouldEmptyDuplicateGroup: celá 2členná skupina v ids → true; 1 ze 2 → false; samostatný → false', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  ins(db,{user_id:1,amount:-9,date:'2026-04-01',description:'Dup',external_id:'p',account_id:10}); // id 1
  ins(db,{user_id:1,amount:-9,date:'2026-04-01',description:'Dup',external_id:'q',account_id:10}); // id 2
  ins(db,{user_id:1,amount:-3,date:'2026-04-02',description:'Solo',external_id:'r',account_id:10}); // id 3
  const { wouldEmptyDuplicateGroup } = require('./duplicates');
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [1, 2]), true);
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [1]), false);
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [3]), false);
  cleanup(db, tmp);
});
```

- [ ] **Step 2: Spustit, ověřit fail**

Run: `node --test src/utils/duplicates.test.js`
Expected: FAIL — `Cannot find module './duplicates'`

- [ ] **Step 3: Implementovat util**

Vytvoř `src/utils/duplicates.js`:

```js
'use strict';

/** rawRef = external_id bez koncového "-<čísloúčtu>" suffixu (legacy bez suffixu → celé) */
function rawRef(extId) {
  if (!extId) return null;
  const i = extId.lastIndexOf('-');
  return i > 0 ? extId.slice(0, i) : extId;
}

function pushTo(map, key, row) {
  let arr = map.get(key);
  if (!arr) { arr = []; map.set(key, arr); }
  arr.push(row);
}

/**
 * Najde podezřelé duplicity uživatele ve dvou úrovních.
 * probable: stejný rawRef + stejný account_id (interní převod = stejný rawRef
 *           na různých účtech → různé skupiny → nikdy spolu).
 * possible: stejné date + description + amount + account_id.
 * @returns {{ probable: {key:string,rows:object[]}[], possible: {...}[] }}
 */
function findDuplicates(db, userId) {
  const rows = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount, t.account_id, t.external_id,
           t.source, t.created_at, a.name AS account_name
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.user_id = ?
    ORDER BY t.id ASC
  `).all(userId);

  const prob = new Map();
  const poss = new Map();
  for (const r of rows) {
    const rr = rawRef(r.external_id);
    if (rr) pushTo(prob, `${rr}|${r.account_id}`, r);
    pushTo(poss, `${r.date}|${r.description}|${r.amount}|${r.account_id}`, r);
  }
  const toGroups = m => [...m.entries()]
    .filter(([, rs]) => rs.length > 1)
    .map(([key, rs]) => ({ key, rows: rs }))
    .sort((a, b) => (a.rows[0].date < b.rows[0].date ? 1 : a.rows[0].date > b.rows[0].date ? -1 : 0));
  return { probable: toGroups(prob), possible: toGroups(poss) };
}

/**
 * True, pokud by `ids` smazaly VŠECHNY řádky některé vícečlenné
 * possible-skupiny (date+description+amount+account_id). Skupina velikosti 1
 * (žádné duplo) vrací false → běžné mazání jednotlivin neblokuje.
 */
function wouldEmptyDuplicateGroup(db, userId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return false;
  const idSet = new Set(ids.map(Number));
  const ph = ids.map(() => '?').join(',');
  const delRows = db.prepare(
    `SELECT id, date, description, amount, account_id
     FROM transactions WHERE user_id = ? AND id IN (${ph})`
  ).all(userId, ...ids);

  const groupStmt = db.prepare(
    `SELECT id FROM transactions
     WHERE user_id = ? AND date = ? AND description = ? AND amount = ? AND account_id IS ?`
  );
  const seen = new Set();
  for (const r of delRows) {
    const sig = JSON.stringify([r.date, r.description, r.amount, r.account_id]);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const groupIds = groupStmt.all(userId, r.date, r.description, r.amount, r.account_id);
    if (groupIds.length > 1 && groupIds.every(g => idSet.has(g.id))) return true;
  }
  return false;
}

module.exports = { findDuplicates, wouldEmptyDuplicateGroup, rawRef };
```

- [ ] **Step 4: Spustit, ověřit pass**

Run: `node --test src/utils/duplicates.test.js`
Expected: PASS (4 testy)

- [ ] **Step 5: Commit + push**

```bash
git add src/utils/duplicates.js src/utils/duplicates.test.js
git commit -m "feat: detekce duplicit (findDuplicates + wouldEmptyDuplicateGroup)"
git push origin staging
```

---

### Task 2: API — GET /duplicates + pojistka v bulk delete

**Files:**
- Modify: `src/routes/transactions.js`

- [ ] **Step 1: Přidat GET /duplicates**

V `src/routes/transactions.js` nahoře k ostatním require přidej:

```js
const { findDuplicates, wouldEmptyDuplicateGroup } = require('../utils/duplicates');
```

Bezprostředně ZA existující `router.get('/', requireAuth, ...)` handler (jeho uzavírací `});`) přidej:

```js
// GET /api/transactions/duplicates
router.get('/duplicates', requireAuth, (req, res) => {
  res.json(findDuplicates(db, req.user.id));
});
```

> Pozn.: žádný `GET '/:id'` v routeru neexistuje (jen `PATCH`/`DELETE` `/:id`), takže `/duplicates` se nestíní.

- [ ] **Step 2: Rozšířit bulk DELETE o opt-in pojistku**

Najdi handler `router.delete('/', requireAuth, writeLimiter, (req, res) => { ... })` (bulk delete podle `{ ids }`). Nahraď jeho tělo tak, aby přijal `guardDuplicateGroups`:

```js
// DELETE /api/transactions  body: { ids: [1,2,3], guardDuplicateGroups?: true }
router.delete('/', requireAuth, writeLimiter, (req, res) => {
  const { ids, guardDuplicateGroups } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Neplatná data.' });
  if (guardDuplicateGroups && wouldEmptyDuplicateGroup(db, req.user.id, ids)) {
    return res.status(400).json({ error: 'Ve skupině duplicit musí zůstat alespoň jedna transakce.' });
  }
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(
    `DELETE FROM transactions WHERE id IN (${placeholders}) AND user_id = ?`
  ).run(...ids, req.user.id);
  res.json({ deleted: result.changes });
});
```

(Ostatní handlery — `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id` — ponech beze změny. Bez flagu se chování bulk delete nemění → `TransactionsPage` nedotčen.)

- [ ] **Step 3: Ověřit načtení + regrese**

Run: `node -e "require('./src/routes/transactions.js'); console.log('ok')"`
Expected: `ok`

Run: `node --test src/utils/duplicates.test.js src/utils/income.test.js src/utils/fixed-expenses.test.js src/utils/recurring.test.js src/db/schema.test.js scripts/seed/seed.test.js`
Expected: vše PASS, 0 fail.

- [ ] **Step 4: Commit + push**

```bash
git add src/routes/transactions.js
git commit -m "feat: GET /api/transactions/duplicates + opt-in pojistka bulk delete"
git push origin staging
```

---

### Task 3: Wiring — i18n, route, sidebar

**Files:**
- Modify: `client/src/i18n.js`
- Modify: `client/src/App.jsx`
- Modify: `client/src/components/Sidebar.jsx`

- [ ] **Step 1: i18n — přidat nav label**

V `client/src/i18n.js` v objektu `nav: { ... }` přidej za `import: 'Import',` řádek:

```js
    duplicates: 'Duplicity',
```

(Výsledně `nav` obsahuje i `duplicates: 'Duplicity'`. Ostatní klíče beze změny.)

- [ ] **Step 2: App.jsx — import + routa**

V `client/src/App.jsx` přidej k importům stránek (za `import ReportPage from './pages/ReportPage';`):

```js
import DuplicatesPage from './pages/DuplicatesPage';
```

A mezi chráněné routy (za `<Route path="/import" element={<R el={<ImportPage />} />} />`) přidej:

```jsx
          <Route path="/duplicates"  element={<R el={<DuplicatesPage />} />} />
```

- [ ] **Step 3: Sidebar — ikona + položka**

V `client/src/components/Sidebar.jsx` přidej do importu z `lucide-react` (k `Upload,`) ikonu `CopyX,`. Pak do pole `navItems` přidej za řádek s `to: '/import'`:

```js
  { to: '/duplicates',   icon: CopyX,           label: t.nav.duplicates },
```

- [ ] **Step 4: Build ověření**

Run: `npm run build`
Expected: Vite build úspěšný, žádná chyba o `DuplicatesPage` (soubor zatím neexistuje → import selže). **Proto Task 3 NEcommituj samostatně** — přejdi rovnou na Task 4 a commitni je společně (Task 3 + 4), jinak by build na CI/Railway spadl.

> Záměrná mezitásková závislost: Task 3 wiring odkazuje na `DuplicatesPage` vytvořený v Tasku 4. Necommituj Task 3 samostatně.

---

### Task 4: Stránka `DuplicatesPage.jsx`

**Files:**
- Create: `client/src/pages/DuplicatesPage.jsx`

- [ ] **Step 1: Vytvořit komponentu**

Vytvoř `client/src/pages/DuplicatesPage.jsx`:

```jsx
import { useState, useEffect, useCallback } from 'react';
import { Trash2, RefreshCw } from 'lucide-react';
import Layout from '../components/Layout';
import { formatCurrency } from '../i18n';

function GroupCard({ group, selected, onToggle }) {
  const r0 = group.rows[0];
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
        {r0.date} · {formatCurrency(r0.amount)} · {r0.description} · {r0.account_name || '—'} · {group.rows.length}×
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {group.rows.map(row => (
          <label key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              className="tx-checkbox"
              checked={selected.has(row.id)}
              onChange={() => onToggle(row.id)}
            />
            <span style={{ flex: 1 }}>{row.date} · {row.description}</span>
            <span style={{ minWidth: 90, textAlign: 'right' }}>{formatCurrency(row.amount)}</span>
            <span className="text-muted" style={{ minWidth: 150, fontSize: 12 }}>{row.external_id || '—'}</span>
            <span className="text-muted" style={{ minWidth: 70, fontSize: 12 }}>{row.source || '—'}</span>
            <span className="text-muted" style={{ minWidth: 130, fontSize: 12 }}>{row.created_at || ''}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function DuplicatesPage() {
  const [data, setData] = useState({ probable: [], possible: [] });
  const [tab, setTab] = useState('probable');
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true); setError('');
    fetch('/api/transactions/duplicates')
      .then(r => r.json())
      .then(d => {
        const safe = { probable: d.probable || [], possible: d.possible || [] };
        setData(safe);
        // předvýběr: ve skupině zaškrtni všechny KROMĚ nejstaršího (min id)
        const pre = new Set();
        [...safe.probable, ...safe.possible].forEach(g => {
          const minId = Math.min(...g.rows.map(x => x.id));
          g.rows.forEach(x => { if (x.id !== minId) pre.add(x.id); });
        });
        setSelected(pre);
      })
      .catch(() => setError('Chyba načítání.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggle(id) {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  const groups = data[tab] || [];
  // vyber jen ids viditelná v aktuální záložce (aby smazání nezasáhlo skrytou)
  const visibleIds = new Set(groups.flatMap(g => g.rows.map(r => r.id)));
  const toDelete = [...selected].filter(id => visibleIds.has(id));

  async function handleDelete() {
    if (toDelete.length === 0) return;
    if (!confirm(`Smazat ${toDelete.length} transakcí? Akce je nevratná.`)) return;
    setDeleting(true); setError('');
    try {
      const r = await fetch('/api/transactions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: toDelete, guardDuplicateGroups: true }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Chyba mazání.'); return; }
      load();
    } catch { setError('Chyba připojení.'); }
    finally { setDeleting(false); }
  }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Duplicity</h1>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> Obnovit
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn btn-sm ${tab === 'probable' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('probable')}>
          Pravděpodobné ({data.probable.length})
        </button>
        <button className={`btn btn-sm ${tab === 'possible' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('possible')}>
          Možné ({data.possible.length})
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div className="page-loading">Načítání…</div>
      ) : groups.length === 0 ? (
        <p className="text-muted">Žádné duplicity 🎉</p>
      ) : (
        <>
          {groups.map(g => (
            <GroupCard key={g.key} group={g} selected={selected} onToggle={toggle} />
          ))}
          <div className="tx-bulk-bar" style={{ position: 'sticky', bottom: 0 }}>
            <span className="text-muted" style={{ fontSize: 13 }}>
              Vybráno k smazání: <strong style={{ color: 'var(--text)' }}>{toDelete.length}</strong>
            </span>
            <button className="btn btn-danger btn-sm" onClick={handleDelete}
              disabled={deleting || toDelete.length === 0}>
              <Trash2 size={14} /> {deleting ? 'Mažu…' : `Smazat ${toDelete.length}`}
            </button>
          </div>
        </>
      )}
    </Layout>
  );
}
```

> Pozn.: `Layout`, `formatCurrency`, třídy `card`/`tx-checkbox`/`tx-bulk-bar`/`btn`/`btn-danger`/`alert`/`page-header`/`page-title`/`page-loading`/`text-muted` jsou už v projektu (viz `TransactionsPage.jsx`/`ReportPage.jsx`). Pokud `btn-danger` neexistuje, použij `btn-ghost` se stejným efektem — ověř v `App.css` a přizpůsob.

- [ ] **Step 2: Build (Task 3 + 4 společně)**

Run: `npm run build`
Expected: Vite build úspěšný, 0 chyb. Žádná nevyřešená reference (`DuplicatesPage`, `CopyX`, `t.nav.duplicates`).

Pokud build hlásí chybějící `btn-danger` apod., to je runtime CSS, ne build error — build musí projít. Ověř `grep -n "btn-danger" client/src/App.css`; pokud chybí, v `DuplicatesPage.jsx` nahraď `btn-danger` za `btn-ghost`.

- [ ] **Step 3: Commit + push (Task 3 + 4)**

```bash
git add client/src/i18n.js client/src/App.jsx client/src/components/Sidebar.jsx client/src/pages/DuplicatesPage.jsx
git commit -m "feat: stránka Duplicity (hledáč + výběr + bezpečné mazání)"
git push origin staging
```

---

### Task 5: Integrační ověření

**Files:** žádné (ověření).

- [ ] **Step 1: Celá testová sada**

Run:
```bash
node --test src/utils/duplicates.test.js src/utils/income.test.js src/utils/fixed-expenses.test.js src/utils/externalId.test.js src/utils/recurring.test.js src/db/schema.test.js scripts/seed/seed.test.js
```
Expected: vše PASS, 0 fail.

- [ ] **Step 2: Smoke + build**

Run:
```bash
node -e "require('./src/routes/transactions.js'); require('./src/utils/duplicates'); console.log('ok')" && npm run build
```
Expected: `ok` + úspěšný Vite build.

- [ ] **Step 3: Shrnout uživateli**

Předej kontrolní seznam pro ruční ověření na staging:
1. V sidebaru je „Duplicity", stránka se načte.
2. Záložky Pravděpodobné/Možné s počty; prázdný stav „Žádné duplicity 🎉".
3. Předvýběr nechává nejstarší řádek skupiny.
4. Smazání vybraných funguje; pokus smazat celou skupinu (vše ve skupině) vrátí hlášku „Ve skupině duplicit musí zůstat alespoň jedna transakce." a nic nesmaže.
5. Běžné hromadné mazání na stránce Transakce není dotčené (žádná pojistka tam).

> Prod merge až na explicitní pokyn uživatele (projektový deploy-flow).

---

## Self-review

- **Spec coverage:** detekce dvou úrovní + interní-převod pravidlo → Task 1 (`findDuplicates`, klíč `rawRef|account_id`). Pojistka ≥1 opt-in flag → Task 1 (`wouldEmptyDuplicateGroup`) + Task 2 (flag v bulk delete). Read endpoint → Task 2. UI stránka, dvě záložky, předvýběr min id, confirm, znovupoužití bulk delete → Task 4. Sidebar/route/i18n → Task 3. Testy (interní převod NE, dup ANO, per-user izolace, pojistka) → Task 1. YAGNI (žádná role/audit) dodrženo. Vše pokryto.
- **Placeholder scan:** žádné TBD; veškerý kód kompletní; jediná podmíněnost (`btn-danger` fallback) má konkrétní ověřovací příkaz a náhradu.
- **Type/název konzistence:** `findDuplicates`→`{probable,possible}` s `{key,rows}`; `rows` mají `id,date,description,amount,account_id,external_id,source,created_at,account_name` (Task 1 SELECT) — stejné názvy konzumuje `DuplicatesPage` (Task 4). `wouldEmptyDuplicateGroup(db,userId,ids)` shodně Task 1 a Task 2. API tvar `{probable,possible}` shodně Task 2↔4. `guardDuplicateGroups` flag shodně Task 2 (server) a Task 4 (klient). `nav.duplicates` Task 3 i18n ↔ Sidebar.
- **Mezitásková závislost:** Task 3 (wiring) odkazuje na soubor z Tasku 4 → explicitně označeno „commitni Task 3+4 společně", aby staging build nespadl.
