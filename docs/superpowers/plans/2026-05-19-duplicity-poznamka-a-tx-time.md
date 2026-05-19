# Duplicity: poznámka + tx_time rozlišuje duplicity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** „Možné" duplicity nepovažovat za duplicitu, pokud mají různý/chybějící `tx_time`; přidat sloupec „poznámka" do pohledu Duplicity.

**Architecture:** `findDuplicates` rozšíří `poss` klíč o tx_time (NULL = unikát přes `NIL:${id}`), doplní `note` do řádků; `wouldEmptyDuplicateGroup` srovná definici skupiny (vč. tx_time, NULL přeskočí). Frontend přidá sloupec poznámka. „Pravděpodobné" beze změny.

**Tech Stack:** Node.js + better-sqlite3, `node:test`, React + Vite.

**Spec:** `docs/superpowers/specs/2026-05-19-duplicity-poznamka-a-tx-time-design.md`

**Konvence:** `node --test`; po každém tasku commit + push do `staging`; Husky auto-bump VERSION/package.json očekávaný.

---

### Task 1: Backend — tx_time v „Možné" + note + pojistka, vč. úpravy stávajících testů

**Files:**
- Modify: `src/utils/duplicates.js`
- Modify: `src/utils/duplicates.test.js`

- [ ] **Step 1: Rozšířit `ins()` helper + upravit dotčené stávající testy + přidat nové testy**

V `src/utils/duplicates.test.js`:

**(a)** Nahraď funkci `ins` (řádky 22–26) tak, aby uměla `tx_time` a `note` (default null), beze změny existujícího volání bez nich:

```js
function ins(db, row) {
  db.prepare(`INSERT INTO transactions
    (user_id, amount, currency, date, description, external_id, account_id, source, tx_time, note)
    VALUES (@user_id,@amount,'CZK',@date,@description,@external_id,@account_id,'airbank',@tx_time,@note)`)
    .run({ tx_time: null, note: null, ...row });
}
```

**(b)** Test `'possible: stejné date+description+amount+account (2×) → skupina; jiná částka → NE'` — dva `-200` řádky musí sdílet neprázdný `tx_time`, jinak je nové pravidlo (NULL=unikát) neseskupí. Nahraď tři `ins(...)` řádky tohoto testu za:

```js
  ins(db,{user_id:1,amount:-200,date:'2026-04-05',description:'Kafe',external_id:'a',account_id:10,tx_time:'2026-04-05 08:00:00'});
  ins(db,{user_id:1,amount:-200,date:'2026-04-05',description:'Kafe',external_id:'b',account_id:10,tx_time:'2026-04-05 08:00:00'});
  ins(db,{user_id:1,amount:-201,date:'2026-04-05',description:'Kafe',external_id:'c',account_id:10,tx_time:'2026-04-05 08:00:00'});
```

(Assertions testu beze změny — pořád 1 skupina, 2 řádky, vše `-200`.)

**(c)** Test `'wouldEmptyDuplicateGroup: celá 2členná skupina v ids → true; 1 ze 2 → false; samostatný → false'` — dva `-9 Dup` řádky musí mít shodný neprázdný `tx_time` (jinak nejsou chráněná skupina). Nahraď jeho tři `ins(...)` řádky za:

```js
  ins(db,{user_id:1,amount:-9,date:'2026-04-01',description:'Dup',external_id:'p',account_id:10,tx_time:'2026-04-01 07:00:00'});
  ins(db,{user_id:1,amount:-9,date:'2026-04-01',description:'Dup',external_id:'q',account_id:10,tx_time:'2026-04-01 07:00:00'});
  ins(db,{user_id:1,amount:-3,date:'2026-04-02',description:'Solo',external_id:'r',account_id:10});
```

(Assertions beze změny: `[1,2]` true, `[1]` false, `[3]` false.)

**(d)** Test `'skupina 3 kopií (re-import disaster): probable i possible mají 3 řádky'` — tři `-600` řádky musí sdílet neprázdný `tx_time`. Nahraď jeho tři `ins(...)` řádky za:

```js
  ins(db,{user_id:1,amount:-600,date:'2026-02-22',description:'Nepravidelné',external_id:'r1-10',account_id:10,tx_time:'2026-02-22 09:00:00'});
  ins(db,{user_id:1,amount:-600,date:'2026-02-22',description:'Nepravidelné',external_id:'r1',account_id:10,tx_time:'2026-02-22 09:00:00'});
  ins(db,{user_id:1,amount:-600,date:'2026-02-22',description:'Nepravidelné',external_id:'r1-10-x',account_id:10,tx_time:'2026-02-22 09:00:00'});
```

(Assertions beze změny: possible 1 skupina, 3 řádky.)

**(e)** Test `'wouldEmptyDuplicateGroup: skupina 3 — všechny 3 v ids → true; 2 ze 3 → false'` — tři `-7 Trip` řádky musí sdílet neprázdný `tx_time`. Nahraď jeho tři `ins(...)` řádky za:

```js
  ins(db,{user_id:1,amount:-7,date:'2026-03-01',description:'Trip',external_id:'a',account_id:10,tx_time:'2026-03-01 06:00:00'}); // id 1
  ins(db,{user_id:1,amount:-7,date:'2026-03-01',description:'Trip',external_id:'b',account_id:10,tx_time:'2026-03-01 06:00:00'}); // id 2
  ins(db,{user_id:1,amount:-7,date:'2026-03-01',description:'Trip',external_id:'c',account_id:10,tx_time:'2026-03-01 06:00:00'}); // id 3
```

(Assertions beze změny: `[1,2,3]` true, `[1,2]` false.)

**(f)** Test `'řádky duplicit mají ref (rawRef z external_id) a tx_time'` — druhý řádek má dnes `tx_time NULL`, což po změně rozbije seskupení. Nahraď CELÉ tělo testu (od `const { db, tmp } = freshDb();` po konec před `});`) za:

```js
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  db.prepare(`INSERT INTO transactions
    (user_id, amount, currency, date, description, external_id, account_id, source, tx_time, note)
    VALUES (1,-100,'CZK','2026-04-01','X','12345-1679014138',10,'airbank','01/04/2026 10:11:12','pozn A')`).run();
  db.prepare(`INSERT INTO transactions
    (user_id, amount, currency, date, description, external_id, account_id, source, tx_time, note)
    VALUES (1,-100,'CZK','2026-04-01','X','12345',10,'airbank','01/04/2026 10:11:12','pozn B')`).run();

  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);

  assert.equal(r.possible.length, 1);
  const rows = r.possible[0].rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(x => x.ref).sort(), ['12345', '12345']);
  assert.equal(rows.every(x => x.tx_time === '01/04/2026 10:11:12'), true);
  assert.deepEqual(rows.map(x => x.note).sort(), ['pozn A', 'pozn B']);
```

**(g)** Přidej na KONEC souboru tyto nové testy:

```js
test('Možné: různý tx_time → NENÍ duplicita', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  ins(db,{user_id:1,amount:-50,date:'2026-05-01',description:'Oběd',external_id:'x1',account_id:10,tx_time:'2026-05-01 11:00:00'});
  ins(db,{user_id:1,amount:-50,date:'2026-05-01',description:'Oběd',external_id:'x2',account_id:10,tx_time:'2026-05-01 18:30:00'});
  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);
  assert.equal(r.possible.length, 0);
});

test('Možné: oba tx_time NULL → NENÍ duplicita (NULL = unikát)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  ins(db,{user_id:1,amount:-50,date:'2026-05-01',description:'Oběd',external_id:'y1',account_id:10});
  ins(db,{user_id:1,amount:-50,date:'2026-05-01',description:'Oběd',external_id:'y2',account_id:10});
  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);
  assert.equal(r.possible.length, 0);
});

test('note se propaguje do řádků (possible)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  ins(db,{user_id:1,amount:-12,date:'2026-05-02',description:'Z',external_id:'n1',account_id:10,tx_time:'2026-05-02 09:00:00',note:'pozn 1'});
  ins(db,{user_id:1,amount:-12,date:'2026-05-02',description:'Z',external_id:'n2',account_id:10,tx_time:'2026-05-02 09:00:00',note:'pozn 2'});
  const { findDuplicates } = require('./duplicates');
  const r = findDuplicates(db, 1);
  cleanup(db, tmp);
  assert.equal(r.possible.length, 1);
  assert.deepEqual(r.possible[0].rows.map(x => x.note).sort(), ['pozn 1', 'pozn 2']);
});

test('wouldEmptyDuplicateGroup: NULL-tx_time pár není chráněná skupina → false', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name) VALUES (10,1,'H')").run();
  ins(db,{user_id:1,amount:-5,date:'2026-05-03',description:'NoTime',external_id:'z1',account_id:10}); // id 1, tx_time NULL
  ins(db,{user_id:1,amount:-5,date:'2026-05-03',description:'NoTime',external_id:'z2',account_id:10}); // id 2, tx_time NULL
  ins(db,{user_id:1,amount:-5,date:'2026-05-04',description:'Timed',external_id:'z3',account_id:10,tx_time:'2026-05-04 10:00:00'}); // id 3
  ins(db,{user_id:1,amount:-5,date:'2026-05-04',description:'Timed',external_id:'z4',account_id:10,tx_time:'2026-05-04 10:00:00'}); // id 4
  const { wouldEmptyDuplicateGroup } = require('./duplicates');
  // NULL-time pár: nejsou skupina → smazat oba lze
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [1, 2]), false);
  // shodný neprázdný tx_time pár: chráněná skupina → smazat oba NE
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [3, 4]), true);
  assert.equal(wouldEmptyDuplicateGroup(db, 1, [3]), false);
  cleanup(db, tmp);
});
```

- [ ] **Step 2: Spustit testy, ověřit fail**

Run: `node --test src/utils/duplicates.test.js`
Expected: nové testy (`Možné: různý tx_time`, `oba NULL`, `note se propaguje`, `NULL-tx_time pár`) a upravený `'řádky duplicit ... note'` FAIL (poss key zatím tx_time/note neřeší, `note` undefined). Upravené `possible`/`wouldEmpty…` testy mohou zatím PASS (původní logika je seskupí i bez tx_time) — to je OK, klíčové je, že nové testy padají z dobrého důvodu.

- [ ] **Step 3: Implementovat `src/utils/duplicates.js`**

a) Do SELECT ve `findDuplicates` přidej `t.note` (za `a.name AS account_name` nebo vedle ostatních t.*; konkrétně rozšiř seznam):

```js
    SELECT t.id, t.date, t.description, t.amount, t.account_id, t.external_id,
           t.source, t.created_at, t.tx_time, t.note, a.name AS account_name
```

b) Nahraď tělo cyklu `for (const r of rows) { ... }` za (mění se jen `poss` klíč; `prob` beze změny):

```js
  for (const r of rows) {
    const rr = rawRef(r.external_id);
    r.ref = rr;
    if (rr) pushTo(prob, `${rr}|${r.account_id ?? null}`, r);
    const timeKey = r.tx_time ? r.tx_time : `NIL:${r.id}`;
    pushTo(poss, `${r.date}|${r.description}|${r.amount}|${r.account_id ?? null}|${timeKey}`, r);
  }
```

c) Uprav `wouldEmptyDuplicateGroup` tak, aby definice skupiny odpovídala (vč. tx_time; NULL-time řádek = vždy smazatelný). Nahraď CELOU funkci za:

```js
function wouldEmptyDuplicateGroup(db, userId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return false;
  const idSet = new Set(ids.map(Number));
  const ph = ids.map(() => '?').join(',');
  const delRows = db.prepare(
    `SELECT id, date, description, amount, account_id, tx_time
     FROM transactions WHERE user_id = ? AND id IN (${ph})`
  ).all(userId, ...ids);

  const groupStmt = db.prepare(
    `SELECT id FROM transactions
     WHERE user_id = ? AND date = ? AND description = ? AND amount = ?
       AND account_id IS ? AND tx_time = ?`
  );
  const seen = new Set();
  for (const r of delRows) {
    if (!r.tx_time) continue; // NULL/prázdný tx_time = nikdy chráněná skupina (dle pravidla unikát)
    const sig = JSON.stringify([r.date, r.description, r.amount, r.account_id, r.tx_time]);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const groupIds = groupStmt.all(userId, r.date, r.description, r.amount, r.account_id, r.tx_time);
    if (groupIds.length > 1 && groupIds.every(g => idSet.has(g.id))) return true;
  }
  return false;
}
```

(`rawRef`, `pushTo`, `toGroups`, `module.exports` beze změny.)

- [ ] **Step 4: Spustit testy, ověřit pass**

Run: `node --test src/utils/duplicates.test.js`
Expected: VŠECHNY testy PASS (upravené stávající + nové), 0 fail.

Regrese:
Run: `node --test src/utils/duplicates.test.js src/utils/income.test.js src/utils/fixed-expenses.test.js src/utils/externalId.test.js src/utils/recurring.test.js src/db/schema.test.js scripts/seed/seed.test.js`
Expected: 0 fail.

- [ ] **Step 5: Commit + push**

```bash
git add src/utils/duplicates.js src/utils/duplicates.test.js
git commit -m "feat: duplicity – tx_time rozlišuje Možné + note v řádcích (pojistka srovnána)"
git push origin staging
```

---

### Task 2: Frontend — sloupec „poznámka" v `GroupCard`

**Files:**
- Modify: `client/src/pages/DuplicatesPage.jsx`

- [ ] **Step 1: Nahradit `GroupCard`**

V `client/src/pages/DuplicatesPage.jsx` nahraď CELOU funkci `GroupCard` (od `function GroupCard(` po její uzavírací `}` před `export default function DuplicatesPage`) za:

```jsx
function GroupCard({ group, selected, onToggle }) {
  const r0 = group.rows[0];
  const colRef = { width: 120, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  const colExt = { width: 150, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  const colNote = { width: 160, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  const colSrc = { width: 70, flexShrink: 0 };
  const colTx = { width: 140, flexShrink: 0 };
  const colCre = { width: 130, flexShrink: 0 };
  const colAmt = { width: 90, flexShrink: 0, textAlign: 'right' };
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
        {r0.date} · {formatCurrency(r0.amount)} · {r0.description} · {r0.account_name || '—'} · {group.rows.length}×
      </div>
      <div className="text-muted" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
        <span style={{ width: 15, flexShrink: 0 }} />
        <span style={{ flex: 1 }}>datum · popis</span>
        <span style={colAmt}>částka</span>
        <span style={colRef}>AirBank ref</span>
        <span style={colExt}>ext. ID</span>
        <span style={colSrc}>zdroj</span>
        <span style={colNote}>poznámka</span>
        <span style={colTx}>čas transakce</span>
        <span style={colCre}>vloženo do DB (UTC)</span>
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
            <span style={colAmt}>{formatCurrency(row.amount)}</span>
            <span className="text-muted" style={{ ...colRef, fontSize: 12 }} title={row.ref || ''}>{row.ref || '—'}</span>
            <span className="text-muted" style={{ ...colExt, fontSize: 12 }} title={row.external_id || ''}>{row.external_id || '—'}</span>
            <span className="text-muted" style={{ ...colSrc, fontSize: 12 }}>{row.source || '—'}</span>
            <span className="text-muted" style={{ ...colNote, fontSize: 12 }} title={row.note || ''}>{row.note || '—'}</span>
            <span className="text-muted" style={{ ...colTx, fontSize: 12 }}>{row.tx_time || '—'}</span>
            <span className="text-muted" style={{ ...colCre, fontSize: 12 }}>{row.created_at || '—'}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
```

(Změna vs. dnešek: přidán `colNote` styl + sloupec „poznámka" do legendy i řádku, mezi `zdroj` a `čas transakce`, s ellipsis + `title`. Komponenta `DuplicatesPage` a její logika beze změny.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Vite build úspěšný, 0 chyb.

- [ ] **Step 3: Grep sanity**

Run: `grep -n "poznámka\|row.note\|colNote\|guardDuplicateGroups\|export default function DuplicatesPage" client/src/pages/DuplicatesPage.jsx`
Expected: legenda „poznámka", `colNote`, `{row.note ...}` přítomné; `guardDuplicateGroups` a `export default function DuplicatesPage` dál přítomné (logika nedotčena).

- [ ] **Step 4: Commit + push**

```bash
git add client/src/pages/DuplicatesPage.jsx
git commit -m "feat: Duplicity UI – sloupec poznámka"
git push origin staging
```

---

### Task 3: Integrační ověření

**Files:** žádné.

- [ ] **Step 1: Testy + build**

Run:
```bash
node --test src/utils/duplicates.test.js src/utils/income.test.js src/utils/fixed-expenses.test.js src/utils/externalId.test.js src/utils/recurring.test.js src/db/schema.test.js scripts/seed/seed.test.js && node -e "require('./src/routes/transactions.js'); require('./src/utils/duplicates'); console.log('ok')" && npm run build
```
Expected: vše PASS, `ok`, úspěšný build.

- [ ] **Step 2: Shrnout uživateli**

Kontrolní seznam pro staging:
1. „Možné" už neukazuje dvě stejnodenní platby stejné částky, pokud mají různý čas transakce; ani když čas chybí u obou.
2. Reálné duplicity se shodným časem se dál hlásí; „Pravděpodobné" (stejný AirBank ref) beze změny.
3. Nový sloupec „poznámka" v každém řádku (mezi „zdroj" a „čas transakce"), dlouhé hodnoty zkrácené s tooltipem.
4. Pojistka mazání: smazat celou skupinu se shodným časem nelze (zůstane ≥1); NULL-time řádky lze smazat bez omezení (nejsou skupina).

> Prod merge až na explicitní pokyn (projektový deploy-flow).

---

## Self-review

- **Spec coverage:** `note` do řádků → Task 1 Step 3a + frontend Task 2. tx_time do „Možné" klíče s NULL=unikát → Task 1 Step 3b (`NIL:${id}`). „Pravděpodobné" beze změny → Task 1 Step 3b (prob řádek nezměněn). Pojistka srovnaná vč. NULL-skip → Task 1 Step 3c. Testy (různý čas/oba NULL/note/pojistka) → Task 1 Step 1g; úprava 5 dotčených stávajících testů (b–f) explicitně vyjmenována, intent zachován ne oslaben. YAGNI (žádná normalizace času, žádná změna probable) dodrženo.
- **Placeholder scan:** žádné TBD; veškerý kód kompletní; všechny dotčené testy uvedeny s konkrétní náhradou.
- **Type/název konzistence:** backend přidává `note` na řádky + rozšiřuje `poss` klíč; frontend čte `row.note` (Task 2) — konzistentní. `wouldEmptyDuplicateGroup` skupinová definice (date+description+amount+account_id+tx_time, NULL skip) odpovídá nové `poss` definici (NIL:id ⇒ NULL nikdy neseskupí ⇒ není chráněná skupina ⇒ `!r.tx_time` continue je ekvivalentní). `findDuplicates` výstupní tvar `{probable,possible}` nezměněn (jen bohatší řádky + zúžené possible).
- **Konzistence test↔impl:** Step 2 očekává, že upravené `possible`/`wouldEmpty…` testy s doplněným shodným `tx_time` projdou i po implementaci (Step 4) — tx_time je shodný neprázdný → seskupí se / pojistka platí; nové NULL/různý-čas testy projdou až po implementaci. Logika konzistentní.
