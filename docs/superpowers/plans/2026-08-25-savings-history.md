# Vývoj spoření — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nová stránka „Vývoj spoření" ukazující po obdobích přírůstek na spořicím účtu (vklady / výběry / saldo) a k tomu vývoj zůstatku — dopočteného z pohybů a skutečného ze snapshotů v AirBank notifikacích.

**Architecture:** E-mailový parser začne z notifikace číst zůstatek účtu do nového sloupce `transactions.balance_after`. Dedup logika pohybů spořicího účtu se vytáhne z `/api/stats/overview` do sdíleného helperu `src/utils/savings.js`. Nad ním stojí nový endpoint `GET /api/stats/savings-history`, který vrací hodnoty po obdobích včetně obou křivek zůstatku. Frontend je nová stránka se dvěma panely grafu nad sebou (zůstatek / saldo) sdílejícími osu X.

**Tech Stack:** Node.js + Express, better-sqlite3, `node:test`, React + Vite, vlastní SVG (žádná grafová knihovna).

**Spec:** `docs/superpowers/specs/2026-08-25-savings-history-design.md`

## Global Constraints

- Jazyk UI je čeština, texty přes `client/src/i18n.js` (`t.nav.*`).
- Žádný `type: any`, žádná nová npm závislost, žádná grafová knihovna — vlastní SVG.
- Období se VŽDY počítá přes `getPeriodDates(billingDay, periodKey)` z `src/utils/period.js`, nikdy ručně.
- DB migrace = `ALTER TABLE` na konci `initSchema()` v `src/db/schema.js`, v `try/catch`, žádný migrační framework.
- Spořicí účet je `savingsAccount = '1679014082/3030'` z `src/utils/recurring.js`; porovnává se přes `normCounterparty` z `src/utils/income.js`, nikdy exact match na sloupec.
- Backend testy: `node --test 'src/**/*.test.js'` — uvozovky povinné (`src/` samotné visí), po route testech přidat `--test-force-exit`.
- Frontend ověření: `npm run build` v `client/` — lint sám neodhalí např. `await` v ne-async callbacku.
- Commit po každém tasku, push do větve `staging` (nikdy `main`).
- Data-mutující skript na produkci se pouští POUZE dry-run; ostrý běh (`CONFIRM=1`) jen na explicitní pokyn uživatele.

---

### Task 1: Parser čte zůstatek z notifikace

**Files:**
- Modify: `src/utils/emailParser.js` (blok s datem/časem na konci `parseEmailNotification`, cca řádky 150–180)
- Test: `src/utils/emailParser.test.js`

**Interfaces:**
- Consumes: nic
- Produces: `parseEmailNotification(text)` vrací navíc `balance_after: number | null` — dostupný zůstatek účtu, ze kterého notifikace přišla (účet je v `source_account`).

- [ ] **Step 1: Write the failing test**

Přidej na konec `src/utils/emailParser.test.js`:

```js
test('balance_after: vytáhne dostupný zůstatek z hlavičky', () => {
  const tx = parseEmailNotification(`Dobrý den,

zůstatek na účtu Spořicí účet 1 číslo 1679014082/3030 se zvýšil o částku 100,00 CZK. Dostupný zůstatek k 02.08.2026 v 14:12 je 111 878,44 CZK.

Pro úplnost uvádíme detaily této úhrady:

Příchozí úhrada z účtu Libor Bísek číslo 1812270019/3030
Částka: 100,00 CZK
Datum zaúčtování: 02.08.2026
Kód transakce: 165368991022
`);
  assert.equal(tx.balance_after, 111878.44);
  assert.equal(tx.source_account, '1679014082/3030');
});

test('balance_after: chybějící věta o zůstatku dá null, parser nespadne', () => {
  const tx = parseEmailNotification(`Dobrý den,

zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 10,00 CZK.

Pro úplnost uvádíme detaily této úhrady:

Odchozí úhrada na účet Tomáš Střída číslo 1679014082/3030
Kód transakce: 123456789
`);
  assert.equal(tx.balance_after, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/utils/emailParser.test.js`
Expected: FAIL — `balance_after` je `undefined`, ne `111878.44`.

- [ ] **Step 3: Write minimal implementation**

V `src/utils/emailParser.js` přidej těsně za blok s `tx_time` (před `return {`):

```js
  // Dostupný zůstatek účtu, ze kterého notifikace přišla: "Dostupný zůstatek
  // k 02.08.2026 v 14:12 je 111 878,44 CZK." Patří k účtu v `source_account` —
  // u převodu mezi vlastními účty nese každá noha jiný zůstatek.
  // Chybějící věta není chyba: starší formáty a některé typy notifikací ji nemají.
  const balM = body.match(/Dostupn[ýy]\s+z[ůu]statek[^\n]*?\bje\s+([\d\s.,]+?)\s*(?:CZK|EUR|USD)/i);
  const balance_after = balM ? parseAmount(balM[1]) : null;
```

A do vraceného objektu (za `variable_symbol`):

```js
    balance_after,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/utils/emailParser.test.js`
Expected: PASS, včetně všech dosavadních testů v souboru.

- [ ] **Step 5: Commit**

```bash
git add src/utils/emailParser.js src/utils/emailParser.test.js
git commit -m "feat(parser): cte dostupny zustatek uctu z AirBank notifikace"
```

---

### Task 2: Sloupec `balance_after` a jeho zápis při importu

**Files:**
- Modify: `src/db/schema.js` (seznam `ALTER TABLE` migrací na konci `initSchema()`)
- Modify: `src/services/emailIngest.js:9-20` (`TX_INSERT` a `insertTx`)
- Modify: `src/routes/emailInbox.js:82-89` (INSERT ve větvi `/approve`)
- Test: `src/services/emailIngest.test.js`

**Interfaces:**
- Consumes: `parseEmailNotification(...).balance_after` z Tasku 1 (jede v `email_inbox.parsed_json`, takže je dostupný i při ručním zařazení z fronty)
- Produces: sloupec `transactions.balance_after REAL` — vyplněný u e-mailových transakcí, `NULL` u CSV i ručních

- [ ] **Step 1: Write the failing test**

Přidej na konec `src/services/emailIngest.test.js`:

```js
test('balance_after se uloží do transakce při automatickém importu', () => {
  const { db, tmp } = freshDb();
  seed(db);
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', fromHeader: 'info@airbank.cz', text: INTERNAL });
  const tx = db.prepare("SELECT balance_after FROM transactions WHERE user_id = 1").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'imported');
  assert.equal(tx.balance_after, 4934.46);
});
```

Pozn.: `freshDb()`, `seed()`, `cleanup()` a konstanta `INTERNAL` v souboru už existují — použij je přesně tak jako okolní testy (`ingestEmail(db, { userEmail, fromHeader, text })`, tři argumenty NEexistují). `INTERNAL` je interní převod, který má v hlavičce „Dostupný zůstatek k 07.06.2026 v 17:47 je 4 934,46 CZK." a končí rovnou v `transactions`, takže testuje právě zápis nového sloupce.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/emailIngest.test.js`
Expected: FAIL — `no such column: balance_after`.

- [ ] **Step 3: Write minimal implementation**

`src/db/schema.js` — do pole `ALTER TABLE` migrací na konci `initSchema()`:

```js
    'ALTER TABLE transactions ADD COLUMN balance_after REAL',
```

`src/services/emailIngest.js` — `TX_INSERT` a `insertTx`:

```js
const TX_INSERT = `INSERT OR IGNORE INTO transactions
    (user_id, category_id, subcategory_id, amount, currency, date, description, note, source, external_id,
     tx_time, tx_type, counterparty_account, entered_by, place, account_id, ab_category, variable_symbol, card_last4,
     balance_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'airbank-email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertTx(db, userId, tx, categoryId, extId, subcategoryId) {
  return db.prepare(TX_INSERT).run(
    userId, categoryId || null, subcategoryId ?? null, tx.amount, tx.currency, tx.date, tx.description, tx.note || '',
    extId || null, tx.tx_time || null, tx.tx_type || null,
    tx.counterparty_account || null, tx.entered_by || null, tx.place || null,
    tx.account_id ?? null, tx.ab_category || null, tx.variable_symbol || null, tx.card_last4 || null,
    tx.balance_after ?? null);
}
```

`src/routes/emailInbox.js` — INSERT ve `/approve` (ruční zařazení z fronty). Doplň jen `balance_after`, zbytek sloupců nech beze změny:

```js
    const r = db.prepare(`INSERT OR IGNORE INTO transactions
        (user_id, category_id, amount, currency, date, description, note, source, external_id,
         tx_time, tx_type, counterparty_account, entered_by, place, account_id, ab_category, balance_after)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank-email', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.dataUserId, categoryId || null, tx.amount, tx.currency, tx.date, tx.description,
           tx.note || '', row.external_id || null, tx.tx_time || null, tx.tx_type || null,
           tx.counterparty_account || null, tx.entered_by || null, tx.place || null,
           tx.account_id || null, tx.ab_category || null, tx.balance_after ?? null);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/services/emailIngest.test.js src/routes/emailInbox.test.js --test-force-exit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.js src/services/emailIngest.js src/routes/emailInbox.js src/services/emailIngest.test.js
git commit -m "feat(db): sloupec balance_after a jeho zapis pri e-mailovem importu"
```

---

### Task 3: Retro migrace zůstatků z uložených e-mailů

**Files:**
- Create: `scripts/migrate-balance-after.cjs`

**Interfaces:**
- Consumes: `parseEmailNotification` (Task 1), sloupec `transactions.balance_after` (Task 2)
- Produces: nic pro další tasky — jednorázový skript

Kontext: `email_inbox.raw_text` se uchovává i pro řádky se `status='imported'` (na produkci 364 řádků od 2026-06-07). Skript je proto jediná cesta, jak dostat zůstatky do už zaimportovaných transakcí.

- [ ] **Step 1: Napiš skript**

Create `scripts/migrate-balance-after.cjs`:

```js
#!/usr/bin/env node
'use strict';
/**
 * Doplní transactions.balance_after z uložených e-mailů (email_inbox.raw_text).
 *
 * Dry-run (výchozí):  node scripts/migrate-balance-after.cjs
 * Ostrý běh:          CONFIRM=1 node scripts/migrate-balance-after.cjs
 *
 * Idempotentní: mění jen řádky, kde je balance_after NULL.
 */
const path = require('path');
const Database = require(process.env.SQLITE_MODULE || 'better-sqlite3');
const { parseEmailNotification } = require(path.join(__dirname, '..', 'src', 'utils', 'emailParser'));

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');
const confirm = process.env.CONFIRM === '1';
const db = new Database(dbPath, { readonly: !confirm });

const rows = db.prepare('SELECT id, external_id, raw_text FROM email_inbox WHERE raw_text IS NOT NULL').all();
const update = confirm
  ? db.prepare('UPDATE transactions SET balance_after = ? WHERE id = ?')
  : null;

let matched = 0, updated = 0, skipped = 0, noBalance = 0;

for (const row of rows) {
  const tx = parseEmailNotification(row.raw_text);
  if (!tx || tx.balance_after == null) { noBalance++; continue; }
  if (!row.external_id) { skipped++; continue; }
  const target = db.prepare(
    'SELECT id, balance_after FROM transactions WHERE external_id = ?'
  ).get(row.external_id);
  if (!target) { skipped++; continue; }
  matched++;
  if (target.balance_after != null) continue;   // už doplněno
  console.log(`tx #${target.id} (external_id=${row.external_id}) → ${tx.balance_after}`);
  if (confirm) { update.run(tx.balance_after, target.id); updated++; }
}

console.log(`\n${confirm ? 'OSTRY BEH' : 'DRY-RUN'}: e-mailů ${rows.length}, spárováno ${matched}, ` +
  `zapsáno ${updated}, bez zůstatku ${noBalance}, bez transakce ${skipped}`);
```

Pozn.: `external_id` v `email_inbox` je plný klíč včetně sufixu účtu (`165368991022-1679014082`) a stejná hodnota je i v `transactions.external_id` — proto se páruje přímo, bez přestavby klíče.

- [ ] **Step 2: Ověř na kopii lokální DB**

```bash
cp data.db /tmp/balance-test.db
DB_PATH=/tmp/balance-test.db node scripts/migrate-balance-after.cjs | tail -5
```

Expected: proběhne bez výjimky a vypíše souhrn (na prázdné lokální DB klidně samé nuly).

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-balance-after.cjs
git commit -m "chore(migrace): doplneni balance_after z ulozenych e-mailu (dry-run default)"
```

- [ ] **Step 4: Dry-run na produkci a report uživateli**

```bash
B64=$(base64 < scripts/migrate-balance-after.cjs | tr -d '\n')
railway ssh --service app-spendex "echo $B64 | base64 -d > /tmp/mig.cjs && SQLITE_MODULE=/app/node_modules/better-sqlite3 DB_PATH=/data/data.db node /tmp/mig.cjs" 2>&1 | tail -20
```

Výsledek dry-runu ohlas uživateli. **Ostrý běh (`CONFIRM=1`) nespouštěj — čekej na explicitní pokyn.**

---

### Task 4: Sdílený helper `src/utils/savings.js`

**Files:**
- Create: `src/utils/savings.js`
- Modify: `src/routes/stats.js:85-165` (blok počítající `savings` v `/api/stats/overview`)
- Test: `src/routes/stats.test.js` (stávající testy „savings: …" musí projít beze změny)

**Interfaces:**
- Consumes: `normCounterparty` z `src/utils/income.js`, `savingsAccount` a `savingsNet` z `src/utils/recurring.js`
- Produces:
  - `findSavingsAccountId(db, userId) → number | null`
  - `savingsMovements(db, userId, start, end) → { transfers, deposits, withdrawals, net }`, kde `transfers` má stejný tvar jako dnešní `stats.savings.transfers` (řádky transakcí + `external: 0|1`, `is_regular: boolean`)

Cíl je čistý přesun beze změny chování. Dvě nezávislé definice „co je vklad na spořicí" by se dřív nebo později rozešly a Schůzka by ukazovala jiné číslo než graf.

- [ ] **Step 1: Zaznamenej výchozí zelený stav**

Run: `node --test src/routes/stats.test.js --test-force-exit`
Expected: PASS — poznamenej si počet testů, po refaktoru musí sedět.

- [ ] **Step 2: Vytvoř helper**

Create `src/utils/savings.js` — kód přenes z `src/routes/stats.js` (řádky 85–165) i s komentáři, které vysvětlují párování noh:

```js
'use strict';
const { normCounterparty } = require('./income');
const { savingsAccount, savingsNet } = require('./recurring');

// Obě nohy interního převodu jsou v datech: noha na běžném účtu (spořicí je
// protistrana) a noha zaúčtovaná přímo na spořicím účtu. Bez párování by se
// každý převod počítal dvakrát.
const PAIR_WINDOW_DAYS = 3;
const dayDiff = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

/**
 * ID spořicího účtu v `accounts`. Hledá se přes normalizované číslo, ne exact
 * match na sloupec — jinak by stačila mezera navíc a sledování by tiše vyplo.
 */
function findSavingsAccountId(db, userId) {
  const target = normCounterparty(savingsAccount);
  return db.prepare('SELECT id, account_number FROM accounts WHERE user_id = ?')
    .all(userId)
    .filter(a => normCounterparty(a.account_number) === target)
    .map(a => a.id)[0] || null;
}

/**
 * Pohyby na spořicím účtu v rozsahu dat, dedupované na jednu nohu převodu.
 * `deposits`/`withdrawals` jsou z pohledu spořicího účtu (kladné = přibylo).
 */
function savingsMovements(db, userId, start, end) {
  const savingsNumber = normCounterparty(savingsAccount);
  const savingsAccountId = findSavingsAccountId(db, userId);

  // REPLACE v porovnání protiúčtu: čísla účtů chodí i s mezerami, exact LIKE by je minul.
  const rows = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount, t.counterparty_account, t.note,
           a.name AS account_name, a.account_number AS account_number
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
    WHERE t.user_id = ? AND t.date >= ? AND t.date <= ?
      AND (REPLACE(t.counterparty_account, ' ', '') LIKE ? || '%' OR t.account_id = ?)
    ORDER BY t.date DESC, t.id DESC
  `).all(userId, start, end, savingsNumber, savingsAccountId);

  // Noha zaúčtovaná na běžném účtu (spořicí je protistrana) je referenční — z ní se
  // pohyb počítá vždy. Noha zaúčtovaná na spořicím účtu se zahodí jen tehdy, když k ní
  // referenční protějšek v datech SKUTEČNĚ existuje (stejné datum, opačná částka, 1:1).
  const pool = rows
    .filter(t => normCounterparty(t.counterparty_account) === savingsNumber)
    .map(t => ({ date: t.date, amount: -t.amount, used: false }));   // částka z pohledu spořicího

  function takeCounterpartyLeg(t) {
    let best = null;
    for (const p of pool) {
      if (p.used || p.amount !== t.amount) continue;
      const d = dayDiff(p.date, t.date);
      if (d > PAIR_WINDOW_DAYS) continue;
      if (!best || d < best.d) best = { p, d };
      if (d === 0) break;
    }
    if (!best) return false;
    best.p.used = true;
    return true;
  }

  const transfers = rows
    .map(t => {
      if (normCounterparty(t.counterparty_account) === savingsNumber) {
        return { ...t, external: 0, is_regular: t.amount === -25000 };
      }
      if (takeCounterpartyLeg(t)) return null;    // druhá noha už započteného převodu
      return { ...t, external: 1, is_regular: false };
    })
    .filter(Boolean);

  // Pohled spořicího účtu: kladné = přibylo (vklad), záporné = ubylo (výběr).
  const sav = transfers.reduce((acc, t) => {
    const v = t.external ? t.amount : -t.amount;
    if (v > 0) acc.deposits += v;
    else acc.withdrawals += -v;
    return acc;
  }, { deposits: 0, withdrawals: 0 });

  return { transfers, deposits: sav.deposits, withdrawals: sav.withdrawals, net: savingsNet(sav) };
}

module.exports = { savingsMovements, findSavingsAccountId, PAIR_WINDOW_DAYS };
```

- [ ] **Step 3: Přepoj `/api/stats/overview` na helper**

V `src/routes/stats.js` nahraď celý blok od komentáře „Spořicí účet se hledá přes normalizované číslo…" po přiřazení `const savings = { … }` (řádky ~85–165) tímto:

```js
  // Pohyby na spořicím účtu — sdílená pravda pro Schůzku i /savings-history.
  const savings = savingsMovements(db, req.dataUserId, start, end);
```

Do importů nahoře přidej:

```js
const { savingsMovements, findSavingsAccountId } = require('../utils/savings');
```

Z importu `../utils/recurring` odeber `savingsNet` a `savingsAccount`, pokud je v `stats.js` už nic jiného nepoužívá (zkontroluj `grep -n "savingsNet\|savingsAccount" src/routes/stats.js`). `normCounterparty` v souboru nech — používají ho i jiné bloky.

Tvar odpovědi se nemění: `savings` má stále klíče `deposits`, `withdrawals`, `net`, `transfers`.

- [ ] **Step 4: Run tests to verify nothing broke**

Run: `node --test src/routes/stats.test.js --test-force-exit`
Expected: PASS, stejný počet testů jako v Kroku 1 — zejména sada „savings: …".

- [ ] **Step 5: Commit**

```bash
git add src/utils/savings.js src/routes/stats.js
git commit -m "refactor(savings): dedup pohybu sporiciho uctu do sdileneho helperu"
```

---

### Task 5: Endpoint `GET /api/stats/savings-history`

**Files:**
- Modify: `src/routes/stats.js` (nová routa za `/budget-history`, před `module.exports`)
- Test: `src/routes/stats.test.js`

**Interfaces:**
- Consumes: `savingsMovements`, `findSavingsAccountId` (Task 4); `getPeriodDates`, `currentPeriodKey`, `getUserBillingDay`, `shiftPeriodKey`, `periodIndex`, `defaultHistoryRange`, `periodKeyForDate` z `src/utils/period.js`; sloupec `balance_after` (Task 2)
- Produces: JSON odpověď konzumovaná Taskem 7:

```jsonc
{
  "from": "2026-01", "to": "2026-08", "billing_day": 1,
  "periods": [{ "key": "2026-01", "start": "2026-01-01", "end": "2026-01-31", "partial": false }],
  "values": [{
    "period": "2026-01", "deposits": 25000, "withdrawals": 0, "net": 25000,
    "balance_derived": 98000, "balance_actual": null, "tx_ids": [1, 2]
  }],
  "anchor": { "date": "2026-08-02", "balance": 111878.44 },
  "totals": { "deposits": 0, "withdrawals": 0, "net": 0 }
}
```

Pravidla dopočtu:
- Kotva = poslední transakce se `balance_after IS NOT NULL` a `account_id` = spořicí účet, napříč CELOU historií (i mimo zobrazený rozsah).
- Zůstatek ke konci kotvícího období = `anchor.balance` + netto pohybů toho období s `date > anchor.date`. Porovnává se na úrovni DNE: pohyb ve stejný den po kotvě se nezapočítá. Je to vědomý kompromis — kotva je nejnovější snapshot, takže pohybů po ní je minimum, a `balance_actual` případný rozdíl zviditelní.
- Starší období: `balance_derived[i] = balance_derived[i+1] − net[i+1]`.
- Novější období: `balance_derived[i] = balance_derived[i-1] + net[i]`.
- Bez kotvy: `anchor: null` a `balance_derived` je všude `null`.
- `balance_actual` = `balance_after` poslední transakce v období, která má `account_id` = spořicí a nenulový `balance_after`; jinak `null`. Snapshoty z nohy na jiném účtu se ignorují — e-mail o odchozím převodu ze Společného nese zůstatek Společného.

- [ ] **Step 1: Write the failing tests**

Přidej na konec `src/routes/stats.test.js` (`setupSavings()` a konstanty `SAVINGS_ACC` / `MAIN_ACC` v souboru už existují — použij je):

```js
// ── GET /api/stats/savings-history ────────────────────────────────────────

test('savings-history: rozdělí pohyby do období a spočítá saldo', async () => {
  const { db, app, savingsId } = setupSavings();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,account_id) VALUES (1,25000,'2026-06-05','Vklad',?)").run(savingsId);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,account_id) VALUES (1,-5000,'2026-07-10','Vyber',?)").run(savingsId);
  const r = await (await fetch(`${base}/api/stats/savings-history?from=2026-06&to=2026-07`)).json();
  assert.deepEqual(r.values.map(v => v.period), ['2026-06', '2026-07']);
  assert.equal(r.values[0].deposits, 25000);
  assert.equal(r.values[0].net, 25000);
  assert.equal(r.values[1].withdrawals, 5000);
  assert.equal(r.values[1].net, -5000);
  assert.equal(r.totals.net, 20000);
  server.close();
});

test('savings-history: převod s oběma nohama se počítá jednou', async () => {
  const { db, app, savingsId, mainId } = setupSavings();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,-5000,'2026-07-10','Tomáš Střída',?,?)").run(SAVINGS_ACC, mainId);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id) VALUES (1,5000,'2026-07-10','Tomáš Střída',?,?)").run(MAIN_ACC, savingsId);
  const r = await (await fetch(`${base}/api/stats/savings-history?from=2026-07&to=2026-07`)).json();
  assert.equal(r.values[0].deposits, 5000, 'jen jedna noha převodu');
  assert.equal(r.values[0].tx_ids.length, 1);
  server.close();
});

test('savings-history: zpětný dopočet zůstatku od kotvy', async () => {
  const { db, app, savingsId } = setupSavings();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,account_id) VALUES (1,10000,'2026-06-05','Vklad',?)").run(savingsId);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,account_id,balance_after) VALUES (1,5000,'2026-07-20','Vklad',?,100000)").run(savingsId);
  const r = await (await fetch(`${base}/api/stats/savings-history?from=2026-06&to=2026-07`)).json();
  assert.equal(r.anchor.balance, 100000);
  assert.equal(r.values[1].balance_derived, 100000, 'kotvící období končí na kotvě');
  assert.equal(r.values[0].balance_derived, 95000, 'předchozí období = 100000 − 5000');
  assert.equal(r.values[1].balance_actual, 100000);
  assert.equal(r.values[0].balance_actual, null, 'období bez snapshotu nedopočítává skutečnost');
  server.close();
});

test('savings-history: kotva uprostřed období započítá i pozdější pohyby', async () => {
  const { db, app, savingsId } = setupSavings();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,account_id,balance_after) VALUES (1,5000,'2026-07-10','Vklad',?,100000)").run(savingsId);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,account_id) VALUES (1,-2000,'2026-07-25','Vyber',?)").run(savingsId);
  const r = await (await fetch(`${base}/api/stats/savings-history?from=2026-07&to=2026-07`)).json();
  assert.equal(r.values[0].balance_derived, 98000);
  server.close();
});

test('savings-history: bez snapshotu je anchor null a zůstatek se nedopočítává', async () => {
  const { db, app, savingsId } = setupSavings();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,account_id) VALUES (1,5000,'2026-07-10','Vklad',?)").run(savingsId);
  const r = await (await fetch(`${base}/api/stats/savings-history?from=2026-07&to=2026-07`)).json();
  assert.equal(r.anchor, null);
  assert.equal(r.values[0].balance_derived, null);
  server.close();
});

test('savings-history: snapshot z jiného účtu se do zůstatku nepromítne', async () => {
  const { db, app, savingsId, mainId } = setupSavings();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO transactions (user_id,amount,date,description,counterparty_account,account_id,balance_after) VALUES (1,-5000,'2026-07-10','Tomáš Střída',?,?,4321)").run(SAVINGS_ACC, mainId);
  const r = await (await fetch(`${base}/api/stats/savings-history?from=2026-07&to=2026-07`)).json();
  assert.equal(r.anchor, null, 'zůstatek běžného účtu není zůstatek spořicího');
  assert.equal(r.values[0].balance_actual, null);
  assert.equal(r.values[0].deposits, 5000, 'pohyb se ale započítá');
  server.close();
});

test('savings-history: neplatný rozsah vrátí 400', async () => {
  const { app } = setupSavings();
  const { server, base } = await listen(app);
  const res = await fetch(`${base}/api/stats/savings-history?from=2026-13&to=2026-07`);
  assert.equal(res.status, 400);
  server.close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/routes/stats.test.js --test-force-exit`
Expected: FAIL — nová routa neexistuje, odpověď je 404 a `r.values` je `undefined`.

- [ ] **Step 3: Write the implementation**

V `src/routes/stats.js` doplň import (k existujícímu importu z `../utils/period` přidej `periodKeyForDate`) a za routu `/budget-history` vlož:

```js
// ── GET /api/stats/savings-history?from=YYYY-MM&to=YYYY-MM ─────────────────
// Historie spořicího účtu: přírůstek za období + vývoj zůstatku. Zůstatek se
// kotví posledním REÁLNÝM snapshotem z AirBank notifikace a od něj se dopočítává
// oběma směry; skutečné snapshoty se vracejí zvlášť, ať je vidět případný rozdíl.
router.get('/savings-history', requireAuth, (req, res) => {
  const billingDay = getUserBillingDay(db, req.dataUserId);
  // Na rozdíl od /budget-history se zobrazuje i BĚŽÍCÍ období — u spoření je
  // rozjetý měsíc užitečná informace, ne zavádějící propad.
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

  const values = periods.map(p => {
    const m = savingsMovements(db, req.dataUserId, p.start, p.end);
    return {
      period: p.key,
      deposits: m.deposits,
      withdrawals: m.withdrawals,
      net: m.net,
      // tx_ids jsou povinné: součet je JS-počítaný přes dedup noh, takže filtr
      // podle data a účtu by v Transakcích vrátil i zahozené druhé nohy převodů.
      tx_ids: m.transfers.map(t => t.id),
      balance_derived: null,
      balance_actual: null,
    };
  });

  const savingsAccountId = findSavingsAccountId(db, req.dataUserId);

  // Skutečný zůstatek per období = poslední snapshot uvnitř období.
  if (savingsAccountId) {
    const snapStmt = db.prepare(`
      SELECT balance_after FROM transactions
      WHERE user_id = ? AND account_id = ? AND balance_after IS NOT NULL
        AND date >= ? AND date <= ?
      ORDER BY date DESC, COALESCE(tx_time, '') DESC, id DESC
      LIMIT 1
    `);
    periods.forEach((p, i) => {
      const row = snapStmt.get(req.dataUserId, savingsAccountId, p.start, p.end);
      values[i].balance_actual = row ? row.balance_after : null;
    });
  }

  // Kotva pro dopočet — nejnovější snapshot napříč celou historií, i mimo rozsah.
  const anchorRow = savingsAccountId
    ? db.prepare(`
        SELECT date, balance_after FROM transactions
        WHERE user_id = ? AND account_id = ? AND balance_after IS NOT NULL
        ORDER BY date DESC, COALESCE(tx_time, '') DESC, id DESC
        LIMIT 1
      `).get(req.dataUserId, savingsAccountId)
    : null;

  if (anchorRow) {
    const fromIdx = periodIndex(from);
    const toIdx = periodIndex(to);
    const anchorKey = periodKeyForDate(billingDay, anchorRow.date);
    const anchorIdx = periodIndex(anchorKey);

    // Netto pohyby libovolného období — zobrazená se berou z `values`, období mezi
    // rozsahem a kotvou (kotva může ležet mimo rozsah) se dopočítají dotazem.
    const netCache = new Map();
    values.forEach((v, i) => netCache.set(fromIdx + i, v.net));
    const netAt = absIdx => {
      if (!netCache.has(absIdx)) {
        const d = getPeriodDates(billingDay, shiftPeriodKey(from, absIdx - fromIdx));
        netCache.set(absIdx, savingsMovements(db, req.dataUserId, d.start, d.end).net);
      }
      return netCache.get(absIdx);
    };

    // Zůstatek ke konci kotvícího období: ke kotvě se přičtou pohyby, které v témže
    // období nastaly PO ní. Porovnává se na úrovni DNE — kotva je nejnovější snapshot,
    // takže pozdějších pohybů je minimum a `balance_actual` rozdíl stejně zviditelní.
    // Dotaz jde přes CELÉ období, ne od data kotvy: dedup noh převodu potřebuje
    // v okně obě strany, jinak by se osamocená noha započítala podruhé.
    const anchorDates = getPeriodDates(billingDay, anchorKey);
    const after = savingsMovements(db, req.dataUserId, anchorDates.start, anchorDates.end)
      .transfers
      .filter(t => t.date > anchorRow.date)
      .reduce((acc, t) => acc + (t.external ? t.amount : -t.amount), 0);

    const balances = new Map([[anchorIdx, anchorRow.balance_after + after]]);
    for (let a = anchorIdx - 1; a >= fromIdx; a--) balances.set(a, balances.get(a + 1) - netAt(a + 1));
    for (let a = anchorIdx + 1; a <= toIdx; a++) balances.set(a, balances.get(a - 1) + netAt(a));

    values.forEach((v, i) => {
      const b = balances.get(fromIdx + i);
      if (b != null) v.balance_derived = b;
    });
  }

  const totals = values.reduce((acc, v) => ({
    deposits: acc.deposits + v.deposits,
    withdrawals: acc.withdrawals + v.withdrawals,
    net: acc.net + v.net,
  }), { deposits: 0, withdrawals: 0, net: 0 });

  res.json({
    from, to, billing_day: billingDay, periods, values, totals,
    anchor: anchorRow ? { date: anchorRow.date, balance: anchorRow.balance_after } : null,
  });
});
```

Pozn.: `balances` je vedená v ABSOLUTNÍCH indexech období (`periodIndex`), ne v indexech pole — díky tomu je kotva mimo zobrazený rozsah stejný případ jako kotva uvnitř a nepotřebuje vlastní větev.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/routes/stats.test.js --test-force-exit`
Expected: PASS — všechny nové testy i všechny stávající.

- [ ] **Step 5: Run the full backend suite**

Run: `node --test 'src/**/*.test.js' --test-force-exit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/stats.js src/routes/stats.test.js
git commit -m "feat(api): endpoint savings-history s prirustkem a vyvojem zustatku"
```

---

### Task 6: Komponenta grafu `SavingsHistoryChart`

**Files:**
- Create: `client/src/components/SavingsHistoryChart.jsx`
- Reference: `client/src/components/SpendLineChart.jsx` (vzor SVG, ResizeObserver, hover), `client/src/utils/chartScale.js` (`niceScale`, `formatTick`, `shortPeriodLabel`)

**Interfaces:**
- Consumes: `periods` a `values` z odpovědi Tasku 5
- Produces: `<SavingsHistoryChart periods={…} values={…} onPeriodClick={(index) => void} showDerived={bool} showActual={bool} />`

`niceScale` záměrně vždy zahrne nulu, takže osa zůstatku začíná na nule — růst tím vypadá klidněji, než kdyby byla osa uříznutá, a to je správně: uříznutá osa u peněz je klasické zkreslení.

Konvence z `SpendLineChart.jsx` platí i tady: čáry 2px s kulatými spoji, body r≥4 s prstencem v barvě podkladu, mřížka hairline plná (nikdy čárkovaná), **jedna osa Y na panel**, popisky nesou textové barvy. Dvě škály v jednom grafu jsou zakázané — proto dva panely nad sebou se společnou osou X.

- [ ] **Step 1: Vytvoř komponentu**

Create `client/src/components/SavingsHistoryChart.jsx`:

```jsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatCurrency } from '../i18n';
import { niceScale, formatTick, shortPeriodLabel } from '../utils/chartScale';

// Dva panely nad sebou se SPOLEČNOU osou X:
//  • horní — zůstatek (dopočtený plnou čarou, skutečný ze snapshotů čárkovaně),
//  • dolní — čisté saldo období jako sloupce kolem nuly.
// Dvě škály v jednom grafu aplikace zakazuje (viz SpendLineChart.jsx) a saldo
// v desítkách tisíc vedle zůstatku ve stovkách tisíc by se stejně nedalo číst.

const PAD = { top: 16, right: 24, bottom: 34, left: 72 };
const BALANCE_H = 200;
const NET_H = 140;
const GAP = 24;

const COLOR_DERIVED = '#6366f1';
const COLOR_ACTUAL = '#0ea5e9';
const COLOR_POSITIVE = '#16a34a';
const COLOR_NEGATIVE = '#dc2626';

export default function SavingsHistoryChart({ periods, values, onPeriodClick, showDerived = true, showActual = true }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { setActive(null); }, [periods, values]);

  const n = periods.length;
  const height = BALANCE_H + GAP + NET_H;
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const balanceTop = PAD.top;
  const balanceH = BALANCE_H - PAD.top;
  const netTop = BALANCE_H + GAP;
  const netH = NET_H - PAD.bottom;

  // Osa X sdílená oběma panely — střed sloupce i bod křivky leží na stejném x.
  const x = i => PAD.left + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const bandW = n > 0 ? plotW / Math.max(n, 1) : 0;
  const barW = Math.max(6, Math.min(38, bandW * 0.55));

  const balanceValues = values.flatMap(v => [
    showDerived ? v.balance_derived : null,
    showActual ? v.balance_actual : null,
  ]).filter(v => v != null);
  const hasBalance = balanceValues.length > 0;
  const balScale = niceScale(Math.min(...balanceValues, 0), Math.max(...balanceValues, 0));
  const netScale = niceScale(
    Math.min(0, ...values.map(v => v.net)),
    Math.max(0, ...values.map(v => v.net))
  );

  const yBal = v => balanceTop + balanceH - ((v - balScale.min) / (balScale.max - balScale.min || 1)) * balanceH;
  const yNet = v => netTop + netH - ((v - netScale.min) / (netScale.max - netScale.min || 1)) * netH;
  const zeroY = yNet(0);

  // Křivka se kreslí jen mezi SOUSEDNÍMI body, které oba existují — chybějící
  // snapshot nesmí nic domýšlet, linka se v tom místě přeruší.
  function segments(key) {
    const out = [];
    let run = [];
    values.forEach((v, i) => {
      const val = v[key];
      if (val == null) { if (run.length > 1) out.push(run); run = []; return; }
      run.push(`${x(i)},${yBal(val)}`);
    });
    if (run.length > 1) out.push(run);
    return out.map(pts => pts.join(' '));
  }

  if (!width || !n) return <div className="chart-wrap" ref={wrapRef} style={{ height }} />;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg width={width} height={height} role="img" aria-label="Vývoj spoření">
        {/* horní panel — zůstatek */}
        {hasBalance && balScale.ticks.map(tv => (
          <g key={`b${tv}`}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={yBal(tv)} y2={yBal(tv)} className="chart-grid-line" />
            <text x={PAD.left - 10} y={yBal(tv)} className="chart-tick chart-tick-y">{formatTick(tv)}</text>
          </g>
        ))}
        {!hasBalance && (
          <text x={PAD.left} y={balanceTop + balanceH / 2} className="chart-tick">
            Zůstatek zatím neznáme — doplní se z notifikací ze spořicího účtu.
          </text>
        )}
        {showDerived && segments('balance_derived').map((d, i) => (
          <polyline key={`d${i}`} points={d} fill="none" stroke={COLOR_DERIVED} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {showActual && segments('balance_actual').map((d, i) => (
          <polyline key={`a${i}`} points={d} fill="none" stroke={COLOR_ACTUAL} strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {showActual && values.map((v, i) => v.balance_actual == null ? null : (
          <circle key={`ap${i}`} cx={x(i)} cy={yBal(v.balance_actual)} r="4" fill={COLOR_ACTUAL} stroke="var(--bg-card, #fff)" strokeWidth="2" />
        ))}

        {/* dolní panel — saldo */}
        {netScale.ticks.map(tv => (
          <g key={`n${tv}`}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={yNet(tv)} y2={yNet(tv)} className="chart-grid-line" />
            <text x={PAD.left - 10} y={yNet(tv)} className="chart-tick chart-tick-y">{formatTick(tv)}</text>
          </g>
        ))}
        <line x1={PAD.left} x2={PAD.left + plotW} y1={zeroY} y2={zeroY} className="chart-axis-line" />
        {values.map((v, i) => {
          const top = v.net >= 0 ? yNet(v.net) : zeroY;
          const h = Math.abs(yNet(v.net) - zeroY);
          return (
            <rect
              key={`bar${i}`}
              x={x(i) - barW / 2}
              y={top}
              width={barW}
              height={Math.max(1, h)}
              fill={v.net >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE}
              opacity={periods[i]?.partial ? 0.45 : (active == null || active === i ? 1 : 0.55)}
            />
          );
        })}

        {/* společná osa X + interakce */}
        {periods.map((p, i) => (
          <text key={`x${i}`} x={x(i)} y={height - 10} className="chart-tick chart-tick-x">
            {shortPeriodLabel(p.key)}
          </text>
        ))}
        {periods.map((p, i) => (
          <rect
            key={`hit${i}`}
            x={x(i) - bandW / 2}
            y={0}
            width={bandW}
            height={height}
            fill="transparent"
            style={{ cursor: onPeriodClick ? 'pointer' : 'default' }}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onClick={() => onPeriodClick && onPeriodClick(i)}
          >
            <title>
              {`${shortPeriodLabel(p.key)}${p.partial ? ' (probíhá)' : ''}\n`}
              {`Saldo: ${formatCurrency(values[i].net)}\n`}
              {`Vklady: ${formatCurrency(values[i].deposits)} · Výběry: ${formatCurrency(values[i].withdrawals)}`}
            </title>
          </rect>
        ))}
        {active != null && (
          <line
            x1={x(active)} x2={x(active)}
            y1={balanceTop} y2={netTop + netH}
            className="chart-grid-line"
          />
        )}
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Ověř, že se komponenta přeloží**

Run: `cd client && npm run build`
Expected: build projde bez chyb. (Komponenta zatím není nikde použitá — Vite ji přesto zkontroluje jako součást modulu až v Tasku 7; pokud ji tree-shake vynechá, ověření proběhne až tam.)

- [ ] **Step 3: Commit**

```bash
git add client/src/components/SavingsHistoryChart.jsx
git commit -m "feat(ui): komponenta grafu vyvoje sporeni (dva panely, spolecna osa X)"
```

---

### Task 7: Stránka „Vývoj spoření"

**Files:**
- Create: `client/src/pages/SavingsHistoryPage.jsx`
- Modify: `client/src/App.jsx` (import + `<Route path="/savings-history" …>` vedle `/budget-history` na řádku 114)
- Modify: `client/src/components/Sidebar.jsx:33` (nová položka pod `/budget-history`)
- Modify: `client/src/i18n.js:13` (`savingsHistory: 'Vývoj spoření'`)
- Modify: `client/src/pages/SavingsPage.jsx` (odkaz na historii v hlavičce stránky)

**Interfaces:**
- Consumes: `GET /api/stats/savings-history` (Task 5), `<SavingsHistoryChart>` (Task 6)
- Produces: routa `/savings-history`

- [ ] **Step 1: Přidej text do i18n**

`client/src/i18n.js`, do bloku `nav` hned za `budgetHistory`:

```js
    savingsHistory: 'Vývoj spoření',
```

- [ ] **Step 2: Vytvoř stránku**

Create `client/src/pages/SavingsHistoryPage.jsx`:

```jsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { BarChart3, Table2 } from 'lucide-react';
import Layout from '../components/Layout';
import SavingsHistoryChart from '../components/SavingsHistoryChart';
import { t, formatCurrency } from '../i18n';
import { shortPeriodLabel, signPrefix, periodAverage } from '../utils/chartScale';

export default function SavingsHistoryPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTable, setShowTable] = useState(false);
  const [showDerived, setShowDerived] = useState(true);
  const [showActual, setShowActual] = useState(true);

  useEffect(() => {
    const qs = range.from && range.to ? `?from=${range.from}&to=${range.to}` : '';
    setLoading(true);
    fetch(`/api/stats/savings-history${qs}`)
      .then(async r => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Načtení se nepovedlo.');
        return body;
      })
      .then(d => {
        setError('');
        setData(d);
        // Rozsah dopočítává server (default = od ledna, minimálně 6 období,
        // včetně běžícího) → inputy naplní až odpověď.
        setRange(prev => (prev.from && prev.to ? prev : { from: d.from, to: d.to }));
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  const periods = useMemo(() => data?.periods || [], [data]);
  const values = useMemo(() => data?.values || [], [data]);
  const hasActual = values.some(v => v.balance_actual != null);

  // Proklik jde přes tx_ids, ne přes období — součty jsou JS-počítané přes dedup
  // noh převodů, takže filtr podle data a účtu by vrátil i zahozené protějšky.
  function openTransactions(index) {
    const ids = values[index]?.tx_ids || [];
    if (!ids.length) return;
    navigate(`/transactions?tx_ids=${ids.join(',')}`);
  }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{t.nav.savingsHistory}</h1>
        <Link className="btn btn-ghost" to="/savings">{t.nav.savings}</Link>
      </div>

      <div className="chart-filters">
        <label className="chart-filter">
          <span>Od</span>
          <input type="month" className="input" value={range.from} max={range.to || undefined}
                 onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
        </label>
        <label className="chart-filter">
          <span>Do</span>
          <input type="month" className="input" value={range.to} min={range.from || undefined}
                 onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
        </label>
        <button className={`btn btn-ghost${showTable ? ' active' : ''}`} onClick={() => setShowTable(v => !v)}>
          {showTable ? <BarChart3 size={16} /> : <Table2 size={16} />}
          {showTable ? 'Graf' : 'Tabulka'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!error && data && (
        <div className={`card chart-card${loading ? ' is-loading' : ''}`}>
          <div className="chart-stats">
            <div className="chart-stat">
              <span className="chart-stat-label">Naspořeno za rozsah</span>
              <span className="chart-stat-value">{signPrefix(data.totals.net)}{formatCurrency(data.totals.net)}</span>
              <span className="chart-stat-note">
                vklady {formatCurrency(data.totals.deposits)} · výběry {formatCurrency(data.totals.withdrawals)}
              </span>
            </div>
            <div className="chart-stat">
              <span className="chart-stat-label">Průměr měsíčně</span>
              <span className="chart-stat-value">
                {(() => { const a = periodAverage(values.map(v => v.net)); return <>{signPrefix(a)}{formatCurrency(a)}</>; })()}
              </span>
              <span className="chart-stat-note">{periods.length} období včetně nulových</span>
            </div>
            <div className="chart-stat">
              <span className="chart-stat-label">Poslední známý zůstatek</span>
              <span className="chart-stat-value">
                {data.anchor ? formatCurrency(data.anchor.balance) : '—'}
              </span>
              <span className="chart-stat-note">
                {data.anchor ? `podle notifikace z ${data.anchor.date}` : 'čeká na notifikaci ze spořicího účtu'}
              </span>
            </div>
          </div>

          {showTable ? (
            <SavingsTable periods={periods} values={values} />
          ) : (
            <SavingsHistoryChart
              periods={periods}
              values={values}
              onPeriodClick={openTransactions}
              showDerived={showDerived}
              showActual={showActual}
            />
          )}

          {!showTable && (
            <div className="chart-legend">
              <div className="chart-legend-items">
                <button className={`chart-legend-item${showDerived ? ' on' : ''}`} aria-pressed={showDerived}
                        onClick={() => setShowDerived(v => !v)}>
                  <span className="chart-legend-key" style={{ background: '#6366f1' }} />
                  <span className="chart-legend-name">Zůstatek (dopočtený)</span>
                </button>
                <button className={`chart-legend-item${showActual ? ' on' : ''}`} aria-pressed={showActual}
                        disabled={!hasActual} onClick={() => setShowActual(v => !v)}>
                  <span className="chart-legend-key" style={{ background: '#0ea5e9' }} />
                  <span className="chart-legend-name">Zůstatek (z notifikací)</span>
                </button>
              </div>
            </div>
          )}

          {periods.some(p => p.partial) && (
            <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
              Poslední období ještě probíhá — sloupec je světlejší a čísla nejsou konečná.
            </div>
          )}
        </div>
      )}

      {loading && !data && <div className="page-loading">Načítám…</div>}
    </Layout>
  );
}

// Tabulkový pohled — stejná data bez hoveru, aby žádná hodnota nebyla
// dostupná jen přes tooltip.
function SavingsTable({ periods, values }) {
  return (
    <div className="chart-table-scroll">
      <table className="chart-table">
        <thead>
          <tr>
            <th>Období</th>
            <th className="num">Vklady</th>
            <th className="num">Výběry</th>
            <th className="num">Saldo</th>
            <th className="num">Zůstatek (dopočtený)</th>
            <th className="num">Zůstatek (z notifikací)</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p, i) => (
            <tr key={p.key}>
              <td>{shortPeriodLabel(p.key)}{p.partial ? ' (probíhá)' : ''}</td>
              <td className="num">{formatCurrency(values[i].deposits)}</td>
              <td className="num">{formatCurrency(values[i].withdrawals)}</td>
              <td className="num strong">{signPrefix(values[i].net)}{formatCurrency(values[i].net)}</td>
              <td className="num">{values[i].balance_derived == null ? '—' : formatCurrency(values[i].balance_derived)}</td>
              <td className="num">{values[i].balance_actual == null ? '—' : formatCurrency(values[i].balance_actual)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Zaregistruj routu a položku menu**

`client/src/App.jsx` — k importům stránek:

```jsx
import SavingsHistoryPage from './pages/SavingsHistoryPage';
```

a hned za řádek s `/budget-history`:

```jsx
            <Route path="/savings-history" element={<R el={<SavingsHistoryPage />} />} />
```

`client/src/components/Sidebar.jsx` — hned za položku `/budget-history` (ikonu `LineChart` přidej do importu z `lucide-react`):

```jsx
      { to: '/savings-history', icon: LineChart, label: t.nav.savingsHistory },
```

- [ ] **Step 4: Prolinkuj z měsíční stránky**

`client/src/pages/SavingsPage.jsx` — do `page-header` vedle nadpisu přidej odkaz (`Link` už je v souboru importovaný):

```jsx
        <Link className="btn btn-ghost" to="/savings-history">{t.nav.savingsHistory}</Link>
```

- [ ] **Step 5: Ověř build a lint**

Run: `cd client && npm run build` a v kořeni `npm run lint`
Expected: obojí projde bez chyb.

- [ ] **Step 6: Ověř v prohlížeči**

Spusť aplikaci lokálně a otevři `/savings-history`. Zkontroluj:
- graf se vykreslí, sloupce salda i křivky zůstatku sedí na stejná období,
- přepínač Tabulka ukazuje stejná čísla jako graf,
- klik na období otevře Transakce a **počet i součet odpovídá** hodnotě v grafu,
- bez snapshotů (lokální DB) se místo křivek zobrazí hláška a stránka nespadne.

- [ ] **Step 7: Commit a push**

```bash
git add client/src/pages/SavingsHistoryPage.jsx client/src/App.jsx client/src/components/Sidebar.jsx client/src/i18n.js client/src/pages/SavingsPage.jsx
git commit -m "feat(ui): stranka Vyvoj sporeni"
git push origin staging
```

---

## Poznámky k dokončení

- Po pushnutí do `staging` ohlas uživateli číslo verze (bump dělá hook automaticky).
- Ostrý běh retro migrace (`CONFIRM=1`) je samostatný krok **po** schválení dry-run výstupu uživatelem.
- Známé omezení k zapsání do paměti projektu po dokončení: dopočet zůstatku porovnává kotvu na úrovni dne, takže pohyb ve stejný den po kotvě se do zůstatku kotvícího období nezapočítá.
