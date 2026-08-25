# Kontrola fondů — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stránka, která u fondových účtů („Nepravidelné", „Licence") odpoví, jestli zůstatek pokryje roční výdaje, které z fondu ještě letos odejdou — a pod tím ukáže vývoj zůstatku jako u spoření.

**Architecture:** Roční kategorie dostanou explicitní vazbu na fondový účet (`categories.fund_account_id`). Nový util spočítá krytí = zůstatek fondu (kotvený posledním `balance_after`) minus nevyčerpaný plán aktivních podpoložek. Endpoint `GET /api/stats/fund-history` vrátí krytí i historii ve stejném tvaru, jaký už umí komponenta grafu z Vývoje spoření. Řetězení zůstatků od kotvy se vytáhne ze `savings-history` do sdíleného helperu, na který se obě historie přepojí.

**Tech Stack:** Node.js + Express, better-sqlite3, `node:test`, React + Vite.

**Spec:** `docs/superpowers/specs/2026-08-26-kontrola-fondu-design.md`

## Global Constraints

- Jazyk kódu, komentářů a UI: čeština včetně diakritiky.
- Backend testy: `node --test --test-force-exit 'src/**/*.test.js'` — cesta MUSÍ být v uvozovkách jako glob; `node --test src/` visí.
- Klientské testy: `node --test 'client/src/utils/*.test.js'`. Build: `npm run build` z kořene. Lint: `npm run lint` v adresáři `client`.
- **Testy spouštěj SYNCHRONNĚ a jednotlivě.** Dva souběžné běhy backendové sady kolidují nad sdílenou temp DB a vyrobí falešný fail s anomální dobou běhu.
- Repo nese 8 předexistujících lint warningů záměrně.
- Fondový účet = `accounts.is_fund = 1`. Dnes jsou to „Nepravidelné" (`1679014074/3030`) a „Licence" (`1679014111/3030`).
- `fund_account_id = NULL` znamená „kategorie se nefinancuje z fondu" a do krytí nevstupuje.
- Aktivní podpoložka = `window_to >= dnešní datum`, kde `window_to` je konec DATOVÉHO okna (u cross-year okna `window_start > window_end` leží konec v dalším roce).
- Chybová hláška při nefondovém účtu: `Účet není fondový.`
- Po commitu push do větve `staging` (NE main).

---

### Task 1: Sloupec `fund_account_id` a jeho validace

**Files:**
- Modify: `src/db/schema.js` (nový `ALTER TABLE` mezi ostatní migrace, vzor viz `ALTER TABLE categories ADD COLUMN system_role TEXT` na řádku ~352)
- Modify: `src/routes/categories.js:81-118` (PATCH endpoint)
- Test: `src/routes/categories.test.js` (přidat na konec)

**Interfaces:**
- Consumes: nic (první task)
- Produces: sloupec `categories.fund_account_id INTEGER` (nullable) a `PATCH /api/categories/:id`, který ho přijímá. Tasky 3 a 6 na něm staví.

**Kontext pro implementátora:** Migrace se v tomhle repu přidávají jako `ALTER TABLE` v `try/catch` na konec `initSchema()` — žádný migrační framework. `try/catch` je nutný, protože `initSchema()` běží při každém startu a druhý průchod by na existujícím sloupci spadl.

SQLite neumí přidat FK přes `ALTER TABLE`, takže integritu drží validace v API. Po smazání fondového účtu zůstane u kategorie neplatné id — výpočet krytí to ošetří joinem (Task 3), tady se tím nezabývej.

- [ ] **Step 1: Napiš failující testy**

Přidej na konec `src/routes/categories.test.js`. Pozor: `setup()` v tomto souboru vkládá uživatele 1 a 2 a kategorie 10 (user 1) a 11 (user 2).

```js
test('PATCH: fund_account_id přijme fondový účet', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO accounts (id,user_id,name,account_number,role,is_fund) VALUES (60,1,'Nepravidelné','1679014074/3030','spending',1)").run();
  const res = await fetch(`${base}/api/categories/10`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ fund_account_id: 60 }) });
  const body = await res.json();
  server.close();
  assert.equal(res.status, 200);
  assert.equal(body.fund_account_id, 60);
});

test('PATCH: fund_account_id = null vazbu zruší', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO accounts (id,user_id,name,account_number,role,is_fund) VALUES (60,1,'Nepravidelné','1679014074/3030','spending',1)").run();
  db.prepare('UPDATE categories SET fund_account_id = 60 WHERE id = 10').run();
  const res = await fetch(`${base}/api/categories/10`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ fund_account_id: null }) });
  const body = await res.json();
  server.close();
  assert.equal(res.status, 200);
  assert.equal(body.fund_account_id, null);
});

test('PATCH: nefondový účet se odmítne', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO accounts (id,user_id,name,account_number,role,is_fund) VALUES (61,1,'Společný','1679014023/3030','spending',0)").run();
  const res = await fetch(`${base}/api/categories/10`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ fund_account_id: 61 }) });
  const body = await res.json();
  const still = db.prepare('SELECT fund_account_id FROM categories WHERE id = 10').get();
  server.close();
  assert.equal(res.status, 400);
  assert.equal(body.error, 'Účet není fondový.');
  assert.equal(still.fund_account_id, null, 'vazba se nesmí uložit');
});

test('PATCH: cizí fondový účet se odmítne', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO accounts (id,user_id,name,account_number,role,is_fund) VALUES (62,2,'Cizí fond','9999999999/3030','spending',1)").run();
  const res = await fetch(`${base}/api/categories/10`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ fund_account_id: 62 }) });
  server.close();
  assert.equal(res.status, 400);
});

test('PATCH: bez fund_account_id v těle zůstane stávající vazba', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO accounts (id,user_id,name,account_number,role,is_fund) VALUES (60,1,'Nepravidelné','1679014074/3030','spending',1)").run();
  db.prepare('UPDATE categories SET fund_account_id = 60 WHERE id = 10').run();
  const res = await fetch(`${base}/api/categories/10`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ name: 'Přejmenovaná' }) });
  const body = await res.json();
  server.close();
  assert.equal(body.fund_account_id, 60);
  assert.equal(body.name, 'Přejmenovaná');
});
```

- [ ] **Step 2: Spusť testy a ověř, že padají**

Run: `node --test --test-force-exit src/routes/categories.test.js`
Expected: FAIL — `body.fund_account_id` je `undefined`, protože sloupec neexistuje a PATCH ho neumí.

- [ ] **Step 3: Přidej sloupec do schématu**

V `src/db/schema.js` přidej mezi ostatní `ALTER TABLE` migrace (vedle `system_role`):

```js
  // Vazba roční kategorie na fondový účet, ze kterého se platí. NULL = kategorie
  // se z fondu nefinancuje (typicky Oblečení placené ze Společného) a do výpočtu
  // krytí fondu nevstupuje. FK se nepřidává — SQLite ho v ALTER TABLE neumí,
  // integritu drží validace v PATCH /api/categories a join ve fund-coverage.
  try { db.exec('ALTER TABLE categories ADD COLUMN fund_account_id INTEGER'); } catch { /* sloupec už existuje */ }
```

- [ ] **Step 4: Rozšiř PATCH endpoint**

V `src/routes/categories.js` rozšiř destrukturalizaci těla:

```js
  const { name, color, icon, type, typical_price, frequency_months, fund_account_id } = req.body;
```

Za načtení `cat` a před `UPDATE` vlož validaci:

```js
  // Vazba na fondový účet: přijme se jen účet téhož uživatele s is_fund = 1, nebo
  // null (= kategorie se z fondu nefinancuje). Bez FK v DB je tohle jediné místo,
  // které drží integritu — viz komentář u migrace ve schema.js.
  let newFundAccountId = cat.fund_account_id;
  if (fund_account_id !== undefined) {
    if (fund_account_id === null) {
      newFundAccountId = null;
    } else {
      const acc = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ? AND is_fund = 1')
        .get(fund_account_id, req.dataUserId);
      if (!acc) return res.status(400).json({ error: 'Účet není fondový.' });
      newFundAccountId = acc.id;
    }
  }
```

Do `UPDATE` doplň sloupec a parametr (pořadí parametrů musí odpovídat pořadí `?`):

```js
    db.prepare(`
      UPDATE categories
      SET name = ?, color = ?, icon = ?, type = ?, typical_price = ?, frequency_months = ?, fund_account_id = ?
      WHERE id = ?
    `).run(
      name ?? cat.name,
      color ?? cat.color,
      icon ?? cat.icon,
      newType,
      typical_price !== undefined ? (typical_price != null ? parseFloat(typical_price) : null) : cat.typical_price,
      frequency_months !== undefined ? (frequency_months != null ? parseInt(frequency_months) : null) : cat.frequency_months,
      newFundAccountId,
      cat.id
    );
```

- [ ] **Step 5: Spusť testy a ověř, že prochází**

Run: `node --test --test-force-exit src/routes/categories.test.js`
Expected: PASS, všech pět nových testů zelených a stávající testy nedotčené.

- [ ] **Step 6: Spusť celou backend sadu**

Run: `node --test --test-force-exit 'src/**/*.test.js'`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.js src/routes/categories.js src/routes/categories.test.js
git commit -m "feat(kontrola-fondu): vazba rocni kategorie na fondovy ucet"
git push origin staging
```

---

### Task 2: Sdílený helper `balance-chain` a přepojení `savings-history`

**Files:**
- Create: `src/utils/balance-chain.js`
- Create: `src/utils/balance-chain.test.js`
- Modify: `src/routes/stats.js` — blok dopočtu zůstatků v `savings-history` (dnešní řádky ~455-465), import na řádku ~8

**Interfaces:**
- Consumes: nic z Tasku 1
- Produces:
  ```js
  chainBalances({ anchorIndex, anchorBalance, fromIndex, toIndex, netAt }) → Map<number, number>
  ```
  `netAt(absIdx)` je callback vracející čisté pohyby daného období. Task 4 helper použije s vlastním `netAt`.

**Kontext pro implementátora:** `savings-history` dnes kotví zůstatek posledním reálným snapshotem a od něj dopočítává oběma směry přes ABSOLUTNÍ `periodIndex`. Ta aritmetika je pro fondy identická, jen pohyby se počítají jinak — proto callback.

**Tenhle task nesmí změnit chování `savings-history`.** Je to čistá extrakce: stejná čísla, jiné místo. Stávající testy `savings-history` jsou tvoje pojistka.

- [ ] **Step 1: Napiš failující testy helperu**

Vytvoř `src/utils/balance-chain.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chainBalances } = require('./balance-chain');

test('chainBalances: dopočítá dopředu od kotvy', () => {
  // kotva na indexu 10 = 1000; období 11 přineslo +200, období 12 −50
  const net = { 11: 200, 12: -50 };
  const m = chainBalances({ anchorIndex: 10, anchorBalance: 1000, fromIndex: 10, toIndex: 12, netAt: i => net[i] || 0 });
  assert.equal(m.get(10), 1000);
  assert.equal(m.get(11), 1200);
  assert.equal(m.get(12), 1150);
});

test('chainBalances: dopočítá dozadu od kotvy (odečítá pohyby následujícího období)', () => {
  // zůstatek na konci období 9 = zůstatek na konci 10 minus to, co přibylo v 10
  const net = { 10: 300 };
  const m = chainBalances({ anchorIndex: 10, anchorBalance: 1000, fromIndex: 9, toIndex: 10, netAt: i => net[i] || 0 });
  assert.equal(m.get(10), 1000);
  assert.equal(m.get(9), 700);
});

test('chainBalances: kotva LEŽÍCÍ MIMO zobrazený rozsah funguje', () => {
  // kotva je novější než konec rozsahu → dopočet jde jen dozadu
  const net = { 9: 100, 10: 200 };
  const m = chainBalances({ anchorIndex: 10, anchorBalance: 1000, fromIndex: 8, toIndex: 9, netAt: i => net[i] || 0 });
  assert.equal(m.get(9), 800, '1000 − 200');
  assert.equal(m.get(8), 700, '800 − 100');
});

test('chainBalances: rozsah o jednom období vrátí jen kotvu', () => {
  const m = chainBalances({ anchorIndex: 5, anchorBalance: 42, fromIndex: 5, toIndex: 5, netAt: () => 999 });
  assert.equal(m.size, 1);
  assert.equal(m.get(5), 42);
});

test('chainBalances: netAt se volá jen pro období, která dopočet potřebuje', () => {
  const seen = [];
  chainBalances({ anchorIndex: 3, anchorBalance: 0, fromIndex: 2, toIndex: 4, netAt: i => { seen.push(i); return 0; } });
  assert.deepEqual(seen.sort((a, b) => a - b), [3, 4], 'kotvící období se dozadu odečítá, pro sebe se nepočítá');
});
```

- [ ] **Step 2: Spusť testy a ověř, že padají**

Run: `node --test --test-force-exit src/utils/balance-chain.test.js`
Expected: FAIL — `Cannot find module './balance-chain'`.

- [ ] **Step 3: Vytvoř helper**

Vytvoř `src/utils/balance-chain.js`:

```js
'use strict';

/**
 * Dopočet zůstatků po obdobích od jediné kotvy (posledního reálného snapshotu).
 *
 * Indexy jsou ABSOLUTNÍ `periodIndex`, ne pozice v zobrazeném poli — kotva může
 * ležet mimo zobrazený rozsah a řetězení se k ní musí dopočítat.
 *
 * Směr: dozadu se pohyby NÁSLEDUJÍCÍHO období odečítají, dopředu se pohyby
 * daného období přičítají. Zůstatek je vždy chápaný ke KONCI období.
 *
 * `netAt(absIdx)` dodává volající — spoření počítá pohyby přes dedup noh převodu,
 * fond prostým součtem transakcí na účtu. Aritmetika je pro oba stejná.
 */
function chainBalances({ anchorIndex, anchorBalance, fromIndex, toIndex, netAt }) {
  const balances = new Map([[anchorIndex, anchorBalance]]);
  for (let a = anchorIndex - 1; a >= fromIndex; a--) balances.set(a, balances.get(a + 1) - netAt(a + 1));
  for (let a = anchorIndex + 1; a <= toIndex; a++) balances.set(a, balances.get(a - 1) + netAt(a));
  return balances;
}

module.exports = { chainBalances };
```

- [ ] **Step 4: Spusť testy helperu**

Run: `node --test --test-force-exit src/utils/balance-chain.test.js`
Expected: PASS, všech pět testů.

- [ ] **Step 5: Přepoj `savings-history` na helper**

V `src/routes/stats.js` přidej k importům:

```js
const { chainBalances } = require('../utils/balance-chain');
```

V `savings-history` nahraď dnešní tři řádky dopočtu:

```js
    const balances = new Map([[anchorIdx, anchorRow.balance_after + after]]);
    for (let a = anchorIdx - 1; a >= fromIdx; a--) balances.set(a, balances.get(a + 1) - netAt(a + 1));
    for (let a = anchorIdx + 1; a <= toIdx; a++) balances.set(a, balances.get(a - 1) + netAt(a));
```

voláním helperu:

```js
    const balances = chainBalances({
      anchorIndex: anchorIdx,
      anchorBalance: anchorRow.balance_after + after,
      fromIndex: fromIdx,
      toIndex: toIdx,
      netAt,
    });
```

Okolní kód (výpočet `after`, `netCache`, `netAt`, zápis do `values`) nech beze změny.

- [ ] **Step 6: Ověř, že se `savings-history` nezměnil**

Run: `node --test --test-force-exit src/routes/stats.test.js`
Expected: PASS. Testy `savings-history` musí projít beze změny — to je celý smysl tohoto kroku. Kdyby některý spadl, extrakce není ekvivalentní: vrať se k původnímu kódu a porovnej směry smyček.

- [ ] **Step 7: Spusť celou backend sadu**

Run: `node --test --test-force-exit 'src/**/*.test.js'`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/utils/balance-chain.js src/utils/balance-chain.test.js src/routes/stats.js
git commit -m "refactor(kontrola-fondu): retezeni zustatku do sdileneho helperu"
git push origin staging
```

---

### Task 3: Výpočet krytí — `fund-coverage`

**Files:**
- Create: `src/utils/fund-coverage.js`
- Create: `src/utils/fund-coverage.test.js`

**Interfaces:**
- Consumes: sloupec `categories.fund_account_id` z Tasku 1
- Produces:
  ```js
  fundMovements(db, userId, accountId, start, end) → number   // čisté pohyby na účtu za období
  fundAnchor(db, userId, accountId) → { date, balance } | null // poslední snapshot
  fundRemaining(db, userId, accountId, today) → { remaining, items }
  ```
  `items` je pole `{ budget_item_id, category_id, category_name, name, amount, spent, remaining, window_from, window_to }`. Task 4 všechny tři funkce používá.

**Kontext pro implementátora:** Tohle je jádro featury. Tři vědomá rozhodnutí, nevymýšlej je jinak:

1. **Pohyby na fondu = prostý `SUM(amount)` přes `account_id`.** Ověřeno na produkčních datech: u obou fondových účtů vrací dotaz „účet i protiúčet je tentýž fond" **nula řádků**, takže se nohy převodů nepřekrývají. Dedup z `src/utils/savings.js` (nutný u spořicího účtu, kde je část pohybů zachycená jen jako protistrana na běžném účtu) se tady NEPOUŽIJE a `savings.js` se nedotýkáš.
2. **Čerpání podpoložky se počítá v jejím OKNĚ, ne za celý rok.** Kategorie Y_Lítačka má dvě položky — Tom (okno 4–5, zaplaceno) a Martin (okno 8–9, nezaplaceno). Roční plán minus roční čerpání by Martinovu lítačku z krytí odmazal. Okno drží obě nezávisle. Výpočet oken zkopíruj z `src/routes/budget-items.js:34-40` včetně cross-year větve.
3. **Aktivní položka = `window_to >= dnešek`.** Porovnává se konec datového okna, ne číslo měsíce — u cross-year okna (např. 10–1) leží konec v dalším roce a porovnání čísel by položku nesprávně vyřadilo.

- [ ] **Step 1: Napiš failující testy**

Vytvoř `src/utils/fund-coverage.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-fund-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  delete require.cache[require.resolve('./fund-coverage')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name,account_number,role,is_fund) VALUES (60,1,'Nepravidelné','1679014074/3030','spending',1)").run();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  try { fs.unlinkSync(tmp); } catch { /* ok */ }
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
}

test('fundMovements: čisté pohyby na účtu za období', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO transactions (user_id,account_id,amount,date,description) VALUES (1,60,5000,'2026-08-05','Dotace'),(1,60,-1200,'2026-08-10','Nákup'),(1,60,999,'2026-09-01','Mimo období')").run();
  const { fundMovements } = require('./fund-coverage');
  assert.equal(fundMovements(db, 1, 60, '2026-08-01', '2026-08-31'), 3800);
  cleanup(db, tmp);
});

test('fundAnchor: vrátí nejnovější snapshot', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO transactions (user_id,account_id,amount,date,description,balance_after) VALUES (1,60,-100,'2026-07-01','Starší',9000),(1,60,-200,'2026-08-18','Novější',7158.45)").run();
  const { fundAnchor } = require('./fund-coverage');
  assert.deepEqual(fundAnchor(db, 1, 60), { date: '2026-08-18', balance: 7158.45 });
  cleanup(db, tmp);
});

test('fundAnchor: účet bez snapshotu vrátí null', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO transactions (user_id,account_id,amount,date,description) VALUES (1,60,-100,'2026-07-01','Bez snapshotu')").run();
  const { fundAnchor } = require('./fund-coverage');
  assert.equal(fundAnchor(db, 1, 60), null);
  cleanup(db, tmp);
});

test('fundRemaining: položka s uplynulým oknem se ignoruje', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Lítačka',2,60)").run();
  // Tom: okno 4-5, uplynulo, nevyčerpáno. Martin: okno 8-9, aktivní.
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Lítačka Tom',3650,4,5),(2,1,70,'Lítačka Martin',3650,8,9)").run();
  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.remaining, 3650, 'jen Martinova lítačka');
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].name, 'Lítačka Martin');
  cleanup(db, tmp);
});

test('fundRemaining: čerpání se počítá v okně položky, ne za rok', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Lítačka',2,60)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Lítačka Tom',3650,4,5),(2,1,70,'Lítačka Martin',3650,8,9)").run();
  // Tomova lítačka zaplacená v dubnu — spadá do okna 4-5, NE do okna 8-9
  db.prepare("INSERT INTO transactions (user_id,account_id,category_id,amount,date,description) VALUES (1,60,70,-3650,'2026-04-15','Lítačka Tom')").run();
  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.remaining, 3650, 'dubnová platba nesmí snížit Martinovu položku');
  cleanup(db, tmp);
});

test('fundRemaining: přečerpaná položka nedává záporný zbytek', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Beach',2,60)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Beach zima',10200,9,12)").run();
  db.prepare("INSERT INTO transactions (user_id,account_id,category_id,amount,date,description) VALUES (1,60,70,-15000,'2026-09-20','Přeplaceno')").run();
  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.remaining, 0);
  assert.equal(r.items[0].remaining, 0);
  cleanup(db, tmp);
});

test('fundRemaining: kategorie bez fund_account_id do krytí nevstoupí', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Oblečení',2,NULL)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Oblečení',20000,1,12)").run();
  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.remaining, 0);
  assert.equal(r.items.length, 0);
  cleanup(db, tmp);
});

test('fundRemaining: kategorie odkazující na cizí/neexistující účet se nezapočítá', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Duch',2,999)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Duch',5000,1,12)").run();
  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.remaining, 0, 'osiřelý odkaz se chová jako NULL');
  cleanup(db, tmp);
});

test('fundRemaining: cross-year okno (10-1) je v srpnu stále aktivní', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Zima',2,60)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Zimní servis',4000,10,1)").run();
  const { fundRemaining } = require('./fund-coverage');
  const r = fundRemaining(db, 1, 60, '2026-08-26');
  assert.equal(r.remaining, 4000, 'konec okna je leden PŘÍŠTÍHO roku, ne uplynulý leden');
  cleanup(db, tmp);
});

test('fundRemaining: položky nesou rozpad pro zobrazení', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Beach',2,60)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Beach zima',10200,9,12)").run();
  db.prepare("INSERT INTO transactions (user_id,account_id,category_id,amount,date,description) VALUES (1,60,70,-1200,'2026-09-05','Záloha')").run();
  const { fundRemaining } = require('./fund-coverage');
  const it = fundRemaining(db, 1, 60, '2026-08-26').items[0];
  assert.equal(it.budget_item_id, 1);
  assert.equal(it.category_id, 70);
  assert.equal(it.category_name, 'Y_Beach');
  assert.equal(it.amount, 10200);
  assert.equal(it.spent, 1200);
  assert.equal(it.remaining, 9000);
  assert.equal(it.window_from, '2026-09-01');
  assert.equal(it.window_to, '2026-12-31');
  cleanup(db, tmp);
});
```

- [ ] **Step 2: Spusť testy a ověř, že padají**

Run: `node --test --test-force-exit src/utils/fund-coverage.test.js`
Expected: FAIL — `Cannot find module './fund-coverage'`.

- [ ] **Step 3: Implementuj util**

Vytvoř `src/utils/fund-coverage.js`:

```js
'use strict';

/**
 * Čisté pohyby na fondovém účtu za období.
 *
 * Na rozdíl od spořicího účtu (viz utils/savings.js) se tady NEDEDUPLIKUJE:
 * u fondových účtů jsou všechny nohy převodů zaúčtované přímo na fondu, takže
 * filtr na `account_id` každý pohyb vrátí právě jednou. Ověřeno na produkčních
 * datech — dotaz „účet i protiúčet je tentýž fond" vrací nula řádků.
 */
function fundMovements(db, userId, accountId, start, end) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS net
    FROM transactions
    WHERE user_id = ? AND account_id = ? AND date >= ? AND date <= ?
  `).get(userId, accountId, start, end);
  return row.net;
}

/**
 * Nejnovější snapshot zůstatku na účtu napříč CELOU historií (i mimo zobrazený
 * rozsah) — kotva pro dopočet. `null`, když účet nemá ani jeden snapshot.
 */
function fundAnchor(db, userId, accountId) {
  const row = db.prepare(`
    SELECT date, balance_after FROM transactions
    WHERE user_id = ? AND account_id = ? AND balance_after IS NOT NULL
    ORDER BY date DESC, COALESCE(tx_time, '') DESC, id DESC
    LIMIT 1
  `).get(userId, accountId);
  return row ? { date: row.date, balance: row.balance_after } : null;
}

/**
 * Datové okno podpoložky pro daný rok. Cross-year okno (window_start > window_end,
 * např. 10–1) končí v NÁSLEDUJÍCÍM roce — stejný výpočet jako routes/budget-items.js,
 * aby čísla seděla se stránkou Roční budgety.
 */
function itemWindow(item, year) {
  const toYear = item.window_start > item.window_end ? year + 1 : year;
  const lastDay = new Date(toYear, item.window_end, 0).getDate();
  return {
    from: `${year}-${String(item.window_start).padStart(2, '0')}-01`,
    to: `${toYear}-${String(item.window_end).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

/**
 * Kolik z fondu ještě letos odejde: součet nevyčerpaného plánu AKTIVNÍCH podpoložek
 * kategorií navázaných na tento fond.
 *
 * Aktivní = konec datového okna ještě nenastal. Uplynulá nevyčerpaná položka se
 * ignoruje (rozhodnutí uživatele): buď se výdaj nekonal, nebo šel jinudy, a počítat
 * ho by krytí zbytečně strašilo.
 *
 * Čerpání se bere V OKNĚ položky, ne za celý rok — kategorie může mít víc položek
 * s různými okny (Lítačka Tom 4–5 vs. Martin 8–9) a roční součet by je slil dohromady.
 *
 * ZNÁMÉ OMEZENÍ: u kategorie s víc položkami, jejichž okna se PŘEKRÝVAJÍ, se tatáž
 * platba odečte od každé z nich, takže krytí vyjde optimističtěji než realita. Přesně
 * by to řešila jen vazba transakce → podpoložka, kterou datový model nemá; stejnou
 * nepřesnost má i stránka Roční budgety.
 *
 * `today` se předává (formát 'YYYY-MM-DD'), ne bere z Date.now() — testovatelnost.
 */
function fundRemaining(db, userId, accountId, today) {
  const year = Number(today.slice(0, 4));

  // JOIN na accounts: osiřelý `fund_account_id` (účet mezitím smazaný — SQLite neumí
  // FK přidat přes ALTER TABLE) se tím chová jako NULL, tedy kategorie mimo fond.
  const items = db.prepare(`
    SELECT bi.id, bi.category_id, bi.name, bi.amount, bi.window_start, bi.window_end,
           c.name AS category_name
    FROM budget_items bi
    JOIN categories c ON c.id = bi.category_id AND c.user_id = bi.user_id
    JOIN accounts a ON a.id = c.fund_account_id AND a.user_id = c.user_id AND a.is_fund = 1
    WHERE bi.user_id = ? AND c.fund_account_id = ?
    ORDER BY bi.window_start, bi.id
  `).all(userId, accountId);

  const spentStmt = db.prepare(`
    SELECT COALESCE(SUM(-amount), 0) AS spent
    FROM transactions
    WHERE user_id = ? AND category_id = ? AND date >= ? AND date <= ?
  `);

  const out = [];
  for (const item of items) {
    const w = itemWindow(item, year);
    if (w.to < today) continue;   // okno uplynulo → ignoruj
    const { spent } = spentStmt.get(userId, item.category_id, w.from, w.to);
    out.push({
      budget_item_id: item.id,
      category_id: item.category_id,
      category_name: item.category_name,
      name: item.name,
      amount: item.amount,
      spent,
      remaining: Math.max(0, item.amount - spent),
      window_from: w.from,
      window_to: w.to,
    });
  }

  return { remaining: out.reduce((s, i) => s + i.remaining, 0), items: out };
}

module.exports = { fundMovements, fundAnchor, fundRemaining, itemWindow };
```

- [ ] **Step 4: Spusť testy a ověř, že prochází**

Run: `node --test --test-force-exit src/utils/fund-coverage.test.js`
Expected: PASS, všech deset testů.

- [ ] **Step 5: Commit**

```bash
git add src/utils/fund-coverage.js src/utils/fund-coverage.test.js
git commit -m "feat(kontrola-fondu): vypocet kryti fondu"
git push origin staging
```

---

### Task 4: Endpoint `GET /api/stats/fund-history`

**Files:**
- Modify: `src/routes/stats.js` — nový router handler za `savings-history` (před `module.exports`), import na řádku ~8
- Test: `src/routes/stats.test.js` (přidat na konec)

**Interfaces:**
- Consumes: `chainBalances` (Task 2), `fundMovements` / `fundAnchor` / `fundRemaining` (Task 3), sloupec `fund_account_id` (Task 1)
- Produces: `GET /api/stats/fund-history?account_id=&from=&to=` s odpovědí popsanou níž. Task 5 ji konzumuje.

**Kontext pro implementátora:** Tvar `values` musí být **stejný jako u `savings-history`** (`period`, `net`, `tx_ids`, `balance_derived`, `balance_actual`), aby šla použít existující komponenta grafu bez zásahu do jejího rozhraní.

`balance: null` (fond bez jediného snapshotu) NENÍ chyba — je to legitimní stav, klient v tom případě kartu krytí skryje.

Konstanty `PERIOD_KEY_RE`, `MAX_PERIODS`, `MIN_DEFAULT_PERIODS` jsou v souboru už deklarované (řádky ~256-258), znovu je nedeklaruj.

- [ ] **Step 1: Napiš failující testy**

Přidej na konec `src/routes/stats.test.js`:

```js
test('fund-history: 400 pro nefondový účet', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO accounts (id,user_id,name,account_number,role,is_fund) VALUES (61,1,'Společný','1679014023/3030','spending',0)").run();
  const res = await fetch(`${base}/api/stats/fund-history?account_id=61`);
  const body = await res.json();
  server.close();
  assert.equal(res.status, 400);
  assert.equal(body.error, 'Účet není fondový.');
});

test('fund-history: 400 pro cizí účet', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO users (id,email) VALUES (2,'b@x')").run();
  db.prepare("INSERT INTO accounts (id,user_id,name,account_number,role,is_fund) VALUES (62,2,'Cizí fond','9999999999/3030','spending',1)").run();
  const res = await fetch(`${base}/api/stats/fund-history?account_id=62`);
  server.close();
  assert.equal(res.status, 400);
});

test('fund-history: 400 pro chybný formát období', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO accounts (id,user_id,name,account_number,role,is_fund) VALUES (60,1,'Nepravidelné','1679014074/3030','spending',1)").run();
  const res = await fetch(`${base}/api/stats/fund-history?account_id=60&from=2026-1&to=2026-08`);
  server.close();
  assert.equal(res.status, 400);
});

test('fund-history: krytí = zůstatek minus zbývající plán', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO accounts (id,user_id,name,account_number,role,is_fund) VALUES (60,1,'Nepravidelné','1679014074/3030','spending',1)").run();
  db.prepare("INSERT INTO categories (id,user_id,name,type,fund_account_id) VALUES (70,1,'Y_Beach',2,60)").run();
  db.prepare("INSERT INTO budget_items (id,user_id,category_id,name,amount,window_start,window_end) VALUES (1,1,70,'Beach zima',10200,9,12)").run();
  db.prepare("INSERT INTO transactions (user_id,account_id,amount,date,description,balance_after) VALUES (1,60,-14361.11,'2026-08-18','Servis',7158.45)").run();
  const res = await fetch(`${base}/api/stats/fund-history?account_id=60&from=2026-06&to=2026-08`);
  const body = await res.json();
  server.close();
  assert.equal(res.status, 200);
  assert.equal(body.account.id, 60);
  assert.equal(body.coverage.balance, 7158.45);
  assert.equal(body.coverage.balance_date, '2026-08-18');
  assert.equal(body.coverage.remaining, 10200);
  assert.equal(Math.round(body.coverage.diff), -3042);
  assert.equal(body.coverage.items.length, 1);
});

test('fund-history: fond bez snapshotu vrátí balance null, ne chybu', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO accounts (id,user_id,name,account_number,role,is_fund) VALUES (60,1,'Nepravidelné','1679014074/3030','spending',1)").run();
  db.prepare("INSERT INTO transactions (user_id,account_id,amount,date,description) VALUES (1,60,-500,'2026-08-05','Bez snapshotu')").run();
  const res = await fetch(`${base}/api/stats/fund-history?account_id=60&from=2026-07&to=2026-08`);
  const body = await res.json();
  server.close();
  assert.equal(res.status, 200);
  assert.equal(body.coverage.balance, null);
  assert.equal(body.coverage.diff, null);
  assert.equal(body.values.every(v => v.balance_derived === null), true);
});

test('fund-history: values mají stejný tvar jako savings-history', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO accounts (id,user_id,name,account_number,role,is_fund) VALUES (60,1,'Nepravidelné','1679014074/3030','spending',1)").run();
  db.prepare("INSERT INTO transactions (user_id,account_id,amount,date,description,balance_after) VALUES (1,60,3000,'2026-08-10','Dotace',9000)").run();
  const res = await fetch(`${base}/api/stats/fund-history?account_id=60&from=2026-07&to=2026-08`);
  const body = await res.json();
  server.close();
  const v = body.values[body.values.length - 1];
  for (const key of ['period', 'net', 'tx_ids', 'balance_derived', 'balance_actual']) {
    assert.ok(key in v, `values musí obsahovat ${key}`);
  }
  assert.equal(v.net, 3000);
  assert.equal(v.balance_actual, 9000);
});
```

- [ ] **Step 2: Spusť testy a ověř, že padají**

Run: `node --test --test-force-exit src/routes/stats.test.js`
Expected: FAIL — 404 z Expressu (route neexistuje), takže `res.json()` selže nebo vrátí HTML chybu.

- [ ] **Step 3: Přidej import**

V `src/routes/stats.js` doplň k importům:

```js
const { fundMovements, fundAnchor, fundRemaining } = require('../utils/fund-coverage');
```

(`chainBalances` importoval už Task 2.)

- [ ] **Step 4: Implementuj endpoint**

Vlož do `src/routes/stats.js` za handler `savings-history` a před `module.exports = router;`:

```js
// ── GET /api/stats/fund-history?account_id=&from=YYYY-MM&to=YYYY-MM ────────
// Kontrola fondu: krytí (zůstatek proti tomu, co z fondu ještě letos odejde)
// + historie zůstatku po obdobích. `values` mají ZÁMĚRNĚ stejný tvar jako
// savings-history, aby šla použít táž komponenta grafu.
router.get('/fund-history', requireAuth, (req, res) => {
  const accountId = parseInt(req.query.account_id, 10);
  const account = Number.isInteger(accountId)
    ? db.prepare('SELECT id, name, account_number FROM accounts WHERE id = ? AND user_id = ? AND is_fund = 1')
        .get(accountId, req.dataUserId)
    : null;
  if (!account) return res.status(400).json({ error: 'Účet není fondový.' });

  const billingDay = getUserBillingDay(db, req.dataUserId);
  // Jako u spoření se zobrazuje i BĚŽÍCÍ období — u fondu je rozjetý měsíc
  // podstatná informace, ne zavádějící propad.
  const fallback = defaultHistoryRange(currentPeriodKey(billingDay), MIN_DEFAULT_PERIODS);
  const to = req.query.to || currentPeriodKey(billingDay);
  const from = req.query.from || fallback.from;

  if (!PERIOD_KEY_RE.test(from) || !PERIOD_KEY_RE.test(to)) {
    return res.status(400).json({ error: 'Parametry from/to musí mít formát YYYY-MM.' });
  }
  const count = periodIndex(to) - periodIndex(from) + 1;
  if (count < 1) return res.status(400).json({ error: 'Parametr from musí být menší nebo roven to.' });
  if (count > MAX_PERIODS) return res.status(400).json({ error: `Rozsah je omezený na ${MAX_PERIODS} období.` });

  const today = new Date().toISOString().slice(0, 10);
  const periods = [];
  for (let i = 0; i < count; i++) {
    const key = shiftPeriodKey(from, i);
    const dates = getPeriodDates(billingDay, key);
    periods.push({ key, ...dates, partial: dates.end >= today });
  }

  const txIdStmt = db.prepare(`
    SELECT id FROM transactions
    WHERE user_id = ? AND account_id = ? AND date >= ? AND date <= ?
    ORDER BY date, id
  `);
  const snapStmt = db.prepare(`
    SELECT balance_after FROM transactions
    WHERE user_id = ? AND account_id = ? AND balance_after IS NOT NULL
      AND date >= ? AND date <= ?
    ORDER BY date DESC, COALESCE(tx_time, '') DESC, id DESC
    LIMIT 1
  `);

  const values = periods.map(p => {
    const snap = snapStmt.get(req.dataUserId, account.id, p.start, p.end);
    return {
      period: p.key,
      net: fundMovements(db, req.dataUserId, account.id, p.start, p.end),
      // Proklik jede přes tx_ids stejně jako u spoření — filtr podle účtu a data
      // by v Transakcích nešel vyjádřit tak, aby seznam seděl na součet.
      tx_ids: txIdStmt.all(req.dataUserId, account.id, p.start, p.end).map(r => r.id),
      balance_derived: null,
      balance_actual: snap ? snap.balance_after : null,
    };
  });

  const anchor = fundAnchor(db, req.dataUserId, account.id);
  if (anchor) {
    const fromIdx = periodIndex(from);
    const toIdx = periodIndex(to);
    const anchorIdx = periodIndex(periodKeyForDate(billingDay, anchor.date));

    const netCache = new Map();
    values.forEach((v, i) => netCache.set(fromIdx + i, v.net));
    const netAt = absIdx => {
      if (!netCache.has(absIdx)) {
        const d = getPeriodDates(billingDay, shiftPeriodKey(from, absIdx - fromIdx));
        netCache.set(absIdx, fundMovements(db, req.dataUserId, account.id, d.start, d.end));
      }
      return netCache.get(absIdx);
    };

    // Zůstatek ke KONCI kotvícího období: ke kotvě se přičtou pohyby, které v témže
    // období nastaly po ní (porovnání na úrovni dne, stejně jako u spoření).
    const anchorDates = getPeriodDates(billingDay, periodKeyForDate(billingDay, anchor.date));
    const after = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS s
      FROM transactions
      WHERE user_id = ? AND account_id = ? AND date > ? AND date <= ?
    `).get(req.dataUserId, account.id, anchor.date, anchorDates.end).s;

    const balances = chainBalances({
      anchorIndex: anchorIdx,
      anchorBalance: anchor.balance + after,
      fromIndex: fromIdx,
      toIndex: toIdx,
      netAt,
    });
    values.forEach((v, i) => {
      const b = balances.get(fromIdx + i);
      if (b != null) v.balance_derived = b;
    });
  }

  const { remaining, items } = fundRemaining(db, req.dataUserId, account.id, today);

  res.json({
    from, to, billing_day: billingDay,
    account,
    coverage: {
      balance: anchor ? anchor.balance : null,
      balance_date: anchor ? anchor.date : null,
      remaining,
      diff: anchor ? anchor.balance - remaining : null,
      items,
    },
    periods, values,
    totals: { net: values.reduce((s, v) => s + v.net, 0) },
    anchor: anchor ? { date: anchor.date, balance: anchor.balance } : null,
  });
});
```

- [ ] **Step 5: Spusť testy a ověř, že prochází**

Run: `node --test --test-force-exit src/routes/stats.test.js`
Expected: PASS, všech šest nových testů a žádný stávající rozbitý.

- [ ] **Step 6: Spusť celou backend sadu**

Run: `node --test --test-force-exit 'src/**/*.test.js'`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/stats.js src/routes/stats.test.js
git commit -m "feat(kontrola-fondu): endpoint fund-history"
git push origin staging
```

---

### Task 5: Stránka „Kontrola fondů"

**Files:**
- Create: `client/src/pages/FundHistoryPage.jsx`
- Modify: `client/src/App.jsx:116` (nová route za `/savings-history`)
- Modify: `client/src/components/Sidebar.jsx:35` (nová položka menu)
- Modify: `client/src/i18n.js` (klíč `nav.fundHistory`)
- Modify: `client/src/App.css` (styly karty krytí)

**Interfaces:**
- Consumes: `GET /api/stats/fund-history` (Task 4), `GET /api/accounts`
- Produces: nic pro další tasky

**Kontext pro implementátora:** Vzor si vezmi z `client/src/pages/SavingsHistoryPage.jsx` (187 řádků) — načítání, ošetření chyby, přepínač tabulky, proklik přes `tx_ids`. Komponentu `SavingsHistoryChart` použij **beze změny jejího rozhraní**: bere `periods`, `values`, `onPeriodClick`, `clickablePeriods`, `showDerived`, `showActual`.

Tři věci, které se snadno pokazí:

1. **`formatCurrency` vrací ABSOLUTNÍ hodnotu.** Znaménko skládej ručně znakem `−` (U+2212), ne ASCII pomlčkou. Helper `signPrefix` z `utils/chartScale` na to v tomhle repu existuje.
2. **Proklik musí vézt `period`**, jinak `TransactionsPage` AND-uje aktuálně zvolené období z kontextu a vrátí prázdno.
3. **Klient nemá komponentní testy** — ověřuje se buildem a lintem.

- [ ] **Step 1: Přidej překladový klíč**

V `client/src/i18n.js` přidej do objektu `nav` vedle `savingsHistory`:

```js
    fundHistory: 'Kontrola fondů',
```

- [ ] **Step 2: Přidej styly karty krytí**

V `client/src/App.css` přidej na konec:

```css
/* Karta krytí fondu — velké číslo „vyjde to?" nad grafem vývoje */
.fund-coverage {
  background: var(--bg3);
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 16px;
}
.fund-coverage-value {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.15;
}
.fund-coverage-note {
  font-size: 13px;
  margin-top: 6px;
}
.fund-coverage-rows {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
}
.fund-coverage-row { display: flex; justify-content: space-between; }
```

- [ ] **Step 3: Vytvoř stránku**

Vytvoř `client/src/pages/FundHistoryPage.jsx`:

```jsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Table2 } from 'lucide-react';
import Layout from '../components/Layout';
import SavingsHistoryChart from '../components/SavingsHistoryChart';
import { t, formatCurrency } from '../i18n';
import { shortPeriodLabel, signPrefix } from '../utils/chartScale';

export default function FundHistoryPage() {
  const navigate = useNavigate();
  const [funds, setFunds] = useState([]);
  const [accountId, setAccountId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTable, setShowTable] = useState(false);

  // Seznam fondových účtů — bez něj nevíme, co do přepínače dát.
  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then(list => {
        const f = (list || []).filter(a => a.is_fund);
        setFunds(f);
        setAccountId(prev => prev ?? (f[0]?.id ?? null));
        if (!f.length) setLoading(false);
      })
      .catch(() => { setError('Načtení účtů se nepovedlo.'); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    fetch(`/api/stats/fund-history?account_id=${accountId}`)
      .then(async r => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Načtení se nepovedlo.');
        return body;
      })
      .then(d => { setError(''); setData(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [accountId]);

  const periods = useMemo(() => data?.periods || [], [data]);
  const values = useMemo(() => data?.values || [], [data]);
  const coverage = data?.coverage || null;
  const clickablePeriods = useMemo(() => values.map(v => (v.tx_ids || []).length > 0), [values]);

  function openTransactions(index) {
    const ids = values[index]?.tx_ids || [];
    if (!ids.length) return;
    const period = periods[index]?.key;
    navigate(`/transactions?tx_ids=${ids.join(',')}${period ? `&period=${period}` : ''}`);
  }

  function openItem(item) {
    navigate(`/transactions?category_ids=${item.category_id}&from=${item.window_from}&to=${item.window_to}`);
  }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{t.nav.fundHistory}</h1>
        <button className="btn btn-ghost" onClick={() => setShowTable(v => !v)}
          title={showTable ? 'Zobrazit graf' : 'Zobrazit tabulku'}>
          {showTable ? <BarChart3 size={18} /> : <Table2 size={18} />}
        </button>
      </div>

      {funds.length > 1 && (
        <div className="tx-chip-row" style={{ marginBottom: 12 }}>
          {funds.map(f => (
            <button key={f.id}
              className={`tx-chip${f.id === accountId ? ' tx-chip-active' : ''}`}
              onClick={() => setAccountId(f.id)}>
              {f.name}
            </button>
          ))}
        </div>
      )}

      {loading ? <div className="page-loading">Načítání…</div> : error ? (
        <div className="text-danger">{error}</div>
      ) : !funds.length ? (
        <div className="text-muted">
          Žádný fondový účet. Fond se označí zaškrtnutím „fondový účet" u účtu v Nastavení.
        </div>
      ) : (
        <>
          {coverage && coverage.balance == null ? (
            <div className="fund-coverage">
              <div className="text-muted">
                Zůstatek zatím neznáme — na tomto účtu nedorazila žádná platba se zůstatkem
                z bankovní notifikace. Krytí se ukáže, jakmile první přijde.
              </div>
              <div className="fund-coverage-rows">
                <div className="fund-coverage-row">
                  <span>Zbývá vyčerpat do konce roku</span>
                  <span>{formatCurrency(coverage.remaining)}</span>
                </div>
              </div>
            </div>
          ) : coverage && (
            <div className="fund-coverage">
              <div className={`fund-coverage-value ${coverage.diff >= 0 ? 'text-success' : 'text-danger'}`}>
                {coverage.diff >= 0 ? 'Zbývá po pokrytí ' : 'Chybí '}
                {signPrefix(coverage.diff)} {formatCurrency(Math.abs(coverage.diff))}
              </div>
              <div className="fund-coverage-note text-muted">
                {coverage.diff >= 0
                  ? 'Fond pokryje roční výdaje, které z něj do konce roku ještě odejdou.'
                  : 'Fond nepokryje roční výdaje, které z něj do konce roku ještě odejdou.'}
              </div>
              <div className="fund-coverage-rows">
                <div className="fund-coverage-row">
                  <span>Zůstatek k {coverage.balance_date}</span>
                  <span>{formatCurrency(coverage.balance)}</span>
                </div>
                <div className="fund-coverage-row">
                  <span>Zbývá vyčerpat do konce roku</span>
                  <span>− {formatCurrency(coverage.remaining)}</span>
                </div>
              </div>
            </div>
          )}

          {coverage?.items?.length > 0 && (
            <section className="report-section">
              <div className="report-section-header">Z čeho se skládá „zbývá vyčerpat"</div>
              <div className="chart-table-scroll">
              <table className="chart-table">
                <thead>
                  <tr>
                    <th>Položka</th><th>Kategorie</th>
                    <th className="num">Plán</th><th className="num">Vyčerpáno</th><th className="num">Zbývá</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.items.map(i => (
                    <tr key={i.budget_item_id} style={{ cursor: 'pointer' }} onClick={() => openItem(i)}
                      title="Klik: transakce kategorie v okně této položky">
                      <td>{i.name}</td>
                      <td className="text-muted">{i.category_name}</td>
                      <td className="num">{formatCurrency(i.amount)}</td>
                      <td className="num">{formatCurrency(i.spent)}</td>
                      <td className="num">{formatCurrency(i.remaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </section>
          )}

          {showTable ? (
            <div className="chart-table-scroll">
            <table className="chart-table">
              <thead>
                <tr><th>Období</th><th className="num">Saldo</th><th className="num">Zůstatek</th></tr>
              </thead>
              <tbody>
                {values.map((v, i) => (
                  <tr key={v.period}>
                    <td>{shortPeriodLabel(periods[i]?.key || v.period)}</td>
                    <td className="num">{signPrefix(v.net)} {formatCurrency(Math.abs(v.net))}</td>
                    <td className="num">{v.balance_derived == null ? '—' : formatCurrency(v.balance_derived)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <SavingsHistoryChart
              periods={periods}
              values={values}
              onPeriodClick={openTransactions}
              clickablePeriods={clickablePeriods}
            />
          )}
        </>
      )}
    </Layout>
  );
}
```

**CSS třídy jsou ověřené proti `App.css`, neměň je:** přepínač = `tx-chip-row` + `tx-chip` / `tx-chip-active` (globální třídy, používá je i filtr kategorií v Transakcích), tabulky = `chart-table` uvnitř `chart-table-scroll` s `num` na číselných buňkách (vzor: `SavingsTable` v `SavingsHistoryPage.jsx:158-180`). Třídy `filter-chips`, `chip` ani `data-table` v tomhle projektu NEEXISTUJÍ.

**Proklik `openItem` je ověřený:** `TransactionsPage` čte z URL `from`/`to` (řádky 64-65) a zapne jimi free-range režim (`customMode`), který se kombinuje s `category_ids`. Perioda se v tomhle případě neposílá — free-range ji nahrazuje.

- [ ] **Step 4: Zaregistruj route a menu**

V `client/src/App.jsx` přidej import vedle ostatních stránek a route za `/savings-history`:

```jsx
            <Route path="/fund-history" element={<R el={<FundHistoryPage />} />} />
```

V `client/src/components/Sidebar.jsx` přidej za položku `savingsHistory`:

```jsx
      { to: '/fund-history', icon: PiggyBank, label: t.nav.fundHistory },
```

`PiggyBank` doplň do importu z `lucide-react` v témže souboru.

- [ ] **Step 5: Ověř build a lint**

Run: `npm run build` (z kořene), pak `npm run lint` (v adresáři `client`)
Expected: build OK, lint 0 chyb (8 předexistujících warningů je v pořádku). Spusť obojí synchronně — lint neodhalí všechno, například `await` v ne-async callbacku projde lintem a spadne až v buildu.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/FundHistoryPage.jsx client/src/App.jsx client/src/components/Sidebar.jsx client/src/i18n.js client/src/App.css
git commit -m "feat(kontrola-fondu): stranka Kontrola fondu"
git push origin staging
```

---

### Task 6: Výběr fondu u roční kategorie

**Files:**
- Modify: `client/src/pages/AnnualBudgetsPage.jsx` (načtení účtů + select u karty kategorie)

**Interfaces:**
- Consumes: `PATCH /api/categories/:id` s polem `fund_account_id` (Task 1), `GET /api/accounts`
- Produces: nic (poslední task)

**Kontext pro implementátora:** Bez tohohle kroku je celá featura mrtvá — krytí se počítá jen z kategorií, které mají fond nastavený, a nastavit ho jinak než přes API zatím nejde.

`AnnualBudgetsPage` načítá data v `useEffect` na řádcích ~95-110 přes `Promise.all`. Kategorie bere z `stats.by_category` (pole `by_category` obsahuje `type`, ale **ne** `fund_account_id`), takže si musíš dotáhnout i `/api/categories`.

**Po uložení dělej refetch ze serveru**, ne lokální dopočet — je to opakovaná chyba v tomhle repu („UI si dopočítává server-počítaná pole"), kvůli které už se čtyřikrát opravovalo.

- [ ] **Step 1: Dotáhni účty a kategorie**

V `AnnualBudgetsPage` přidej stavy:

```jsx
  const [fundAccounts, setFundAccounts] = useState([]);
  const [catFund, setCatFund] = useState({});   // category_id → fund_account_id | null
```

A do existujícího `Promise.all` v `useEffect` přidej dva fetch:

```jsx
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/categories').then(r => r.json()),
```

V `.then` je rozbal a ulož (pořadí prvků musí odpovídat pořadí fetch volání):

```jsx
      setFundAccounts((accounts || []).filter(a => a.is_fund));
      const map = {};
      (allCats || []).forEach(c => { map[c.id] = c.fund_account_id ?? null; });
      setCatFund(map);
```

- [ ] **Step 2: Přidej ukládací funkci**

```jsx
  // Uložení vazby na fond. Po úspěchu se načte znovu celý stav ze serveru —
  // krytí i seznam kategorií jsou server-počítané a lokální dopočet by se rozešel.
  async function saveFund(categoryId, value) {
    const res = await fetch(`/api/categories/${categoryId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fund_account_id: value === '' ? null : Number(value) }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || 'Uložení se nepovedlo.');
      return;
    }
    const fresh = await fetch('/api/categories').then(r => r.json());
    const map = {};
    (fresh || []).forEach(c => { map[c.id] = c.fund_account_id ?? null; });
    setCatFund(map);
  }
```

- [ ] **Step 3: Přidej select do karty kategorie**

Do bloku, který vykresluje jednu roční kategorii (uvnitř `cats.map(...)`), přidej pod nadpis kategorie:

```jsx
                {fundAccounts.length > 0 && (
                  <label className="text-muted" style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                    Financuje se z fondu:
                    <select
                      value={catFund[c.id] ?? ''}
                      onChange={e => saveFund(c.id, e.target.value)}
                    >
                      <option value="">— nefinancuje se z fondu —</option>
                      {fundAccounts.map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </label>
                )}
```

Umísti ho tak, aby seděl do stávající struktury karty — podívej se, jak jsou v souboru poskládané ostatní řádky kategorie, a drž stejný rytmus.

- [ ] **Step 4: Ověř build a lint**

Run: `npm run build` (z kořene), pak `npm run lint` (v adresáři `client`)
Expected: build OK, lint 0 chyb.

- [ ] **Step 5: Spusť kompletní ověření**

Run: `node --test --test-force-exit 'src/**/*.test.js'`
Expected: PASS.

Run: `node --test 'client/src/utils/*.test.js'`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/AnnualBudgetsPage.jsx
git commit -m "feat(kontrola-fondu): vyber fondu u rocni kategorie"
git push origin staging
```

- [ ] **Step 7: Do reportu napiš, co musí uživatel ověřit ručně**

Feature je po nasazení **prázdná**, dokud uživatel nepřiřadí kategorie k fondům. Do reportu uveď:

1. Na Ročních budgetech nastavit u ročních kategorií fond (Y_Licence → Licence; Y_PrEP, Y_Auto Moto, Y_Pojistky, Y_Lítačka, Y_Beach → Nepravidelné; Y_Oblečení nechat prázdné).
2. Na Kontrole fondů zkontrolovat, že krytí pro Nepravidelné odpovídá očekávání (zůstatek ~7 158, zbývá Beach zima 10 200).
3. Ověřit, že proklik z řádku položky vrátí transakce kategorie v okně.

---

## Mimo scope tohoto plánu

Ze spec sekce 9, vědomě odloženo:

- Alerty a push notifikace při poklesu krytí pod nulu.
- Vazba transakce → podpoložka, která by odstranila omezení překrývajících se oken.
- Sledování zůstatku u nefondových účtů.
- Zpětné doplnění `balance_after` do historie.
