# Fallback obchodního místa — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Když je `transactions.place` prázdné, sloupec „Obchodní místo" (v tabulce Transakce i v CSV exportu) zobrazí protiúčet — u interního účtu ve tvaru `číslo · název`, u externího holé číslo.

**Architecture:** Čistě zobrazovací fallback, DB se nemění. Logika žije ve dvou paralelních utilech — ESM pro klienta (`client/src/utils/accountName.js`) a CJS pro server (`src/utils/place-display.js`) — protože klientský kód je Vite/ESM a server CJS a projekt nemá sdílenou vrstvu. Obojí kryté unit testy, aby se implementace nerozjely.

**Tech Stack:** Node.js + Express + better-sqlite3 (server), React + Vite (klient), `node:test` + `node:assert/strict` pro testy.

**Spec:** `docs/superpowers/specs/2026-08-02-place-fallback-design.md`

## Global Constraints

- Jazyk UI je čeština; texty a komentáře v kódu česky (konvence projektu).
- Identita účtu = KOMPLETNÍ číslo `[předčíslí-]číslo/kódbanky`, exact porovnání, ořezávají se jen mezery.
- Žádná změna schématu DB, žádná datová migrace, žádný zásah do parserů.
- Nesmí se změnit chování `apply-rules.js`, `fixed-expenses.js` ani `apple-candidates.js` — ty čtou uložený `place` a musí ho vidět dál beze změny.
- Po dokončení commit a push do větve `staging` (ne `main`).
- Testy: klient `node --test client/src/utils/*.test.js`, backend `node --test --test-force-exit 'src/**/*.test.js'` (pozor: cesta `src/` bez globu visí).

---

### Task 1: Klientský util `placeDisplay` + napojení na sloupec v Transakcích

**Files:**
- Modify: `client/src/utils/accountName.js` (přidat export na konec souboru)
- Modify: `client/src/pages/TransactionsPage.jsx:1164-1165` (`case 'place'`)
- Test: `client/src/utils/accountName.test.js` (přidat testy na konec)

**Interfaces:**
- Consumes: `normalizeAccountNumber(raw)`, `buildAccountNameMap(accounts)`, `accountNameFor(counterpartyAccount, nameMap)` — už existují ve stejném souboru.
- Produces: `placeDisplay(tx, nameMap) → { text: string, derived: boolean } | null`
  - `tx` = objekt transakce s poli `place` a `counterparty_account`
  - `nameMap` = `Map<string, string>` z `buildAccountNameMap`
  - vrací `null`, když není co zobrazit (volající vykreslí „—")
  - `derived: false` = skutečné obchodní místo z banky, `true` = odvozeno z protiúčtu

- [ ] **Step 1: Napiš failující testy**

Nejdřív rozšiř existující import na řádku 3 `client/src/utils/accountName.test.js`:

```js
import { normalizeAccountNumber, buildAccountNameMap, accountNameFor, placeDisplay } from './accountName.js';
```

Pak přidej na konec téhož souboru:

```js
const txAccounts = [
  { account_number: '1679014138/3030', name: 'Hlavní' },
  { account_number: '1679014023/3030', name: 'Společný' },
];

test('placeDisplay: vyplněné place má přednost a není odvozené', () => {
  const map = buildAccountNameMap(txAccounts);
  const r = placeDisplay({ place: 'ALBERT 1234', counterparty_account: '1679014138/3030' }, map);
  assert.deepEqual(r, { text: 'ALBERT 1234', derived: false });
});

test('placeDisplay: interní protiúčet → "číslo · název", označeno jako odvozené', () => {
  const map = buildAccountNameMap(txAccounts);
  const r = placeDisplay({ place: null, counterparty_account: '1679014138/3030' }, map);
  assert.deepEqual(r, { text: '1679014138/3030 · Hlavní', derived: true });
});

test('placeDisplay: externí protiúčet → holé číslo (QR platba ve stánku)', () => {
  const map = buildAccountNameMap(txAccounts);
  const r = placeDisplay({ place: '', counterparty_account: '201220675/0600' }, map);
  assert.deepEqual(r, { text: '201220675/0600', derived: true });
});

test('placeDisplay: bez place i bez protiúčtu → null', () => {
  const map = buildAccountNameMap(txAccounts);
  assert.equal(placeDisplay({ place: null, counterparty_account: null }, map), null);
  assert.equal(placeDisplay({ place: '', counterparty_account: '' }, map), null);
});

test('placeDisplay: mezery v čísle účtu nevadí, výstup je normalizované číslo', () => {
  const map = buildAccountNameMap(txAccounts);
  const r = placeDisplay({ place: null, counterparty_account: ' 1679014023/3030 ' }, map);
  assert.deepEqual(r, { text: '1679014023/3030 · Společný', derived: true });
});

test('placeDisplay: chybějící tx nebo mapa nespadne', () => {
  assert.equal(placeDisplay(null, new Map()), null);
  assert.deepEqual(placeDisplay({ place: 'X' }, null), { text: 'X', derived: false });
});
```

- [ ] **Step 2: Spusť testy a ověř, že padají**

Run: `node --test client/src/utils/accountName.test.js`
Expected: FAIL — `placeDisplay is not a function` / SyntaxError o chybějícím exportu.

- [ ] **Step 3: Implementuj util**

Přidej na konec `client/src/utils/accountName.js`:

```js
// Zobrazované „Obchodní místo". Parsery plní `place` jen u kartových plateb —
// u QR plateb a převodů zůstává prázdné, i když z transakce víme, komu peníze šly.
// Fallback je čistě zobrazovací: DB se nemění, aby se nerozšířil haystack
// textových pravidel (apply-rules) ani matcheru fixních plateb.
// Vrací null, když není co zobrazit — volající vykreslí „—".
export function placeDisplay(tx, nameMap) {
  if (!tx) return null;
  const place = (tx.place || '').trim();
  if (place) return { text: place, derived: false };

  const cp = normalizeAccountNumber(tx.counterparty_account);
  if (!cp) return null;

  const name = accountNameFor(cp, nameMap);
  return { text: name ? `${cp} · ${name}` : cp, derived: true };
}
```

- [ ] **Step 4: Spusť testy a ověř, že prochází**

Run: `node --test client/src/utils/accountName.test.js`
Expected: PASS — všech 6 nových testů zelených, stávající testy v souboru dál procházejí.

- [ ] **Step 5: Napoj sloupec v TransactionsPage**

V `client/src/pages/TransactionsPage.jsx` rozšiř import na řádku 8:

```jsx
import { buildAccountNameMap, placeDisplay } from '../utils/accountName';
```

A nahraď `case 'place'` (řádky 1164-1165):

```jsx
    case 'place': {
      // Prázdné `place` (QR platby, převody) → protiúčet; odvozená hodnota ztlumeně,
      // ať je poznat, že to není obchodní místo hlášené bankou.
      const pd = placeDisplay(tx, accountNameMap);
      if (!pd) return <span style={{ fontSize: 13 }}>—</span>;
      return (
        <span
          className={pd.derived ? 'text-muted' : undefined}
          title={pd.text}
          style={{ fontSize: 13 }}
        >
          {pd.text}
        </span>
      );
    }
```

- [ ] **Step 6: Ověř build klienta**

Run: `npm run build --prefix client`
Expected: build projde bez chyb (žádný nepoužitý import, žádná syntaktická chyba).

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/accountName.js client/src/utils/accountName.test.js client/src/pages/TransactionsPage.jsx
git commit -m "feat(transakce): prazdne obchodni misto ukaze protiucet"
```

---

### Task 2: Serverový util + CSV export

**Files:**
- Create: `src/utils/place-display.js`
- Create: `src/utils/place-display.test.js`
- Modify: `src/routes/transactions.js:184-199` (route `GET /export`)
- Test: `src/routes/transactions.test.js` (přidat test na konec)

**Interfaces:**
- Consumes: `normCounterparty(s)` z `src/utils/income.js` — normalizace čísla účtu na serveru (ořeže mezery, vrátí `[předčíslí-]číslo[/kód]`, jinak `null`). Záměrně se používá zavedená serverová normalizace, ne kopie klientské: na reálných číslech účtů dávají obě totožný výsledek, liší se jen u vstupu, který nezačíná číslicí — tam server vrátí `null` (buňka prázdná) a klient by vypsal syrový text. `counterparty_account` je v DB vždy číslo účtu, takže rozdíl je teoretický.
- Produces:
  - `buildAccountNameMap(rows) → Map<string, string>` — `rows` = pole `{ account_number, name }`
  - `placeDisplayText(tx, nameMap) → string` — vrací prázdný string, když není co zobrazit (CSV buňka zůstane prázdná)

- [ ] **Step 1: Napiš failující testy utilu**

Vytvoř `src/utils/place-display.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAccountNameMap, placeDisplayText } = require('./place-display');

const accounts = [
  { account_number: '1679014138/3030', name: 'Hlavní' },
  { account_number: '1679014023/3030', name: 'Společný' },
  { account_number: null, name: 'Bez čísla' },
];

test('vyplněné place má přednost', () => {
  const map = buildAccountNameMap(accounts);
  assert.equal(placeDisplayText({ place: 'ALBERT 1234', counterparty_account: '1679014138/3030' }, map), 'ALBERT 1234');
});

test('interní protiúčet → "číslo · název"', () => {
  const map = buildAccountNameMap(accounts);
  assert.equal(placeDisplayText({ place: null, counterparty_account: '1679014138/3030' }, map), '1679014138/3030 · Hlavní');
});

test('externí protiúčet → holé číslo', () => {
  const map = buildAccountNameMap(accounts);
  assert.equal(placeDisplayText({ place: '', counterparty_account: '201220675/0600' }, map), '201220675/0600');
});

test('bez place i bez protiúčtu → prázdný string', () => {
  const map = buildAccountNameMap(accounts);
  assert.equal(placeDisplayText({ place: null, counterparty_account: null }, map), '');
});

test('účet bez čísla v mapě nefiguruje a nespadne', () => {
  const map = buildAccountNameMap(accounts);
  assert.equal(map.size, 2);
  assert.equal(placeDisplayText({ counterparty_account: '19-1679014138/3030' }, map), '19-1679014138/3030');
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `node --test src/utils/place-display.test.js`
Expected: FAIL — `Cannot find module './place-display'`.

- [ ] **Step 3: Implementuj serverový util**

Vytvoř `src/utils/place-display.js`:

```js
'use strict';
const { normCounterparty } = require('./income');

/**
 * Serverový protějšek klientského `placeDisplay` (client/src/utils/accountName.js).
 * Používá ho CSV export, aby v něm „Obchodní místo" nebylo prázdné u QR plateb
 * a převodů. Čistě zobrazovací — do DB se nic nezapisuje.
 * Obě implementace musí dávat stejný výsledek; hlídají to unit testy na obou stranách.
 */
function buildAccountNameMap(rows) {
  const map = new Map();
  for (const a of rows || []) {
    const num = normCounterparty(a.account_number);
    if (num) map.set(num, a.name);
  }
  return map;
}

/** Vrátí text do sloupce „Obchodní místo"; prázdný string = buňka zůstane prázdná. */
function placeDisplayText(tx, nameMap) {
  if (!tx) return '';
  const place = (tx.place || '').trim();
  if (place) return place;

  const cp = normCounterparty(tx.counterparty_account);
  if (!cp) return '';

  const name = nameMap ? nameMap.get(cp) : null;
  return name ? `${cp} · ${name}` : cp;
}

module.exports = { buildAccountNameMap, placeDisplayText };
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `node --test src/utils/place-display.test.js`
Expected: PASS — 5 testů zelených.

- [ ] **Step 5: Napiš failující test CSV exportu**

Přidej na konec `src/routes/transactions.test.js`:

```js
test('GET /export: prázdné obchodní místo doplní protiúčet (interní i externí)', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO accounts (user_id, account_number, name) VALUES (1,'1679014138/3030','Hlavní')").run();
  // interní protiúčet → "číslo · název"
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account) VALUES (1,5,-500,'2026-07-10','Převod','1679014138/3030')").run();
  // externí protiúčet → holé číslo (QR platba)
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description, counterparty_account) VALUES (1,5,-230,'2026-07-25','káva na vodě ve stánku','201220675/0600')").run();
  // vyplněné place se nemění
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description, place, counterparty_account) VALUES (1,5,-99,'2026-07-26','ALBERT','ALBERT 1234','201220675/0600')").run();

  const res = await fetch(`${base}/api/transactions/export?from=2026-07-01&to=2026-07-31`);
  assert.equal(res.status, 200);
  const csv = await res.text();
  assert.ok(csv.includes('1679014138/3030 · Hlavní'), 'interní protiúčet s názvem');
  assert.ok(csv.includes('201220675/0600'), 'externí protiúčet jako číslo');
  assert.ok(csv.includes('ALBERT 1234'), 'vyplněné place zůstává');
  server.close();
});
```

- [ ] **Step 6: Spusť test a ověř, že padá**

Run: `node --test --test-force-exit src/routes/transactions.test.js`
Expected: FAIL na `assert.ok(csv.includes('1679014138/3030 · Hlavní'))` — export dnes vypisuje holé `r.place`.

- [ ] **Step 7: Napoj util do exportu**

V `src/routes/transactions.js` přidej k importům na začátku souboru:

```js
const { buildAccountNameMap, placeDisplayText } = require('../utils/place-display');
```

V route `GET /export` za `const rows = db.prepare(query).all(req.dataUserId, ...params);` (řádek 193) vlož:

```js
  // Mapa vlastních účtů se načítá zvlášť — druhý JOIN na accounts.account_number
  // by při duplicitním čísle rozmnožil řádky exportu.
  const accountRows = db.prepare('SELECT account_number, name FROM accounts WHERE user_id = ?').all(req.dataUserId);
  const cpNameMap = buildAccountNameMap(accountRows);
```

A změň definici sloupce (řádek 199):

```js
    ['Obchodní místo', r => placeDisplayText(r, cpNameMap)],
```

- [ ] **Step 8: Spusť test a ověř, že prochází**

Run: `node --test --test-force-exit src/routes/transactions.test.js`
Expected: PASS — nový test zelený, stávající testy exportu (hlavička/BOM, escapování) dál procházejí.

- [ ] **Step 9: Spusť celou backendovou sadu**

Run: `node --test --test-force-exit 'src/**/*.test.js'`
Expected: PASS — žádný regres, zejména v `fixed-expenses.test.js`, `stats.test.js` a `transactions.security.test.js`.

- [ ] **Step 10: Commit**

```bash
git add src/utils/place-display.js src/utils/place-display.test.js src/routes/transactions.js src/routes/transactions.test.js
git commit -m "feat(export): obchodni misto v CSV doplni protiucet"
```

---

### Task 3: Ověření a nasazení na staging

**Files:** žádné změny kódu (pokud kontrola neodhalí problém)

- [ ] **Step 1: Spusť obě testovací sady**

Run: `node --test client/src/utils/*.test.js && node --test --test-force-exit 'src/**/*.test.js'`
Expected: obě sady zelené.

- [ ] **Step 2: Ověř, že se nezměnily matchery**

Run: `git diff main --stat -- src/utils/apply-rules.js src/utils/fixed-expenses.js src/utils/apple-candidates.js src/db/schema.js src/utils/emailParser.js src/utils/csvParser.js`
Expected: prázdný výstup — žádný z těchto souborů se nesmí měnit.

- [ ] **Step 3: Push do staging**

```bash
git push origin staging
```

- [ ] **Step 4: Ohlas verzi**

Zjisti nové číslo verze (`node -p "require('./package.json').version"`) a ohlas ji uživateli spolu s tím, co má na stagingu ověřit: v Transakcích zapnout sloupec „Obchodní místo" a zkontrolovat transakci z 25. 7. na 230 Kč — má ukázat ztlumeně `201220675/0600`.
