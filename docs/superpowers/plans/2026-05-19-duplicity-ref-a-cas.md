# Duplicity: AirBank ref + čas transakce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** V řádku duplicity ukázat navíc AirBank ref číslo (odvozené přes `rawRef`) a čas transakce (`tx_time`), vedle stávajícího external_id a created_at, s legendou sloupců.

**Architecture:** Aditivní: `findDuplicates` doplní do řádků pole `ref` a `tx_time`; `DuplicatesPage` přidá dva sloupce + hlavičkovou legendu. Žádná změna grouping/pojistkové logiky ani API kontraktu (jen přidaná pole).

**Tech Stack:** Node.js + better-sqlite3, `node:test`, React + Vite.

**Spec:** `docs/superpowers/specs/2026-05-19-duplicity-ref-a-cas-design.md`

**Konvence:** `node --test`; po každém tasku commit + push do `staging`; Husky auto-bump VERSION/package.json je očekávaný.

---

### Task 1: Backend — `ref` + `tx_time` do řádků duplicit

**Files:**
- Modify: `src/utils/duplicates.js`
- Modify: `src/utils/duplicates.test.js`

- [ ] **Step 1: Napsat failing test**

Přidej na KONEC `src/utils/duplicates.test.js` (reuse stávajících helperů `freshDb`/`cleanup`/`ins` z hlavičky souboru — neredefinuj je):

```js
test('řádky duplicit mají ref (rawRef z external_id) a tx_time', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  db.prepare(`INSERT INTO transactions
    (user_id, amount, currency, date, description, external_id, account_id, source, tx_time)
    VALUES (1,-100,'CZK','2026-04-01','X','12345-1679014138',10,'airbank','01/04/2026 10:11:12')`).run();
  db.prepare(`INSERT INTO transactions
    (user_id, amount, currency, date, description, external_id, account_id, source, tx_time)
    VALUES (1,-100,'CZK','2026-04-01','X','12345',10,'airbank',NULL)`).run();

  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);

  assert.equal(r.possible.length, 1);
  const rows = r.possible[0].rows;
  assert.equal(rows.length, 2);
  // ref = rawRef(external_id): '12345-1679014138' → '12345'; '12345' → '12345'
  assert.deepEqual(rows.map(x => x.ref).sort(), ['12345', '12345']);
  // tx_time se propaguje (string nebo null)
  const times = rows.map(x => x.tx_time);
  assert.equal(times.includes('01/04/2026 10:11:12'), true);
  assert.equal(times.includes(null), true);
});
```

- [ ] **Step 2: Spustit, ověřit fail**

Run: `node --test src/utils/duplicates.test.js`
Expected: nový test FAIL (`rows[].ref` je `undefined` → `['12345','12345']` neodpovídá; nebo `tx_time` undefined). Ostatní testy PASS.

- [ ] **Step 3: Implementovat**

V `src/utils/duplicates.js`, ve funkci `findDuplicates`:

a) Do SELECT přidej `t.tx_time`:

```js
  const rows = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount, t.account_id, t.external_id,
           t.source, t.created_at, t.tx_time, a.name AS account_name
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.user_id = ?
    ORDER BY t.id ASC
  `).all(userId);
```

b) V cyklu `for (const r of rows) { ... }` přidej `ref` na řádek a využij ho pro `prob` klíč (nahrazuje stávající `const rr = rawRef(r.external_id);` blok):

```js
  for (const r of rows) {
    const rr = rawRef(r.external_id);
    r.ref = rr;
    if (rr) pushTo(prob, `${rr}|${r.account_id ?? null}`, r);
    pushTo(poss, `${r.date}|${r.description}|${r.amount}|${r.account_id ?? null}`, r);
  }
```

(Pouze přidání `r.ref = rr;`. `tx_time` je už na `r` díky rozšířenému SELECT. Žádná jiná logika se nemění — klíče, `toGroups`, `wouldEmptyDuplicateGroup` zůstávají.)

- [ ] **Step 4: Spustit, ověřit pass**

Run: `node --test src/utils/duplicates.test.js`
Expected: všechny testy (8 původních + 1 nový) PASS, 0 fail.

Regrese:
Run: `node --test src/utils/duplicates.test.js src/utils/income.test.js src/utils/fixed-expenses.test.js src/utils/recurring.test.js src/db/schema.test.js scripts/seed/seed.test.js`
Expected: 0 fail.

- [ ] **Step 5: Commit + push**

```bash
git add src/utils/duplicates.js src/utils/duplicates.test.js
git commit -m "feat: duplicity – ref (AirBank č.) + tx_time v řádcích"
git push origin staging
```

---

### Task 2: Frontend — sloupce AirBank ref + čas transakce + legenda

**Files:**
- Modify: `client/src/pages/DuplicatesPage.jsx`

- [ ] **Step 1: Nahradit komponentu `GroupCard`**

V `client/src/pages/DuplicatesPage.jsx` nahraď celou funkci `GroupCard` (od `function GroupCard(` po její uzavírací `}` před `export default function DuplicatesPage`) tímto:

```jsx
function GroupCard({ group, selected, onToggle }) {
  const r0 = group.rows[0];
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
        {r0.date} · {formatCurrency(r0.amount)} · {r0.description} · {r0.account_name || '—'} · {group.rows.length}×
      </div>
      <div className="text-muted" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
        <span style={{ width: 15 }} />
        <span style={{ flex: 1 }}>datum · popis</span>
        <span style={{ minWidth: 90, textAlign: 'right' }}>částka</span>
        <span style={{ minWidth: 120 }}>AirBank ref</span>
        <span style={{ minWidth: 150 }}>external_id</span>
        <span style={{ minWidth: 70 }}>zdroj</span>
        <span style={{ minWidth: 140 }}>čas transakce</span>
        <span style={{ minWidth: 130 }}>vloženo do DB (UTC)</span>
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
            <span className="text-muted" style={{ minWidth: 120, fontSize: 12 }}>{row.ref || '—'}</span>
            <span className="text-muted" style={{ minWidth: 150, fontSize: 12 }}>{row.external_id || '—'}</span>
            <span className="text-muted" style={{ minWidth: 70, fontSize: 12 }}>{row.source || '—'}</span>
            <span className="text-muted" style={{ minWidth: 140, fontSize: 12 }}>{row.tx_time || '—'}</span>
            <span className="text-muted" style={{ minWidth: 130, fontSize: 12 }}>{row.created_at || '—'}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
```

(Změny vs. původní: přidán hlavičkový legenda-řádek se jmény sloupců; přidán sloupec `row.ref` (AirBank ref) před `external_id`; přidán sloupec `row.tx_time` (čas transakce) před `created_at`; `created_at` fallback sjednocen na `—`. Zbytek stránky — stav, taby, delete, pojistka — beze změny.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Vite build úspěšný, 0 chyb.

- [ ] **Step 3: Grep sanity**

Run: `grep -n "AirBank ref\|row.ref\|row.tx_time\|čas transakce\|vloženo do DB" client/src/pages/DuplicatesPage.jsx`
Expected: legenda i oba nové sloupce přítomny; `row.ref` a `row.tx_time` se renderují.

- [ ] **Step 4: Commit + push**

```bash
git add client/src/pages/DuplicatesPage.jsx
git commit -m "feat: Duplicity UI – sloupce AirBank ref + čas transakce + legenda"
git push origin staging
```

---

### Task 3: Integrační ověření

**Files:** žádné (ověření).

- [ ] **Step 1: Testy + build**

Run:
```bash
node --test src/utils/duplicates.test.js src/utils/income.test.js src/utils/fixed-expenses.test.js src/utils/externalId.test.js src/utils/recurring.test.js src/db/schema.test.js scripts/seed/seed.test.js && node -e "require('./src/routes/transactions.js'); require('./src/utils/duplicates'); console.log('ok')" && npm run build
```
Expected: vše PASS, `ok`, úspěšný build.

- [ ] **Step 2: Shrnout uživateli**

Kontrolní seznam pro staging:
1. Na stránce Duplicity je v každé skupině hlavičková legenda sloupců.
2. Sloupec „AirBank ref" ukazuje čisté ref číslo (např. `156476455902`), „external_id" plný `156476455902-1679014138`.
3. Sloupec „čas transakce" ukazuje `tx_time` (např. `17/05/2026 14:50:50`) nebo `—`; „vloženo do DB (UTC)" je `created_at`.
4. Detekce/pojistka/mazání fungují stejně jako dřív (žádná regrese).

> Prod merge až na explicitní pokyn (projektový deploy-flow).

---

## Self-review

- **Spec coverage:** `ref` + `tx_time` do řádků backend → Task 1 (SELECT + `r.ref`); test → Task 1 Step 1. UI sloupce AirBank ref vedle external_id + tx_time vedle created_at + legenda → Task 2. Grouping/pojistka beze změny → Task 1 explicitně zachovává klíče a `wouldEmptyDuplicateGroup`. YAGNI (žádné formátování času, žádná konfigurovatelnost) dodrženo. Vše pokryto.
- **Placeholder scan:** žádné TBD; veškerý kód kompletní; testy konkrétní.
- **Type/název konzistence:** backend přidává `ref` (= `rawRef(external_id)`) a `tx_time` na řádky (Task 1) → frontend čte `row.ref` a `row.tx_time` (Task 2) — názvy konzistentní. `account_id ?? null` v klíčích zachováno z předchozí featury (beze změny chování). `findDuplicates` výstupní tvar `{probable,possible}` nezměněn (jen bohatší řádky) → API i `DuplicatesPage` konzument konzistentní.
