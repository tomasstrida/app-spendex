# Rozpad Licencí podle Apple účtu — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na kartě roční kategorie ukázat, kolik za rok utratil který Apple účet, a umožnit proklik na odpovídající transakce.

**Architecture:** Apple účet se parsuje z faktury a ukládá do nového sloupce `apple_receipts.apple_account`. Transakce nový sloupec nedostávají — součty i filtr jdou přes vazbu `apple_receipts.transaction_id`. Rozpad na stránce Roční budgety kopíruje existující rozpad podle subkategorie.

**Tech Stack:** Node.js + Express, better-sqlite3, `node:test`, React + Vite.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-apple-ucty-rozpad-design.md`.
- Migrace se přidávají na konec `initSchema()` v `src/db/schema.js`, žádný framework.
- Každý DB dotaz scopovaný na `req.dataUserId` (v routerech) nebo předaný `userId` (ve službách); nikdy `req.user.id`.
- Faktura nikdy nemění `amount`, `date` ani `category_id` transakce.
- Apple účet se ukládá i porovnává **normalizovaně na malá písmena**.
- Do součtů i filtru vstupují jen faktury se `status = 'matched'`.
- Backend CommonJS, klient ESM. Žádné TypeScript anotace.
- Jazyk UI čeština s diakritikou; commit message bez diakritiky.
- Testy pouštěj SYNCHRONNĚ (nikdy na pozadí), vždy s `--test-timeout=20000`, timeout nástroje 300000 ms:
  - backend: `node --test --test-timeout=20000 'src/**/*.test.js' --test-force-exit` (uvozovky povinné)
  - klient: `node --test --test-timeout=20000 client/src/utils/*.test.js`
  - build: `cd client && npm run build`
- Výchozí stav: backend 436/436. Nesmí ubýt.

**Zpřesnění proti specu (platí pro Task 3 a 5):** spec popisuje `apple_account=none` jako
„transakce bez spárované faktury". Přesně to musí být **bez spárované faktury s neprázdným
`apple_account`** — jinak by faktura, u které se účet nerozpoznal, chyběla jak v součtech účtů,
tak ve filtru `none`, a rozpad by nesečetl na celek kategorie.

---

### Task 1: Apple účet z faktury do databáze

**Files:**
- Modify: `src/utils/appleInvoiceParser.js`
- Modify: `src/db/schema.js` (pole migrací)
- Modify: `src/services/appleReceipts.js` (INSERT v `ingestAppleInvoice`)
- Test: `src/utils/appleInvoiceParser.test.js`, `src/services/appleReceipts.test.js`, `src/db/schema.test.js`

**Interfaces:**
- Produces: `parseAppleInvoice(source)` vrací navíc `apple_account` (string s malými písmeny, nebo `null`); sloupec `apple_receipts.apple_account` naplněný při uložení faktury.

- [ ] **Step 1: Napiš failing testy**

Do `src/utils/appleInvoiceParser.test.js`:

```javascript
test('vytahne Apple Account z faktury', async () => {
  const r = parseAppleInvoice(await fixtureBody());
  assert.equal(r.apple_account, 'user@example.com');
});

test('Apple Account se normalizuje na mala pismena', () => {
  const html = '<html><body><h1>Invoice</h1><div class="billing-information">'
    + '<p>2 July 2026</p><p>Apple Account:</p><p>Tomas.Strida@ICLOUD.com</p></div>'
    + '<div class="payment-information"><p>50,00 CZK</p></div></body></html>';
  assert.equal(parseAppleInvoice(html).apple_account, 'tomas.strida@icloud.com');
});

test('faktura bez Apple Account vraci null', () => {
  const html = '<html><body><h1>Invoice</h1><div class="billing-information">'
    + '<p>2 July 2026</p><p>Order ID:</p><p>ZZZ999</p></div>'
    + '<div class="payment-information"><p>50,00 CZK</p></div></body></html>';
  assert.equal(parseAppleInvoice(html).apple_account, null);
});
```

Do `src/db/schema.test.js`:

```javascript
test('apple_receipts ma sloupec apple_account', () => {
  const { db } = setup();
  const cols = db.prepare('PRAGMA table_info(apple_receipts)').all().map(c => c.name);
  assert.ok(cols.includes('apple_account'), 'chybi sloupec apple_account');
});
```

Do `src/services/appleReceipts.test.js`:

```javascript
test('ingest ulozi apple_account z faktury', async () => {
  const { db, svc } = setup();
  const r = svc.ingestAppleInvoice(db, 1, await fixtureBody());
  const row = db.prepare('SELECT apple_account FROM apple_receipts WHERE id = ?').get(r.receiptId);
  assert.equal(row.apple_account, 'user@example.com');
});
```

Helper `setup()` i `fixtureBody()` v těch souborech už existují — použij je tak, jak jsou.

- [ ] **Step 2: Spusť testy, ověř že padají**

Run: `node --test --test-timeout=20000 src/utils/appleInvoiceParser.test.js src/db/schema.test.js src/services/appleReceipts.test.js --test-force-exit`
Expected: FAIL — `apple_account` je `undefined`, sloupec neexistuje.

- [ ] **Step 3: Rozšiř parser**

V `src/utils/appleInvoiceParser.js` přidej nad `parseAppleInvoice` pomocnou funkci. Vzor je
`parseDate` — hledej primárně v bloku `billing-information`, kde Apple ten řádek uvádí:

```javascript
// Účet, ze kterého byl nákup zaplacen („Apple Account: user@icloud.com").
// Uživatel může mít víc Apple ID a chce vidět, kolik utratil který — proto se
// hodnota normalizuje na malá písmena, ať se dva zápisy téhož účtu nerozejdou.
function parseAppleAccount(html, text) {
  const billBlock = String(html).match(/class="billing-information[\s\S]{0,4000}/i);
  const pool = billBlock ? stripToText(billBlock[0]) : text;
  const m = pool.match(/Apple Account:\s*([^\s<]+@[^\s<]+)/i)
    || text.match(/Apple Account:\s*([^\s<]+@[^\s<]+)/i);
  return m ? m[1].trim().toLowerCase() : null;
}
```

A do návratového objektu `parseAppleInvoice` přidej:

```javascript
    apple_account: parseAppleAccount(html, text),
```

- [ ] **Step 4: Přidej migraci**

Do pole migrací v `src/db/schema.js`, k ostatním `ALTER TABLE`:

```javascript
    'ALTER TABLE apple_receipts ADD COLUMN apple_account TEXT',
    'CREATE INDEX IF NOT EXISTS idx_apple_receipt_account ON apple_receipts(user_id, apple_account)',
```

- [ ] **Step 5: Ulož hodnotu při ingestu**

V `src/services/appleReceipts.js` ve funkci `ingestAppleInvoice` rozšiř INSERT o sloupec
`apple_account` a jeho hodnotu `receipt.apple_account`. Sloupec přidej na konec seznamu sloupců
i hodnot, ať se nerozejdou pozice ostatních parametrů.

- [ ] **Step 6: Spusť testy, ověř že prochází**

Run: `node --test --test-timeout=20000 'src/**/*.test.js' --test-force-exit`
Expected: PASS, žádná regrese proti 436 výchozím testům

- [ ] **Step 7: Commit**

```bash
git add src/utils/appleInvoiceParser.js src/utils/appleInvoiceParser.test.js src/db/schema.js src/db/schema.test.js src/services/appleReceipts.js src/services/appleReceipts.test.js
git commit -m "feat(apple): apple_account z faktury do databaze"
```

---

### Task 2: Součty podle Apple účtu

**Files:**
- Modify: `src/routes/budget-items.js:77-96`
- Test: `src/routes/budget-items.test.js`

**Interfaces:**
- Consumes: sloupec `apple_receipts.apple_account` (Task 1)
- Produces: `GET /api/budget-items` vrací navíc `category_apple_account_year_spent` ve tvaru `{ [category_id]: [{ apple_account, spent }] }`, seřazeno sestupně podle `spent`.

- [ ] **Step 1: Napiš failing test**

Do `src/routes/budget-items.test.js` (setup i `listen` v souboru už jsou — použij je):

```javascript
test('rozpad podle Apple uctu scita jen sparovane faktury rocnich kategorii', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (60,1,'Y_Licence',2)").run();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (300,1,60,-269,'2026-03-01','APPLE.COM/BILL'),
                     (301,1,60,-100,'2026-04-01','APPLE.COM/BILL'),
                     (302,1,60,-500,'2026-05-01','APPLE.COM/BILL'),
                     (303,1,60,-50,'2026-06-01','APPLE.COM/BILL')`).run();
  db.prepare(`INSERT INTO apple_receipts (user_id, raw_text, status, transaction_id, apple_account)
              VALUES (1,'raw','matched',300,'prvni@icloud.com'),
                     (1,'raw','matched',301,'prvni@icloud.com'),
                     (1,'raw','matched',302,'druhy@icloud.com'),
                     (1,'raw','pending',303,'treti@icloud.com')`).run();

  const d = await (await fetch(`${base}/api/budget-items?year=2026`)).json();
  const rows = d.category_apple_account_year_spent[60];
  assert.equal(rows.length, 2, 'jen dva ucty se sparovanou fakturou');
  assert.equal(rows[0].apple_account, 'prvni@icloud.com');
  assert.equal(rows[0].spent, 369, '269 + 100');
  assert.equal(rows[1].apple_account, 'druhy@icloud.com');
  assert.equal(rows[1].spent, 500);
  server.close();
});

test('rozpad podle Apple uctu nezahrne mesicni kategorie ani faktury bez uctu', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (61,1,'Mesicni',1),(62,1,'Rocni',2)").run();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (310,1,61,-200,'2026-03-01','APPLE.COM/BILL'),
                     (311,1,62,-300,'2026-03-01','APPLE.COM/BILL')`).run();
  db.prepare(`INSERT INTO apple_receipts (user_id, raw_text, status, transaction_id, apple_account)
              VALUES (1,'raw','matched',310,'prvni@icloud.com'),
                     (1,'raw','matched',311,NULL)`).run();

  const d = await (await fetch(`${base}/api/budget-items?year=2026`)).json();
  assert.equal(d.category_apple_account_year_spent[61], undefined, 'mesicni kategorie tam nepatri');
  assert.equal(d.category_apple_account_year_spent[62], undefined, 'faktura bez uctu se nepocita');
  server.close();
});
```

- [ ] **Step 2: Spusť test, ověř že padá**

Run: `node --test --test-timeout=20000 src/routes/budget-items.test.js --test-force-exit`
Expected: FAIL — `d.category_apple_account_year_spent` je `undefined`

- [ ] **Step 3: Přidej agregát**

Do `src/routes/budget-items.js` za blok `category_subcategory_year_spent` (kolem řádku 95):

```javascript
  // Rozpad ročních kategorií podle Apple účtu, ze kterého byl nákup zaplacen.
  // Účet žije na faktuře (apple_receipts), ne na transakci — proto JOIN přes
  // transaction_id. Jen `matched` faktury: odpojená by se počítala dvakrát,
  // jednou tady a jednou v dopočítaném řádku „bez faktury" na klientovi.
  const appleSpent = db.prepare(`
    SELECT t.category_id, LOWER(ar.apple_account) AS apple_account,
           COALESCE(SUM(-t.amount), 0) AS spent
    FROM transactions t
    JOIN apple_receipts ar ON ar.transaction_id = t.id AND ar.user_id = t.user_id
    JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
    WHERE t.user_id = ? AND c.type = 2
      AND ar.apple_account IS NOT NULL AND ar.status = 'matched'
      AND t.date >= ? AND t.date <= ?
    GROUP BY t.category_id, LOWER(ar.apple_account)
    ORDER BY spent DESC
  `).all(req.dataUserId, `${year}-01-01`, `${year}-12-31`);
  const category_apple_account_year_spent = {};
  for (const r of appleSpent) {
    if (!category_apple_account_year_spent[r.category_id]) category_apple_account_year_spent[r.category_id] = [];
    category_apple_account_year_spent[r.category_id].push({ apple_account: r.apple_account, spent: r.spent });
  }
```

A rozšiř `res.json({...})` o `category_apple_account_year_spent`.

- [ ] **Step 4: Spusť testy, ověř že prochází**

Run: `node --test --test-timeout=20000 src/routes/budget-items.test.js --test-force-exit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/budget-items.js src/routes/budget-items.test.js
git commit -m "feat(apple): soucty rocnich kategorii podle Apple uctu"
```

---

### Task 3: Filtr transakcí podle Apple účtu (API)

**Files:**
- Modify: `src/routes/transactions.js:16-17` (destrukturace) a okolí řádku 117
- Test: `src/routes/transactions.test.js`

**Interfaces:**
- Produces: `GET /api/transactions?apple_account=<e-mail>` vrátí jen transakce se spárovanou fakturou daného účtu; `apple_account=none` vrátí transakce **bez** spárované faktury s neprázdným účtem. Platí i pro `GET /api/transactions/export`.

- [ ] **Step 1: Napiš failing test**

Do `src/routes/transactions.test.js`:

```javascript
test('filtr apple_account vrati jen transakce daneho uctu', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (400,1,5,-269,'2026-03-01','APPLE.COM/BILL'),
                     (401,1,5,-500,'2026-03-02','APPLE.COM/BILL'),
                     (402,1,5,-100,'2026-03-03','APPLE.COM/BILL')`).run();
  db.prepare(`INSERT INTO apple_receipts (user_id, raw_text, status, transaction_id, apple_account)
              VALUES (1,'raw','matched',400,'prvni@icloud.com'),
                     (1,'raw','matched',401,'druhy@icloud.com')`).run();

  const a = await (await fetch(`${base}/api/transactions?apple_account=prvni@icloud.com`)).json();
  const rowsA = a.transactions || a;
  assert.equal(rowsA.length, 1);
  assert.equal(rowsA[0].id, 400);

  const none = await (await fetch(`${base}/api/transactions?apple_account=none`)).json();
  const rowsNone = none.transactions || none;
  assert.equal(rowsNone.length, 1, 'jen transakce bez faktury');
  assert.equal(rowsNone[0].id, 402);
  server.close();
});

test('filtr apple_account je case-insensitive a ignoruje neparovane faktury', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (410,1,5,-269,'2026-03-01','APPLE.COM/BILL'),
                     (411,1,5,-300,'2026-03-02','APPLE.COM/BILL')`).run();
  db.prepare(`INSERT INTO apple_receipts (user_id, raw_text, status, transaction_id, apple_account)
              VALUES (1,'raw','matched',410,'prvni@icloud.com'),
                     (1,'raw','pending',411,'prvni@icloud.com')`).run();

  const r = await (await fetch(`${base}/api/transactions?apple_account=PRVNI@ICLOUD.COM`)).json();
  const rows = r.transactions || r;
  assert.equal(rows.length, 1, 'neparovana faktura se nepocita');
  assert.equal(rows[0].id, 410);

  const none = await (await fetch(`${base}/api/transactions?apple_account=none`)).json();
  assert.equal((none.transactions || none).length, 1, 'tx s pending fakturou patri do "bez faktury"');
  server.close();
});
```

- [ ] **Step 2: Spusť test, ověř že padá**

Run: `node --test --test-timeout=20000 src/routes/transactions.test.js --test-force-exit`
Expected: FAIL — filtr se ignoruje, vrátí se všechny tři transakce

- [ ] **Step 3: Přidej filtr do `buildTxWhere`**

Do destrukturace na řádku 17 přidej `apple_account`. Za blok `subcategory_id` (kolem řádku 120) vlož:

```javascript
  // Filtr podle Apple účtu z faktury. Účet žije na apple_receipts, ne na transakci —
  // proto EXISTS poddotaz, ne JOIN: join by při víc fakturách zduplikoval řádky
  // a rozbil stránkování.
  // `none` = transakce bez spárované faktury S ÚČTEM. Musí to sedět na dopočítaný
  // řádek „bez faktury" v rozpadu, do kterého spadají i faktury bez rozpoznaného účtu.
  if (apple_account !== undefined && String(apple_account).trim() !== '') {
    const val = String(apple_account).trim();
    const linked = `SELECT 1 FROM apple_receipts ar
      WHERE ar.transaction_id = t.id AND ar.user_id = t.user_id
        AND ar.status = 'matched' AND ar.apple_account IS NOT NULL`;
    if (val.toLowerCase() === 'none') {
      where += ` AND NOT EXISTS (${linked})`;
    } else {
      where += ` AND EXISTS (${linked} AND LOWER(ar.apple_account) = LOWER(?))`;
      params.push(val);
    }
  }
```

- [ ] **Step 4: Spusť testy, ověř že prochází**

Run: `node --test --test-timeout=20000 'src/**/*.test.js' --test-force-exit`
Expected: PASS, žádná regrese

- [ ] **Step 5: Commit**

```bash
git add src/routes/transactions.js src/routes/transactions.test.js
git commit -m "feat(apple): filtr transakci podle Apple uctu"
```

---

### Task 4: Filtr na stránce Transakce (klient)

**Files:**
- Modify: `client/src/pages/TransactionsPage.jsx` (čtení URL parametru kolem `:57-86`, sestavení dotazu kolem `:151-162`)

**Interfaces:**
- Consumes: `GET /api/transactions?apple_account=…` (Task 3)

- [ ] **Step 1: Načti parametr z URL**

Ke stávajícím `useState` z `searchParams` (kolem řádku 86) přidej:

```jsx
  // Apple účet z faktury — proklik z rozpadu na stránce Roční budgety.
  // Bez načtení z URL by se filtr při otevření stránky zahodil a proklik
  // by ukázal víc transakcí, než kolik je v součtu nad ním.
  const [appleAccount, setAppleAccount] = useState(searchParams.get('apple_account') || '');
```

- [ ] **Step 2: Předej ho do dotazu**

K ostatním `params.set` (kolem řádku 161) přidej:

```jsx
    if (appleAccount.trim() !== '') params.set('apple_account', appleAccount.trim());
```

A doplň `appleAccount` na konec pole závislostí `useEffect` na řádku 164 (to, které dnes končí
`…, spendingOnly, offFund, txIds]`). Bez toho se po zrušení filtru seznam znovu nenačte.

- [ ] **Step 3: Zobraz aktivní filtr s možností zrušit**

Filtr přichází jen z prokliku, takže nepotřebuje vlastní ovládací prvek — ale uživatel musí
vidět, že je aktivní, a umět ho zrušit. Panel aktivních filtrů je na řádcích 577-579; do jeho
podmínky přidej `|| appleAccount` a mezi chipy vlož nový (stejná struktura jako chip
„Protistrana" na řádcích 580-591):

```jsx
            {appleAccount && (
              <span className="tx-chip tx-chip-active" style={{ cursor: 'default' }}>
                Apple účet: {appleAccount === 'none' ? 'bez faktury' : appleAccount}
                <button
                  type="button"
                  onClick={() => setAppleAccount('')}
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, marginLeft: 6, display: 'inline-flex', alignItems: 'center' }}
                  title="Zrušit filtr podle Apple účtu"
                >
                  <X size={12} />
                </button>
              </span>
            )}
```

Přidej `appleAccount` i do podmínky na řádku 759 (tlačítko „zrušit všechny filtry"), ať se
zobrazí, když je aktivní jen tenhle filtr.

- [ ] **Step 4: Ověř build**

Run: `cd client && npm run build`
Expected: build projde bez chyby

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/TransactionsPage.jsx
git commit -m "feat(apple): filtr podle Apple uctu na strance Transakce"
```

---

### Task 5: Rozpad na kartě roční kategorie

**Files:**
- Modify: `client/src/pages/AnnualBudgetsPage.jsx` (stav kolem `:84`, načtení kolem `:102`, karta kolem `:165-200`)

**Interfaces:**
- Consumes: `category_apple_account_year_spent` z `/api/budget-items` (Task 2), filtr `apple_account` (Task 4)

- [ ] **Step 1: Načti data a stav rozkliknutí**

Vedle `subcatYearSpent` (řádek 84) přidej:

```jsx
  const [appleYearSpent, setAppleYearSpent] = useState({}); // category_id → [{apple_account,spent}]
  const [appleExpanded, setAppleExpanded] = useState({});   // category_id → bool
```

A vedle `setSubcatYearSpent(...)` (řádek 102):

```jsx
      setAppleYearSpent(items.category_apple_account_year_spent || {});
```

- [ ] **Step 2: Vykresli rozpad**

Uvnitř karty kategorie, za blok `{isSubOpen && (...)}` (kolem řádku 185-199), přidej:

```jsx
                        {(appleYearSpent[c.id] || []).length > 0 && (() => {
                          const accounts = appleYearSpent[c.id];
                          const isAppleOpen = !!appleExpanded[c.id];
                          // Řádek „bez faktury" se DOPOČÍTÁVÁ jako zbytek do celku kategorie,
                          // ne sčítáním — jinak by rozpad nemusel sednout na číslo nad ním.
                          const matchedSum = accounts.reduce((s, a) => s + a.spent, 0);
                          const rest = Math.round((spent - matchedSum) * 100) / 100;
                          const range = `from=${year}-01-01&to=${year}-12-31`;
                          return (
                            <div>
                              <button
                                type="button"
                                className="report-subcat-toggle"
                                onClick={() => setAppleExpanded(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
                                title={isAppleOpen ? 'Skrýt rozpad podle Apple účtu' : 'Zobrazit rozpad podle Apple účtu'}
                              >
                                {isAppleOpen ? '▾' : '▸'} rozpad podle Apple účtu
                              </button>
                              {isAppleOpen && (
                                <div className="report-subcat-list">
                                  {accounts.map(a => (
                                    <Link
                                      key={a.apple_account}
                                      to={`/transactions?category_id=${c.id}&apple_account=${encodeURIComponent(a.apple_account)}&${range}`}
                                      className="report-subcat-row"
                                      style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                                    >
                                      <span className="report-subcat-name">{a.apple_account}</span>
                                      <span className="report-subcat-spent">{formatCurrency(a.spent)}</span>
                                    </Link>
                                  ))}
                                  {rest > 0 && (
                                    <Link
                                      to={`/transactions?category_id=${c.id}&apple_account=none&${range}`}
                                      className="report-subcat-row"
                                      style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                                    >
                                      <span className="report-subcat-name text-muted">bez faktury</span>
                                      <span className="report-subcat-spent text-muted">{formatCurrency(rest)}</span>
                                    </Link>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
```

Proměnná `spent` je v tom bloku už k dispozici (používá ji řádek s `report-budget-spent`) —
pokud se jmenuje jinak, použij tu skutečnou; je to roční útrata kategorie.

- [ ] **Step 3: Ověř build**

Run: `cd client && npm run build`
Expected: build projde bez chyby

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/AnnualBudgetsPage.jsx
git commit -m "feat(apple): rozpad rocni kategorie podle Apple uctu"
```

---

### Task 6: Doplnění účtu u existujících faktur

**Files:**
- Create: `scripts/migrate-apple-account.cjs`

**Interfaces:**
- Consumes: `parseAppleInvoice` (Task 1), sloupec `apple_receipts.apple_account`

- [ ] **Step 1: Napiš skript**

Vytvoř `scripts/migrate-apple-account.cjs` podle vzoru ostatních migračních skriptů v `scripts/`
(dry-run výchozí, zápis až s `CONFIRM=1`):

```javascript
'use strict';
// Doplní apple_account u faktur uložených PŘED zavedením toho sloupce.
// Přeparsuje uložený raw_text, takže uživatel nemusí nic přeposílat znovu.
// Dry-run je výchozí; zápis až s CONFIRM=1.
//
//   node scripts/migrate-apple-account.cjs                # co by se stalo
//   CONFIRM=1 node scripts/migrate-apple-account.cjs      # zapíše

const path = require('path');
const Database = require('better-sqlite3');
const { parseAppleInvoice } = require(path.join(__dirname, '..', 'src', 'utils', 'appleInvoiceParser'));

const DB_PATH = process.env.DB_PATH;
if (!DB_PATH) {
  console.error('DB_PATH je povinný.');
  process.exit(1);
}
const confirm = process.env.CONFIRM === '1';
const db = new Database(DB_PATH);

const rows = db.prepare(
  'SELECT id, raw_text FROM apple_receipts WHERE apple_account IS NULL AND raw_text IS NOT NULL'
).all();

let found = 0;
const update = db.prepare('UPDATE apple_receipts SET apple_account = ? WHERE id = ?');
for (const row of rows) {
  const parsed = parseAppleInvoice(row.raw_text);
  const account = parsed && parsed.apple_account;
  if (!account) {
    console.log(`  #${row.id}: ucet se nepodarilo vytahnout`);
    continue;
  }
  found++;
  console.log(`  #${row.id}: ${account}`);
  if (confirm) update.run(account, row.id);
}

console.log(`\nKandidatu: ${rows.length}, rozpoznano: ${found}`);
console.log(confirm ? 'ZAPSANO.' : 'DRY-RUN — spust s CONFIRM=1 pro zapis.');
```

- [ ] **Step 2: Ověř na lokální kopii**

Run: `DB_PATH=./data.db node scripts/migrate-apple-account.cjs`
Expected: proběhne bez pádu a vypíše `DRY-RUN`. Když lokální `data.db` neexistuje, vytvoř si
prázdnou přes `DB_PATH=/tmp/apple-mig.db node -e "require('./src/db/schema')" ` — stačí, že
skript nespadne a nic nezapíše.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-apple-account.cjs
git commit -m "chore(apple): skript pro doplneni apple_account u starych faktur"
```

---

## Ruční ověření po nasazení

1. Spusť na produkci nejdřív dry-run: `railway ssh --service app-spendex --environment production` a v něm
   `DB_PATH=/data/data.db node scripts/migrate-apple-account.cjs`.
   **Ostrý běh (`CONFIRM=1`) až po odsouhlasení uživatelem** — je to zápis do produkčních dat.
2. Roční budgety → karta `Y_Licence` → rozklik „rozpad podle Apple účtu" ukáže účty a řádek „bez faktury".
3. Součet účtů + „bez faktury" musí dát přesně částku uvedenou u kategorie.
4. Klik na účet otevře Transakce jen s platbami toho účtu; klik na „bez faktury" ty ostatní.
5. Filtr jde na stránce Transakce zrušit tlačítkem a seznam se rozšíří zpět.
