# Mimořádné příjmy — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nečekaný jednorázový příjem (přeplatek energií, dar, výhra) se zařadí do systémové kategorie „Mimořádné příjmy" a na Schůzce se ukáže pod čarou provozní bilance, takže srovnatelnost měsíců zůstane zachovaná.

**Architecture:** Nová systémová kategorie `system_role = 'extra_income'` (`type = 4`) bootstrapovaná v `schema.js` stejným vzorem jako `fund_topup` a `prepaid_purchase`. `GET /api/stats/overview` k ní vrátí agregát `extra_income` (saldo za období). Aby se částka nezapočítala dvakrát, vyloučí se z výpočtu příjmů (`incomeSourcesForPeriod`) a z kontrolní sekce Účetní. Klient dostane dvoustupňovou bilanci: provozní přebytek → mimořádné příjmy → Na spořicí.

**Tech Stack:** Node.js + Express, better-sqlite3, `node:test`, React + Vite.

**Spec:** `docs/superpowers/specs/2026-08-25-mimoradne-prijmy-design.md`

## Global Constraints

- Název kategorie přesně: `Mimořádné příjmy`. Barva `#10b981`, ikona `Gift`, `type = 4`, `system_role = 'extra_income'`.
- Žádná nová tabulka, žádný nový sloupec v `transactions`, žádná migrace dat.
- Jazyk UI je čeština včetně diakritiky (`i18n.js` a hardcoded stringy v `ReportPage`).
- Backend testy se spouští `node --test --test-force-exit 'src/**/*.test.js'` — cesta MUSÍ být v uvozovkách jako glob; `node --test src/` visí.
- Klientské testy: `node --test 'client/src/utils/*.test.js'`.
- Po každé změně kódu commit a push do větve `staging` (ne `main`).
- Zpětná kompatibilita: uživatel bez kategorie `extra_income` (bootstrap ještě neproběhl) musí dostat dnešní chování, ne chybu.

---

### Task 1: Bootstrap systémové kategorie `extra_income`

**Files:**
- Modify: `src/db/schema.js` (na konec `initSchema()`, za blok `prepaid_purchase`, tj. za dnešní řádek ~586)
- Test: `src/db/schema.test.js` (přidat na konec)
- Test: `src/utils/transfer-category.test.js` (přidat regresní test na konec)
- Test: `src/routes/categories.test.js` (přidat regresní testy ochrany na konec)
- Test: `src/utils/fixed-expenses.test.js` (přidat regresní test guardu na konec)

**Interfaces:**
- Consumes: nic (první task)
- Produces: kategorie s `system_role = 'extra_income'`, `type = 4`, `name = 'Mimořádné příjmy'`. Tasky 2 a 3 ji dohledávají dotazem `SELECT id, name FROM categories WHERE user_id = ? AND system_role = 'extra_income'`.

**Kontext pro implementátora:** `initSchema()` běží při každém startu aplikace, takže všechno v něm musí být idempotentní. Na `categories(user_id, name)` je unique index — kdyby si uživatel kategorii stejného jména založil sám, `INSERT` by spadl; proto se takový řádek místo vkládání povýší. Kategorie se zakládá jen uživatelům, kteří už nějaké kategorie mají: v household sharingu je vlastní jen data owner a členovi domácnosti by vznikl mrtvý záznam.

- [ ] **Step 1: Napiš failující test na bootstrap**

Přidej na konec `src/db/schema.test.js`:

```js
test('extra_income: bootstrap kategorie vznikne jen uživateli s kategoriemi a je idempotentní', () => {
  const tmp = path.join(os.tmpdir(), `spendex-extra-bootstrap-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@x'),(2,'b@x')").run();
  db.prepare("INSERT INTO categories (user_id, name) VALUES (1,'Jídlo')").run();
  require('../db/schema').initSchema();
  require('../db/schema').initSchema();
  const rows = db.prepare("SELECT user_id, name, type, color, icon FROM categories WHERE system_role = 'extra_income'").all();
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.equal(rows.length, 1, 'právě jedna kategorie extra_income (jen pro user 1)');
  assert.equal(rows[0].user_id, 1);
  assert.equal(rows[0].type, 4);
  assert.equal(rows[0].name, 'Mimořádné příjmy');
  assert.equal(rows[0].color, '#10b981');
  assert.equal(rows[0].icon, 'Gift');
});

test('extra_income: stejnojmenná uživatelská kategorie se povýší, nevznikne duplicita', () => {
  const tmp = path.join(os.tmpdir(), `spendex-extra-promote-${Date.now()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@x')").run();
  const id = db.prepare("INSERT INTO categories (user_id, name, type) VALUES (1,'Mimořádné příjmy',1)").run().lastInsertRowid;
  db.prepare("INSERT INTO budgets (user_id, category_id, month, amount) VALUES (1,?, 'default', 500)").run(id);
  require('../db/schema').initSchema();
  const rows = db.prepare("SELECT id, type, system_role FROM categories WHERE user_id = 1 AND name = 'Mimořádné příjmy'").all();
  const budgets = db.prepare('SELECT COUNT(*) AS n FROM budgets WHERE category_id = ?').get(id);
  db.close();
  fs.unlinkSync(tmp);
  try { fs.unlinkSync(tmp + '-wal'); fs.unlinkSync(tmp + '-shm'); } catch { /* ok */ }
  assert.equal(rows.length, 1, 'nevznikla duplicita');
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].type, 4);
  assert.equal(rows[0].system_role, 'extra_income');
  assert.equal(budgets.n, 0, 'mrtvý měsíční budget se smaže');
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `node --test --test-force-exit src/db/schema.test.js`
Expected: FAIL — `rows.length` je 0 místo 1 („právě jedna kategorie extra_income").

- [ ] **Step 3: Implementuj bootstrap**

V `src/db/schema.js` vlož za blok `prepaid_purchase` (končí `}` uzavírající `for (const o of prepaidOwners)`) a PŘED uzavírající `}` funkce `initSchema()`:

```js
  // Bootstrap kategorie extra_income (Mimořádné příjmy). Stejná pravidla jako
  // fund_topup a prepaid_purchase výš: jen pro uživatele, kteří UŽ MAJÍ kategorie
  // (v household sharingu je má jen data owner), stejnojmenná uživatelská
  // kategorie se povýší místo vkládání, idempotentní.
  //
  // Jediná systémová kategorie na PŘÍJMOVÉ straně — proto zelená a ikona daru.
  const EXTRA_INCOME_NAME = 'Mimořádné příjmy';
  const extraIncomeOwners = db.prepare(`
    SELECT DISTINCT user_id FROM categories
    WHERE user_id NOT IN (SELECT user_id FROM categories WHERE system_role = 'extra_income')
  `).all();
  const promoteExtraIncome = db.prepare("UPDATE categories SET type = 4, system_role = 'extra_income' WHERE id = ?");
  const insExtraIncome = db.prepare(`
    INSERT INTO categories (user_id, name, type, color, icon, system_role)
    VALUES (?, ?, 4, '#10b981', 'Gift', 'extra_income')
  `);
  for (const o of extraIncomeOwners) {
    try {
      const existing = findByName.get(o.user_id, EXTRA_INCOME_NAME);
      if (existing) {
        promoteExtraIncome.run(existing.id);
        deleteBudgets.run(o.user_id, existing.id);
      } else {
        insExtraIncome.run(o.user_id, EXTRA_INCOME_NAME);
      }
    } catch { /* selhání bootstrapu pro jednoho uživatele – ostatní pokračují */ }
  }
```

`findByName` a `deleteBudgets` jsou už deklarované výš v bloku `fund_topup` — znovu je nedeklaruj, jinak dostaneš `SyntaxError: Identifier has already been declared`.

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `node --test --test-force-exit src/db/schema.test.js`
Expected: PASS, oba nové testy zelené.

- [ ] **Step 5: Napiš regresní test na identitu kategorie převodů**

Type 4 přestává být unikátní marker — přibývá čtvrtý význam. `transferCategoryName()` bere první `type = 4` podle `id ASC` s `system_role IS NULL`; ověř, že nová kategorie ten výběr nepřebije, i kdyby měla nižší id.

Přidej na konec `src/utils/transfer-category.test.js`:

```js
test('extra_income se nesmí vydávat za kategorii interních převodů', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  // extra_income má ZÁMĚRNĚ nižší id než uživatelská kategorie převodů
  db.prepare("INSERT INTO categories (id, user_id, name, type, system_role) VALUES (100,1,'Mimořádné příjmy',4,'extra_income')").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (200,1,'Převody interní',4)").run();

  const transferCategoryName = require('./transfer-category');
  assert.equal(transferCategoryName(db, 1), 'Převody interní');
  cleanup(db, tmp);
});
```

Pokud `src/utils/transfer-category.test.js` nemá helpery `freshDb()` / `cleanup()`, převezmi je ze `src/utils/income.test.js` (řádky 8-23) a uprav `delete require.cache` na `require.resolve('./transfer-category')`.

- [ ] **Step 6: Spusť regresní test**

Run: `node --test --test-force-exit src/utils/transfer-category.test.js`
Expected: PASS — guard `AND system_role IS NULL` v `transfer-category.js` už existuje, takže test má projít napoprvé. **Kdyby padal, je to nález, ne chyba testu** — oprav `transfer-category.js`, ne test.

- [ ] **Step 7: Napiš regresní testy ochrany kategorie**

Ochrana systémových kategorií v `src/routes/categories.js` je generická (`if (cat.system_role)`), takže novou kategorii pokrývá bez zásahu. Ověř to explicitně — jinak by tichá regrese umožnila uživateli kategorii smazat a rozbít bilanci.

Přidej na konec `src/routes/categories.test.js`:

```js
test('PATCH: u extra_income ignoruje změnu type', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const id = db.prepare("INSERT INTO categories (user_id,name,type,system_role) VALUES (1,'Mimořádné příjmy',4,'extra_income')").run().lastInsertRowid;
  const res = await fetch(`${base}/api/categories/${id}`, { method:'PATCH', headers:{'content-type':'application/json'},
    body: JSON.stringify({ type: 1, name: 'Jednorázové příjmy' }) });
  const body = await res.json();
  server.close();
  assert.equal(res.status, 200);
  assert.equal(body.type, 4, 'type systémové kategorie se nesmí přepnout');
  assert.equal(body.name, 'Jednorázové příjmy', 'název jde přejmenovat');
});

test('DELETE: kategorii extra_income nelze smazat', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const id = db.prepare("INSERT INTO categories (user_id,name,type,system_role) VALUES (1,'Mimořádné příjmy',4,'extra_income')").run().lastInsertRowid;
  const res = await fetch(`${base}/api/categories/${id}`, { method:'DELETE' });
  const still = db.prepare('SELECT 1 FROM categories WHERE id = ?').get(id);
  server.close();
  assert.equal(res.status, 400);
  assert.ok(still, 'kategorie musí zůstat');
});
```

Run: `node --test --test-force-exit src/routes/categories.test.js`
Expected: PASS napoprvé (ochrana už je generická). **Kdyby padalo, je to nález** — oprav `src/routes/categories.js`, ne test.

- [ ] **Step 8: Napiš regresní test guardu fixních plateb**

Matcher fixních plateb (`src/utils/fixed-expenses.js`) má guard `COALESCE(c.system_role, '') = ''`, aby se systémová kategorie nepárovala s fixní platbou a stejná částka se nepočítala dvakrát. Ověř, že platí i pro `extra_income`.

Přidej na konec `src/utils/fixed-expenses.test.js`:

```js
test('extra_income: platba v systémové kategorii se nespáruje s fixní platbou', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO categories (id,user_id,name,type,system_role) VALUES (30,1,'Mimořádné příjmy',4,'extra_income')").run();
  db.prepare("INSERT INTO fixed_expenses (user_id, name, amount, sort_order, match_pattern) VALUES (1, 'PRE elektřina', 3000, 1, 'PRE')").run();
  // odchozí platba v systémové kategorii — pattern by na ni jinak sedl
  db.prepare("INSERT INTO transactions (user_id, category_id, amount, date, description) VALUES (1, 30, -3000, '2026-04-05', 'PRE vratka')").run();

  const { fixedExpensesForPeriod } = require('./fixed-expenses');
  const rows = fixedExpensesForPeriod(db, 1, '2026-04', 1);
  const pre = rows.find(r => r.name === 'PRE elektřina');

  assert.ok(pre, 'definovaná fixní platba se v seznamu ukáže vždy');
  assert.equal(pre.tx_count, 0, 'platba v systémové kategorii se nesmí spárovat');
  assert.equal(pre.actual, 0);
  cleanup(db, tmp);
});
```

Ověř si při psaní skutečný název exportu a signaturu ve `src/utils/fixed-expenses.js` — pokud se `fixedExpensesForPeriod` volá jinak nebo bere jiné argumenty, uprav volání podle stávajících testů v témž souboru, ne podle tohoto úryvku.

Run: `node --test --test-force-exit src/utils/fixed-expenses.test.js`
Expected: PASS napoprvé (guard už existuje).

- [ ] **Step 9: Spusť celou backend sadu**

Run: `node --test --test-force-exit 'src/**/*.test.js'`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/db/schema.js src/db/schema.test.js src/utils/transfer-category.test.js src/routes/categories.test.js src/utils/fixed-expenses.test.js
git commit -m "feat(mimoradne-prijmy): systemova kategorie extra_income"
git push origin staging
```

---

### Task 2: Agregát `extra_income` v `/api/stats/overview`

**Files:**
- Modify: `src/routes/stats.js` — blok za `prepaid_purchase` (dnešní řádky ~186-202), podmínka `accounting` (dnešní řádek ~63), objekt v `res.json` (~205-220)
- Test: `src/routes/stats.test.js` (přidat na konec)

**Interfaces:**
- Consumes: kategorie `system_role = 'extra_income'` z Tasku 1
- Produces: v odpovědi `GET /api/stats/overview` nový klíč
  `extra_income: { category_id: number|null, name: string|null, inflow: number, tx_count: number }`.
  Klient ho čte v Tascích 5 a 6 jako `stats?.extra_income?.inflow || 0`.

**Kontext pro implementátora:** Tři vědomá rozhodnutí v SQL dotazu, nevymýšlej je jinak:
1. **Saldo (`SUM(t.amount)`), ne jen kladné částky.** Kdyby uživatel část přeplatku vrátil a vratku zařadil do stejné kategorie, číslo zůstane pravdivé.
2. **Bez `SPENDING_FILTER`.** Ten fragment vyžaduje kategorii typu 1–3 a zahodil by úplně všechno.
3. **Bez omezení na účet.** Mimořádný příjem může přistát na kterémkoli účtu domácnosti.

Druhá část tasku je oprava, která by jinak bublala až na produkci: sekce `accounting` bere všechny `type = 4` kromě `prepaid_purchase` a kontroluje jejich saldo na nulu (chybějící noha převodu → ⚠). Mimořádný příjem má saldo trvale kladné, takže by se každý měsíc hlásil jako rozbitý převod.

- [ ] **Step 1: Napiš failující testy**

Přidej na konec `src/routes/stats.test.js`. Pozor: `setup()` v tomto souboru vkládá uživatele AŽ PO `initSchema()`, takže bootstrap z Tasku 1 pro něj neproběhne — kategorii proto zakládají testy samy.

```js
test('extra_income: inflow sečte příchozí platby v kategorii za období', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type,system_role) VALUES (30,1,'Mimořádné příjmy',4,'extra_income')").run();
  db.prepare(`INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES
    (1,30,8000,'2026-07-05','Přeplatek PRE'),
    (1,30,3000,'2026-07-20','Dar')`).run();
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.extra_income.category_id, 30);
  assert.equal(stats.extra_income.name, 'Mimořádné příjmy');
  assert.equal(stats.extra_income.inflow, 11000);
  assert.equal(stats.extra_income.tx_count, 2);
  server.close();
});

test('extra_income: vratka v téže kategorii sníží saldo', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type,system_role) VALUES (30,1,'Mimořádné příjmy',4,'extra_income')").run();
  db.prepare(`INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES
    (1,30,8000,'2026-07-05','Přeplatek PRE'),
    (1,30,-2000,'2026-07-25','Část vrácena')`).run();
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.extra_income.inflow, 6000);
  server.close();
});

test('extra_income: platba mimo období se nezapočítá', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type,system_role) VALUES (30,1,'Mimořádné příjmy',4,'extra_income')").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,30,8000,'2026-06-30','Přeplatek PRE')").run();
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.extra_income.inflow, 0);
  assert.equal(stats.extra_income.tx_count, 0);
  server.close();
});

test('extra_income: bez kategorie vrací prázdný agregát, ne chybu', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  assert.equal(stats.extra_income.category_id, null);
  assert.equal(stats.extra_income.inflow, 0);
  server.close();
});

test('extra_income: sekce Účetní kategorii NEobsahuje (saldo nikdy nevyjde nula)', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id,user_id,name,type,system_role) VALUES (30,1,'Mimořádné příjmy',4,'extra_income')").run();
  db.prepare("INSERT INTO categories (id,user_id,name,type) VALUES (31,1,'Převody interní',4)").run();
  db.prepare("INSERT INTO transactions (user_id,category_id,amount,date,description) VALUES (1,30,8000,'2026-07-05','Přeplatek PRE')").run();
  const stats = await (await fetch(`${base}/api/stats/overview?period=2026-07`)).json();
  const ids = (stats.accounting || []).map(r => r.id);
  assert.ok(!ids.includes(30), 'extra_income nesmí být v sekci Účetní');
  assert.ok(ids.includes(31), 'uživatelská kategorie převodů v Účetní zůstává');
  server.close();
});
```

- [ ] **Step 2: Spusť testy a ověř, že padají**

Run: `node --test --test-force-exit src/routes/stats.test.js`
Expected: FAIL — `TypeError: Cannot read properties of undefined (reading 'category_id')`, protože `stats.extra_income` neexistuje. Poslední test padne na tom, že `accounting` id 30 obsahuje.

- [ ] **Step 3: Implementuj agregát**

V `src/routes/stats.js` vlož za blok `prepaidPurchase` (končí uzavírající `}` po `prepaidPurchase = { ... }`) a před `res.json({`:

```js
  // ── Mimořádné příjmy (kategorie se system_role='extra_income') ──
  // Jednorázový příjem bez vazby na pravidelný zdroj: přeplatek energií, dar,
  // výhra, prodej věci. Na Schůzce stojí POD provozní bilancí, aby srovnatelnost
  // měsíců zůstala zachovaná, a připočítá se až do výsledného „Na spořicí".
  //
  // Saldo (SUM(amount)), ne jen kladné částky: vratka části přeplatku zařazená do
  // téže kategorie číslo správně sníží. Bez SPENDING_FILTER (ten vyžaduje kategorii
  // typu 1–3 a zahodil by všechno) a bez omezení na účet — mimořádný příjem může
  // přistát kdekoli. Vyloučení z výpočtu příjmů řeší utils/income.js.
  const extraIncomeCat = db.prepare(
    "SELECT id, name FROM categories WHERE user_id = ? AND system_role = 'extra_income'"
  ).get(req.dataUserId);
  let extraIncome = { category_id: null, name: null, inflow: 0, tx_count: 0 };
  if (extraIncomeCat) {
    const e = db.prepare(`
      SELECT COALESCE(SUM(t.amount), 0) AS inflow, COUNT(t.id) AS tx_count
      FROM transactions t
      WHERE t.user_id = ? AND t.category_id = ?
        AND t.date >= ? AND t.date <= ?
    `).get(req.dataUserId, extraIncomeCat.id, start, end);
    extraIncome = {
      category_id: extraIncomeCat.id, name: extraIncomeCat.name,
      inflow: e.inflow, tx_count: e.tx_count,
    };
  }
```

Do objektu v `res.json({ ... })` přidej za `prepaid_purchase: prepaidPurchase,`:

```js
    extra_income: extraIncome,
```

- [ ] **Step 4: Vyluč kategorii ze sekce Účetní**

V dotazu `accounting` (dnešní řádek ~63) změň:

```js
      AND COALESCE(c.system_role, '') != 'prepaid_purchase'
```

na:

```js
      AND COALESCE(c.system_role, '') NOT IN ('prepaid_purchase', 'extra_income')
```

A rozšiř komentář nad dotazem — za větu o `prepaid_purchase` doplň:

```js
  // `extra_income` je vyloučená ze stejného důvodu: mimořádný příjem není převod
  // mezi vlastními účty, jeho saldo je trvale kladné a kontrola na nulu by ho
  // každý měsíc hlásila jako převod s chybějící nohou.
```

- [ ] **Step 5: Spusť testy a ověř, že prochází**

Run: `node --test --test-force-exit src/routes/stats.test.js`
Expected: PASS, všech pět nových testů zelených a žádný stávající test se nerozbil.

- [ ] **Step 6: Commit**

```bash
git add src/routes/stats.js src/routes/stats.test.js
git commit -m "feat(mimoradne-prijmy): agregat extra_income ve stats/overview"
git push origin staging
```

---

### Task 3: Vyloučení mimořádných příjmů z výpočtu příjmů

**Files:**
- Modify: `src/utils/income.js` — funkce `incomeSourcesForPeriod()`, hlavní SELECT transakcí (dnešní řádky ~48-53)
- Test: `src/utils/income.test.js` (přidat na konec)

**Interfaces:**
- Consumes: kategorie `system_role = 'extra_income'` z Tasku 1
- Produces: nic nového — mění se jen chování `incomeSourcesForPeriod(db, userId, period, billingDay)`, signatura zůstává stejná.

**Kontext pro implementátora:** Tohle je nejrizikovější místo celé featury. Příchozí platba dnes prochází výpočtem příjmů a bez zásahu by skončila započtená dvakrát:

- jako **varování** `unmatchedIncome` na Schůzce („1 nezařazená příchozí platba") — vizuální šum, platba je přece zařazená;
- jako **skutečný příjem**, pokud na ni sedne nějaký `income_sources` alias (typicky obecný alias bez omezení na cílový účet). To by bilanci reálně nafouklo o dvojnásobek — částka by se počítala jednou v „Příjmy celkem" a podruhé v novém řádku „Mimořádné příjmy".

- [ ] **Step 1: Napiš failující testy**

Přidej na konec `src/utils/income.test.js`:

```js
test('extra_income: platba v kategorii mimořádných příjmů se do příjmů nezapočítá', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO categories (id, user_id, name, type, system_role) VALUES (30,1,'Mimořádné příjmy',4,'extra_income')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, category_id, amount, date, description, counterparty_account) VALUES (1, 10, 30, 8000, '2026-04-10', 'Přeplatek PRE', '9876543210')").run();

  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);

  assert.equal(rows.length, 0, 'mimořádný příjem nesmí vzniknout ani jako auto-only skupina');
  cleanup(db, tmp);
});

test('extra_income: alias na tutéž protistranu platbu v kategorii nesebere (obrana proti dvojímu započtení)', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO categories (id, user_id, name, type, system_role) VALUES (30,1,'Mimořádné příjmy',4,'extra_income')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO income_sources (user_id, person, planned_amount, match_counterparty_account) VALUES (1,'PRE',0,'9876543210')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, category_id, amount, date, description, counterparty_account) VALUES (1, 10, 30, 8000, '2026-04-10', 'Přeplatek PRE', '9876543210')").run();

  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);
  const pre = rows.find(r => r.person === 'PRE');

  assert.ok(pre, 'definovaný zdroj se v seznamu ukáže vždy');
  assert.equal(pre.actual, 0, 'ale platba zařazená do extra_income mu nesmí přibýt');
  assert.equal(pre.tx_count, 0);
  cleanup(db, tmp);
});

test('extra_income: běžný příjem v jiné kategorii se počítá dál', () => {
  const { db, tmp } = freshDb();
  seedUser(db);
  db.prepare("INSERT INTO categories (id, user_id, name, type, system_role) VALUES (30,1,'Mimořádné příjmy',4,'extra_income')").run();
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Hlavní', '1679014138', 'ignored')").run();
  db.prepare("INSERT INTO transactions (user_id, account_id, amount, date, description, counterparty_account) VALUES (1, 10, 21000, '2026-04-10', 'Nájem byt', '9876543210')").run();

  const { incomeSourcesForPeriod } = require('./income');
  const rows = incomeSourcesForPeriod(db, 1, '2026-04', 1);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].actual, 21000);
  cleanup(db, tmp);
});
```

- [ ] **Step 2: Spusť testy a ověř, že padají**

Run: `node --test --test-force-exit src/utils/income.test.js`
Expected: FAIL — první test dostane `rows.length === 1` místo 0, druhý `pre.actual === 8000` místo 0. Třetí projde už teď (regresní pojistka).

- [ ] **Step 3: Implementuj vyloučení**

V `src/utils/income.js`, funkce `incomeSourcesForPeriod()`, nahraď blok načítající transakce:

```js
  const txs = db.prepare(`
    SELECT id, amount, date, description, counterparty_account, account_id
    FROM transactions
    WHERE user_id = ? AND amount > 0 AND date >= ? AND date <= ?
  `).all(userId, start, end);
```

tímto:

```js
  // Mimořádné příjmy (systémová kategorie extra_income) se do výpočtu příjmů
  // NESMÍ dostat: na Schůzce mají vlastní řádek pod provozní bilancí, takže by
  // se počítaly dvakrát. Týká se to obou cest — auto-only skupiny (varování
  // „nezařazená příchozí platba") i napárování na income_sources alias.
  //
  // Když kategorie neexistuje (bootstrap ještě neproběhl), podmínka se vynechá
  // a chování zůstane původní.
  const extraIncomeCat = db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND system_role = 'extra_income'"
  ).get(userId);
  const txs = extraIncomeCat
    ? db.prepare(`
        SELECT id, amount, date, description, counterparty_account, account_id
        FROM transactions
        WHERE user_id = ? AND amount > 0 AND date >= ? AND date <= ?
          AND (category_id IS NULL OR category_id != ?)
      `).all(userId, start, end, extraIncomeCat.id)
    : db.prepare(`
        SELECT id, amount, date, description, counterparty_account, account_id
        FROM transactions
        WHERE user_id = ? AND amount > 0 AND date >= ? AND date <= ?
      `).all(userId, start, end);
```

- [ ] **Step 4: Spusť testy a ověř, že prochází**

Run: `node --test --test-force-exit src/utils/income.test.js`
Expected: PASS, všechny tři nové testy zelené a žádný ze stávajících testů příjmů se nerozbil.

- [ ] **Step 5: Spusť celou backend sadu**

Run: `node --test --test-force-exit 'src/**/*.test.js'`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/income.js src/utils/income.test.js
git commit -m "fix(mimoradne-prijmy): vylouceni extra_income z vypoctu prijmu"
git push origin staging
```

---

### Task 4: `computeMeetingSurplus()` — mimořádné příjmy a `totalToSavings`

**Files:**
- Modify: `client/src/utils/meetingBalance.js` — funkce `computeMeetingSurplus()` (dnešní řádky ~35-58)
- Test: `client/src/utils/meetingBalance.test.js` (přidat na konec)

**Interfaces:**
- Consumes: `stats.extra_income.inflow` z Tasku 2 (předá ho volající)
- Produces: `computeMeetingSurplus({ ..., extraIncome })` vrací navíc:
  - `extraIncome: number` — mimořádné příjmy za období
  - `totalToSavings: number` — `surplus + extraIncome`
  `surplus` si ponechává dnešní význam (provozní přebytek). Tasky 5 a 6 čtou `totalToSavings`.

**Kontext pro implementátora:** `surplusToSavings()` (pure funkce o řádek výš) se **nemění**. Je to provozní přebytek a jeho význam zůstává. Mimořádný příjem se přičítá až nad ním — proto nové pole, ne nový parametr do `surplusToSavings()`.

Default `extraIncome = 0` drží zpětnou kompatibilitu: volající, který ho nepředá, dostane `totalToSavings === surplus`.

- [ ] **Step 1: Napiš failující testy**

Přidej na konec `client/src/utils/meetingBalance.test.js`:

```js
test('computeMeetingSurplus: totalToSavings = provozní přebytek + mimořádné příjmy', () => {
  const r = computeMeetingSurplus({
    incomeSources: [{ id: 1, actual: 100000 }],
    fixedExpenses: [{ source: 'manual', amount: 40000, actual: 40000, tx_count: 1 }],
    budgetsType1: [{ spent: 20000 }],
    byCategory: [],
    extraIncome: 8000,
  });
  assert.equal(r.surplus, 40000, 'provozní přebytek mimořádný příjem NEobsahuje');
  assert.equal(r.extraIncome, 8000);
  assert.equal(r.totalToSavings, 48000);
});

test('computeMeetingSurplus: bez extraIncome se totalToSavings rovná surplus', () => {
  const r = computeMeetingSurplus({
    incomeSources: [{ id: 1, actual: 100000 }],
    fixedExpenses: [],
    budgetsType1: [{ spent: 20000 }],
    byCategory: [],
  });
  assert.equal(r.extraIncome, 0);
  assert.equal(r.totalToSavings, r.surplus);
  assert.equal(r.surplus, 80000);
});

test('computeMeetingSurplus: záporné saldo mimořádných příjmů přebytek sníží', () => {
  const r = computeMeetingSurplus({
    incomeSources: [{ id: 1, actual: 100000 }],
    fixedExpenses: [],
    budgetsType1: [{ spent: 20000 }],
    byCategory: [],
    extraIncome: -3000,
  });
  assert.equal(r.totalToSavings, 77000);
});
```

- [ ] **Step 2: Spusť testy a ověř, že padají**

Run: `node --test 'client/src/utils/meetingBalance.test.js'`
Expected: FAIL — `r.totalToSavings` je `undefined`, `r.extraIncome` je `undefined`.

- [ ] **Step 3: Implementuj**

V `client/src/utils/meetingBalance.js` uprav `computeMeetingSurplus()`. Do destrukturovaného parametru přidej `extraIncome = 0,` (za `prepaidPurchase = 0,`) a nahraď závěr funkce:

```js
  const surplus = surplusToSavings({
    totalIncome, totalFixed, fundTopup, annualOffFund, prepaidPurchase, totalType1, totalType3,
  });
  return { totalIncome, totalFixed, fundTopup, annualOffFund, prepaidPurchase, totalType1, totalType3, surplus };
```

tímto:

```js
  // `surplus` = PROVOZNÍ přebytek: příjmy minus všechny výdaje. Srovnatelný mezi
  // měsíci, protože jednorázovky do něj nevstupují.
  const surplus = surplusToSavings({
    totalIncome, totalFixed, fundTopup, annualOffFund, prepaidPurchase, totalType1, totalType3,
  });
  // `totalToSavings` = kolik má reálně jít na spořicí, tedy provozní přebytek plus
  // mimořádné příjmy (přeplatky, dary, výhry — systémová kategorie extra_income).
  // Schůzka i stránka Spořicí účet musí ukazovat TOHLE číslo, jinak se plán rozejde.
  const totalToSavings = surplus + extraIncome;
  return {
    totalIncome, totalFixed, fundTopup, annualOffFund, prepaidPurchase,
    totalType1, totalType3, extraIncome, surplus, totalToSavings,
  };
```

Doplň i JSDoc komentář nad funkcí — za větu o `budgetsType1` přidej:

```js
// `extraIncome` = saldo systémové kategorie extra_income za období (z
// `/api/stats/overview`); default 0, aby starší volající dostali `totalToSavings === surplus`.
```

- [ ] **Step 4: Spusť testy a ověř, že prochází**

Run: `node --test 'client/src/utils/meetingBalance.test.js'`
Expected: PASS, všechny tři nové testy zelené a stávající testy `surplusToSavings` beze změny.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/meetingBalance.js client/src/utils/meetingBalance.test.js
git commit -m "feat(mimoradne-prijmy): computeMeetingSurplus vraci totalToSavings"
git push origin staging
```

---

### Task 5: Dvoustupňová bilance na Schůzce

**Files:**
- Modify: `client/src/pages/ReportPage.jsx` — destrukturalizace `computeMeetingSurplus` (dnešní řádky ~251-262), blok bilance (výsledný řádek ~403-406)
- Modify: `client/src/App.css` — přidat `.report-bilance-subtotal` za `.report-bilance-result` (dnešní řádky ~686-692)

**Interfaces:**
- Consumes: `totalToSavings` a `extraIncome` z Tasku 4, `stats.extra_income` z Tasku 2
- Produces: nic pro další tasky (UI je koncový bod)

**Kontext pro implementátora:** Bilance dostane dva stupně:

```
  Příjmy celkem
− Fixní platby
− Měsíční výdaje
− Drahé věci
− Roční výdaje mimo fond
− Nákup předplacených balíčků
− Nestandardní dobití ročního budgetu
──────────────────────────────────────
= Provozní přebytek        ← mezisoučet, dnešní `surplus`
+ Mimořádné příjmy         ← nový řádek, jen když jsou
──────────────────────────────────────
= Na spořicí               ← výsledek, `totalToSavings`
  Skutečně převedeno       ← beze změny
```

Tři věci, které se snadno pokazí:

1. **`formatCurrency` vrací ABSOLUTNÍ hodnotu.** Znaménko se skládá ručně: `{x >= 0 ? '+' : '−'} {formatCurrency(Math.abs(x))}`. Používej znak `−` (U+2212), ne pomlčku — tak to dělají ostatní řádky.
2. **Proklik musí vézt `period`.** `TransactionsPage` AND-uje období z kontextu; helper `txLink()` v `ReportPage` ho přidává sám, takže mu předej jen zbytek query.
3. **Dvoustupňovost platí i v měsíci bez mimořádného příjmu.** Řádky „Provozní přebytek" i „Na spořicí" jsou vidět vždy a ukážou stejné číslo. Skrývá se jen prostřední řádek. Struktura bilance má být konzistentní.

- [ ] **Step 1: Přidej CSS pro mezisoučet**

V `client/src/App.css` přidej za blok `.report-bilance-result` (končí `border-top: 2px solid var(--border);` a `}`):

```css
/* Mezisoučet bilance („Provozní přebytek") — vizuálně mezi položkou a výsledkem:
   oddělený linkou jako výsledek, ale menší a lehčí, aby výsledný řádek zůstal
   dominantní. */
.report-bilance-subtotal {
  font-size: 15px;
  font-weight: 600;
  padding-top: 8px;
  margin-top: 4px;
  border-top: 1px solid var(--border);
}
```

- [ ] **Step 2: Načti agregát a nové pole**

V `client/src/pages/ReportPage.jsx` přidej za řádek `const prepaidRow       = stats?.prepaid_purchase || null;`:

```js
  const extraIncomeRow   = stats?.extra_income || null;
```

A uprav volání `computeMeetingSurplus` — do vstupu přidej `extraIncome`, do destrukturalizace `totalToSavings`:

```js
  const { totalIncome, totalFixed, totalType1, totalType3, surplus, totalToSavings } = computeMeetingSurplus({
    incomeSources,
    fixedExpenses,
    budgetsType1: budgets,
    byCategory,
    fundTopup: fundTopupRow?.outflow || 0,
    annualOffFund: annualOffFundRow?.spent || 0,
    prepaidPurchase: prepaidRow?.outflow || 0,
    extraIncome: extraIncomeRow?.inflow || 0,
  });
```

- [ ] **Step 3: Přepiš výsledný řádek na tři řádky**

Nahraď dnešní výsledný řádek:

```jsx
            <div className={`report-bilance-row report-bilance-result ${surplus >= 0 ? '' : 'text-danger'}`}>
              <span>Na spořicí (přebytek)</span>
              <span>{surplus >= 0 ? '+' : '−'} {formatCurrency(Math.abs(surplus))}</span>
            </div>
```

tímto:

```jsx
            {/* Bilance má dva stupně: provozní přebytek je srovnatelný mezi měsíci
                (jednorázovky do něj nevstupují), mimořádné příjmy se připočtou až
                do výsledného „Na spořicí". Oba řádky jsou vidět vždy — v měsíci bez
                mimořádného příjmu ukážou stejné číslo. */}
            <div className={`report-bilance-row report-bilance-subtotal ${surplus >= 0 ? '' : 'text-danger'}`}>
              <span>Provozní přebytek</span>
              <span>{surplus >= 0 ? '+' : '−'} {formatCurrency(Math.abs(surplus))}</span>
            </div>
            {extraIncomeRow?.category_id && extraIncomeRow.inflow !== 0 && (
              <Link to={txLink(`category_ids=${extraIncomeRow.category_id}&direction=in`)}
                className="report-bilance-row"
                style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                title="Klik: mimořádné příjmy v tomto období (přeplatky, dary, výhry)">
                <span>{extraIncomeRow.name}</span>
                <span>{extraIncomeRow.inflow >= 0 ? '+' : '−'} {formatCurrency(Math.abs(extraIncomeRow.inflow))}</span>
              </Link>
            )}
            <div className={`report-bilance-row report-bilance-result ${totalToSavings >= 0 ? '' : 'text-danger'}`}>
              <span>Na spořicí</span>
              <span>{totalToSavings >= 0 ? '+' : '−'} {formatCurrency(Math.abs(totalToSavings))}</span>
            </div>
```

- [ ] **Step 4: Ověř, že build i lint procházejí**

Run: `npm run build && cd client && npm run lint`
Expected: build OK bez chyb, lint bez nových chyb. Lint neodhalí všechno — zejména `await` v ne-async callbacku projde lintem a spadne až v buildu, proto obojí.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ReportPage.jsx client/src/App.css
git commit -m "feat(mimoradne-prijmy): dvoustupnova bilance na Schuzce"
git push origin staging
```

---

### Task 6: Sladění stránky Spořicí účet a finální ověření

**Files:**
- Modify: `client/src/pages/SavingsPage.jsx` — volání `computeMeetingSurplus` (dnešní řádky ~44-52) a zobrazení plánu (~102)

**Interfaces:**
- Consumes: `totalToSavings` z Tasku 4, `stats.extra_income` z Tasku 2
- Produces: nic (poslední task)

**Kontext pro implementátora:** `SavingsPage` čte tentýž helper jako Schůzka, aby obě stránky ukazovaly stejný „plán". Kdyby zůstala na `surplus`, rozešla by se se Schůzkou přesně o mimořádnou částku — a to je chyba, kterou nikdo nenajde, dokud si čísla neporovná ručně. Tenhle krok je hlavní důvod, proč je task samostatný.

- [ ] **Step 1: Přepni SavingsPage na `totalToSavings`**

V `client/src/pages/SavingsPage.jsx` nahraď:

```js
  // Plánovaný přebytek ze Schůzky — stejná pravda přes sdílený helper.
  const { surplus } = computeMeetingSurplus({
    incomeSources,
    fixedExpenses,
    budgetsType1: budgets,
    byCategory: stats?.by_category || [],
    fundTopup: stats?.fund_topup?.outflow || 0,
    annualOffFund: stats?.annual_off_fund?.spent || 0,
    prepaidPurchase: stats?.prepaid_purchase?.outflow || 0,
  });
```

tímto:

```js
  // Plánovaný přebytek ze Schůzky — stejná pravda přes sdílený helper.
  // `totalToSavings` (ne `surplus`): mimořádné příjmy patří do plánu spoření,
  // jinak by se plán rozešel se Schůzkou přesně o jednorázovou částku.
  const { totalToSavings: surplus } = computeMeetingSurplus({
    incomeSources,
    fixedExpenses,
    budgetsType1: budgets,
    byCategory: stats?.by_category || [],
    fundTopup: stats?.fund_topup?.outflow || 0,
    annualOffFund: stats?.annual_off_fund?.spent || 0,
    prepaidPurchase: stats?.prepaid_purchase?.outflow || 0,
    extraIncome: stats?.extra_income?.inflow || 0,
  });
```

Přejmenování při destrukturalizaci (`totalToSavings: surplus`) drží zbytek komponenty beze změny — proměnná `surplus` se v JSX používá dál.

- [ ] **Step 2: Spusť kompletní testovou sadu**

Run: `node --test --test-force-exit 'src/**/*.test.js'`
Expected: PASS, všechny backend testy.

Run: `node --test 'client/src/utils/*.test.js'`
Expected: PASS, všechny klientské util testy.

- [ ] **Step 3: Ověř build a lint**

Run: `npm run build && cd client && npm run lint`
Expected: build OK, lint bez nových chyb.

- [ ] **Step 4: Ruční ověření pickerů kategorie**

Systémová kategorie musí být vybíratelná tam, kde uživatel platbu potkává. Ověř čtením kódu, že žádné z těchto míst nefiltruje kategorie podle `type`:

- `client/src/pages/TransactionsPage.jsx:1031-1034` — select v editaci transakce (dnes `categories.map(...)` bez filtru ✅)
- `client/src/pages/ImportPage.jsx:456` — dlaždice kategorií ve frontě revize, `orderedCats(cats, ...)` (dnes bez filtru ✅)
- `client/src/pages/ImportPage.jsx:889` — select v druhé sekci importu (dnes `categories.map(...)` bez filtru ✅)

Pokud některé filtr má, doplň výjimku pro `system_role === 'extra_income'` a poznamenej to v commit message. Pokud ne, není co měnit — jen jsi ověřil, že feature je použitelná.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/SavingsPage.jsx
git commit -m "fix(mimoradne-prijmy): plan sporeni pocita s mimoradnymi prijmy"
git push origin staging
```

- [ ] **Step 6: Nahlásit verzi a co ověřit ručně**

Po nasazení staging nahlas uživateli číslo verze a tři věci k ověření v prohlížeči:

1. Na Schůzce jsou vidět řádky „Provozní přebytek" a „Na spořicí" i v měsíci bez mimořádného příjmu (ukážou stejné číslo).
2. Po zařazení příchozí platby do kategorie „Mimořádné příjmy" částka **zmizí** z varování „nezařazená příchozí platba" a **objeví se** v novém řádku.
3. Číslo „plán" na stránce Spořicí účet sedí na „Na spořicí" ze Schůzky.

---

## Mimo scope tohoto plánu

Ze spec sekce 7, vědomě odloženo:

- Značka mimořádného příjmu ve Vývoji spoření (skok v grafu zůstane bez vysvětlení).
- Subkategorie (Přeplatek / Dar / Výhra / Prodej) — přidatelné později bez migrace dat.
- Textová pravidla pro automatické zařazení — uživatel zařazuje ručně.
- Mimořádné výdaje (zrcadlový případ).
- Retroaktivní zařazení historických plateb — uživatel si je zařadí hromadnou změnou kategorie, která už existuje.
