# Párování Apple faktur — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apple faktura přeposlaná na `inbox@spendex.uk` se spáruje s bankovní transakcí `APPLE.COM/BILL` a doplní jí subkategorii, aby se agregát „Apple" v ročním rozpadu Licencí rozpadl na konkrétní služby.

**Architecture:** Faktury žijí ve vlastní tabulce `apple_receipts` a nikdy nezakládají ani nemění transakce po peněžní stránce — mění jen `subcategory_id` a `note`. Parser čte HTML mailu přes sémantické CSS třídy a textové kotvy (generované `custom-*` hashe jsou nestabilní). Párování je čistá funkce nad kandidáty z DB, spouštěná při příchodu faktury i při importu Apple transakce.

**Tech Stack:** Node.js + Express, better-sqlite3, `mailparser` (už v projektu), `node:test`, React + Vite.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-30-d-apple-faktury-design.md`.
- Migrace se přidávají na konec `initSchema()` v `src/db/schema.js`, žádný framework.
- Každý DB dotaz scopovaný na `req.dataUserId` (household sharing), nikdy `req.user.id`.
- Backend CommonJS, klient ESM. Žádné TypeScript anotace.
- Jazyk UI čeština s diakritikou; commit message bez diakritiky.
- Faktura nikdy nezaloží transakci, nezmění `amount`, `date` ani `category_id`. Mění jen
  `subcategory_id` a `note`.
- Poznámka se rozšiřuje, nikdy nepřepisuje — nový text se připojí jen když tam ještě není.
- Testy pouštěj SYNCHRONNĚ (nikdy na pozadí), vždy s `--test-timeout=20000`:
  - backend: `node --test --test-timeout=20000 'src/**/*.test.js' --test-force-exit` (uvozovky povinné)
  - klient: `node --test --test-timeout=20000 client/src/utils/*.test.js`
  - build: `cd client && npm run build`
  - Timeout nástroje nastav na 300000 ms. Výchozí stav: backend 358/358, klient 68/68.
- Fixture reálné faktury je připravená v `src/utils/__fixtures__/apple-invoice.eml` (anonymizovaná).

---

### Task 1: Parser Apple faktury

**Files:**
- Create: `src/utils/appleInvoiceParser.js`
- Test: `src/utils/appleInvoiceParser.test.js`
- Fixture (už existuje, needituj): `src/utils/__fixtures__/apple-invoice.eml`

**Interfaces:**
- Produces: `parseAppleInvoice(source) → receipt | null`, kde `source` je HTML nebo plain text mailu a `receipt` je
  `{ receipt_date, order_id, total_amount, card_last4, is_refund, items }`.
  `receipt_date` je `YYYY-MM-DD`, `total_amount` vždy kladné číslo, `is_refund` boolean,
  `items` je pole `{ app, description, amount }`. Vrací `null`, když text není Apple faktura
  (chybí částka i order_id).

- [ ] **Step 1: Napiš failing test**

Vytvoř `src/utils/appleInvoiceParser.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');
const { parseAppleInvoice } = require('./appleInvoiceParser');

const FIXTURE = path.join(__dirname, '__fixtures__', 'apple-invoice.eml');

async function fixtureBody() {
  const parsed = await simpleParser(fs.readFileSync(FIXTURE, 'utf8'));
  return parsed.text || parsed.html || '';
}

test('parsuje realnou Apple fakturu z fixture', async () => {
  const r = parseAppleInvoice(await fixtureBody());
  assert.ok(r, 'faktura se ma rozpoznat');
  assert.equal(r.order_id, 'MQ9BQ86WV5');
  assert.equal(r.receipt_date, '2026-06-30');
  assert.equal(r.total_amount, 269);
  assert.equal(r.card_last4, '4225');
  assert.equal(r.is_refund, false);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].app, 'YouTube');
  assert.equal(r.items[0].description, 'YouTube Premium (Monthly)');
  assert.equal(r.items[0].amount, 269);
});

test('CSS ze <style> se nesmi dostat do vysledku', async () => {
  const r = parseAppleInvoice(await fixtureBody());
  assert.ok(!/font-family|margin:/.test(JSON.stringify(r)), 'v datech nesmi byt CSS');
});

test('castka se nespoji s predchozim cislem (2026 + 269,00)', async () => {
  const r = parseAppleInvoice(await fixtureBody());
  assert.equal(r.total_amount, 269, 'nesmi vyjit 2026269');
});

test('dobropis podle klicoveho slova', () => {
  const html = '<html><body><h1>Refund</h1><div class="billing-information">'
    + '<p>5 July 2026</p><p>Order ID:</p><p>ABC123XYZ</p></div>'
    + '<div class="payment-information"><p>Visa •••• 1760</p><p>99,00 CZK</p></div>'
    + '</body></html>';
  const r = parseAppleInvoice(html);
  assert.equal(r.is_refund, true);
  assert.equal(r.total_amount, 99, 'castka je vzdy kladna, smer nese is_refund');
  assert.equal(r.card_last4, '1760');
});

test('faktura bez rozpoznatelnych polozek se presto vrati', () => {
  const html = '<html><body><h1>Invoice</h1><div class="billing-information">'
    + '<p>2 July 2026</p><p>Order ID:</p><p>ZZZ999</p></div>'
    + '<div class="payment-information"><p>MasterCard •••• 4225</p><p>1 234,50 CZK</p></div>'
    + '</body></html>';
  const r = parseAppleInvoice(html);
  assert.equal(r.total_amount, 1234.5, 'tisice s mezerou');
  assert.deepEqual(r.items, []);
});

test('cizi text vrati null', () => {
  assert.equal(parseAppleInvoice('Dobrý den, zůstatek na účtu se snížil o 100 CZK.'), null);
  assert.equal(parseAppleInvoice(''), null);
});

test('vice polozek na jedne fakture', () => {
  const html = '<html><body><h1>Invoice</h1><div class="billing-information"><p>9 July 2026</p>'
    + '<p>Order ID:</p><p>MULTI1</p></div>'
    + '<table class="lockup subscription-lockup__container"><tr class="subscription-lockup">'
    + '<td class="subscription-lockup__content"><p>iCloud</p><p>iCloud+ 50GB<br/></p></td>'
    + '<td class="subscription-lockup__bottom-text__col"><p>25,00&nbsp;CZK<br/></p></td></tr></table>'
    + '<table class="lockup subscription-lockup__container"><tr class="subscription-lockup">'
    + '<td class="subscription-lockup__content"><p>OpenAI</p><p>ChatGPT Plus<br/></p></td>'
    + '<td class="subscription-lockup__bottom-text__col"><p>599,00&nbsp;CZK<br/></p></td></tr></table>'
    + '<div class="payment-information"><p>MasterCard •••• 4225</p><p>624,00 CZK</p></div>'
    + '</body></html>';
  const r = parseAppleInvoice(html);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].app, 'iCloud');
  assert.equal(r.items[1].description, 'ChatGPT Plus');
  assert.equal(r.total_amount, 624);
});
```

- [ ] **Step 2: Spusť test, ověř že padá**

Run: `node --test --test-timeout=20000 src/utils/appleInvoiceParser.test.js`
Expected: FAIL — `Cannot find module './appleInvoiceParser'`

- [ ] **Step 3: Implementuj `src/utils/appleInvoiceParser.js`**

Regexy níž jsou ověřené proti fixture — neměň je bez důvodu.

```javascript
'use strict';

// Parser Apple faktur (a dobropisů) z e-mailu. Vstupem je tělo mailu (HTML nebo text),
// jak ho vrátí `simpleParser` z mailparser.
//
// POZOR na dvě věci, na kterých parser stojí:
// 1. CSS třídy typu `custom-460tp8` jsou generované emotion hashe a mění se mezi verzemi
//    mailu — vážeme se jen na sémantické třídy (billing-information, subscription-lockup,
//    payment-information) a na textové kotvy („Order ID:", „MasterCard •••• ").
// 2. Blok <style> musí ven DŘÍV, než se strhnou tagy — jinak se CSS text promíchá s daty.

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

// Skupiny tisíců oddělené mezerou nebo nedělitelnou mezerou. Úvodní [^\d] brání
// slepení s předchozím číslem („2026" + „269,00" → „2026269,00").
const AMOUNT_RE = /(?:^|[^\d])(\d{1,3}(?:[\s ]\d{3})*,\d{2})\s* ?CZK/g;

function stripToText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/ /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(raw) {
  return parseFloat(String(raw).replace(/[\s ]/g, '').replace(',', '.'));
}

function amountsIn(text) {
  return [...text.matchAll(AMOUNT_RE)].map(m => toNumber(m[1]));
}

function parseDate(text) {
  const m = text.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  return `${m[3]}-${mm}-${String(m[1]).padStart(2, '0')}`;
}

// Položky: každý <tr class="...subscription-lockup..."> je jedna služba.
// Název a popis jsou v buňce `subscription-lockup__content`, cena v
// `subscription-lockup__bottom-text__col`. Řádek „Renews …" se zahazuje.
function parseItems(html) {
  const rows = [...String(html).matchAll(/<tr[^>]*class="[^"]*subscription-lockup[^"]*"[\s\S]*?<\/tr>/gi)];
  const items = [];
  for (const [row] of rows) {
    const contentCell = (row.match(/subscription-lockup__content[\s\S]*?<\/td>/i) || [''])[0];
    const texts = [...contentCell.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(m => stripToText(m[1]))
      .filter(s => s && !/^Renews\b/i.test(s));
    const priceCell = (row.match(/subscription-lockup__bottom-text__col[\s\S]*?<\/td>/i) || [''])[0];
    const priceAmounts = amountsIn(stripToText(priceCell));
    if (!texts.length && !priceAmounts.length) continue;
    items.push({
      app: texts[0] || null,
      description: texts[1] || texts[0] || null,
      amount: priceAmounts.length ? priceAmounts[0] : null,
    });
  }
  return items;
}

// Celková částka je poslední částka v bloku „Billing and Payment" (za mezisoučtem,
// DPH a kartou). Když blok chybí, bereme poslední částku v celém dokumentu.
function parseTotal(html, text) {
  const payBlock = String(html).match(/class="payment-information[\s\S]*/i);
  const inPay = payBlock ? amountsIn(stripToText(payBlock[0])) : [];
  const pool = inPay.length ? inPay : amountsIn(text);
  return pool.length ? pool[pool.length - 1] : null;
}

function parseAppleInvoice(source) {
  const html = String(source || '');
  if (!html.trim()) return null;
  const text = stripToText(html);

  const order = text.match(/Order ID:\s*([A-Z0-9-]+)/i);
  const total = parseTotal(html, text);
  // Bez čísla objednávky i bez částky to není doklad, se kterým umíme pracovat.
  if (!order && total == null) return null;

  const card = text.match(/(?:MasterCard|Visa|American Express|Amex|Maestro)[^0-9]{0,20}(\d{4})/i);

  return {
    receipt_date: parseDate(text),
    order_id: order ? order[1] : null,
    total_amount: total != null ? Math.abs(total) : null,
    card_last4: card ? card[1] : null,
    is_refund: /\brefund\b|\bcredit note\b|\bdobropis\b/i.test(text),
    items: parseItems(html),
  };
}

module.exports = { parseAppleInvoice };
```

- [ ] **Step 4: Spusť test, ověř že prochází**

Run: `node --test --test-timeout=20000 src/utils/appleInvoiceParser.test.js`
Expected: PASS (7 testů)

- [ ] **Step 5: Commit**

```bash
git add src/utils/appleInvoiceParser.js src/utils/appleInvoiceParser.test.js src/utils/__fixtures__/apple-invoice.eml
git commit -m "feat(apple): parser Apple faktur z e-mailu"
```

---

### Task 2: Tabulka apple_receipts

**Files:**
- Modify: `src/db/schema.js` (do pole migrací, k ostatním `CREATE TABLE IF NOT EXISTS`)
- Test: `src/db/schema.test.js`

**Interfaces:**
- Produces: tabulka `apple_receipts` se sloupci `id, user_id, order_id, receipt_date,
  total_amount, is_refund, card_last4, items_json, raw_text, status, transaction_id,
  matched_at, created_at`; unikátní index na `(user_id, order_id)` pro nenulové `order_id`.

- [ ] **Step 1: Napiš failing test**

Do `src/db/schema.test.js` přidej (použij `setup()`/inline tmp-DB vzor, který v souboru už je):

```javascript
test('apple_receipts: tabulka existuje se spravnymi sloupci', () => {
  const { db } = setup();
  const cols = db.prepare('PRAGMA table_info(apple_receipts)').all().map(c => c.name);
  for (const col of ['id','user_id','order_id','receipt_date','total_amount','is_refund',
                     'card_last4','items_json','raw_text','status','transaction_id',
                     'matched_at','created_at']) {
    assert.ok(cols.includes(col), `apple_receipts postrada sloupec ${col}`);
  }
});

test('apple_receipts: order_id je unikatni per uzivatel, NULL se neomezuje', () => {
  const { db } = setup();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@x')").run();
  const ins = db.prepare("INSERT INTO apple_receipts (user_id, order_id, raw_text) VALUES (?,?,'raw')");
  ins.run(1, 'ABC123');
  assert.throws(() => ins.run(1, 'ABC123'), /UNIQUE/i, 'stejne order_id podruhe neprojde');
  ins.run(1, null);
  ins.run(1, null);
  const n = db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n;
  assert.equal(n, 3, 'dva zaznamy bez order_id vedle sebe smi existovat');
});
```

- [ ] **Step 2: Spusť test, ověř že padá**

Run: `node --test --test-timeout=20000 src/db/schema.test.js --test-force-exit`
Expected: FAIL — `apple_receipts postrada sloupec id` (tabulka neexistuje)

- [ ] **Step 3: Přidej migrace do `src/db/schema.js`**

```javascript
    `CREATE TABLE IF NOT EXISTS apple_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      order_id TEXT,
      receipt_date TEXT,
      total_amount REAL,
      is_refund INTEGER NOT NULL DEFAULT 0,
      card_last4 TEXT,
      items_json TEXT,
      raw_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      transaction_id INTEGER,
      matched_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_apple_receipt_order
       ON apple_receipts(user_id, order_id) WHERE order_id IS NOT NULL`,
    'CREATE INDEX IF NOT EXISTS idx_apple_receipt_status ON apple_receipts(user_id, status)',
```

- [ ] **Step 4: Spusť test, ověř že prochází**

Run: `node --test --test-timeout=20000 src/db/schema.test.js --test-force-exit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.js src/db/schema.test.js
git commit -m "feat(apple): tabulka apple_receipts"
```

---

### Task 3: Párovací logika

**Files:**
- Create: `src/utils/appleMatch.js`
- Test: `src/utils/appleMatch.test.js`

**Interfaces:**
- Consumes: tvar `receipt` z Tasku 1.
- Produces:
  - `daysApart(a, b) → number` — absolutní rozdíl dvou `YYYY-MM-DD` ve dnech.
  - `matchesReceipt(tx, receipt, opts) → boolean` — jeden kandidát vs. faktura.
    `tx` je `{ amount, date, card_last4 }`. `opts.windowDays` default 3, `opts.amountTolerance` default 0.5.
  - `pickMatch(txs, receipt, opts) → { status, transaction }` kde `status` je
    `'matched' | 'pending' | 'ambiguous'`; `transaction` je vybraná transakce nebo `null`.

- [ ] **Step 1: Napiš failing test**

Vytvoř `src/utils/appleMatch.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { daysApart, matchesReceipt, pickMatch } = require('./appleMatch');

const INVOICE = { receipt_date: '2026-06-30', total_amount: 269, card_last4: '4225', is_refund: false };
const REFUND  = { receipt_date: '2026-07-05', total_amount: 99,  card_last4: null,   is_refund: true };

test('daysApart pocita rozdil dnu', () => {
  assert.equal(daysApart('2026-06-30', '2026-06-30'), 0);
  assert.equal(daysApart('2026-06-30', '2026-07-03'), 3);
  assert.equal(daysApart('2026-07-03', '2026-06-30'), 3);
});

test('faktura sedne na odchozi platbu stejne castky a data', () => {
  assert.equal(matchesReceipt({ amount: -269, date: '2026-06-30', card_last4: '4225' }, INVOICE), true);
});

test('faktura NEsedne na prichozi platbu (dobropis nema byt nakup)', () => {
  assert.equal(matchesReceipt({ amount: 269, date: '2026-06-30', card_last4: '4225' }, INVOICE), false);
});

test('dobropis sedne jen na prichozi platbu', () => {
  assert.equal(matchesReceipt({ amount: 99, date: '2026-07-05', card_last4: null }, REFUND), true);
  assert.equal(matchesReceipt({ amount: -99, date: '2026-07-05', card_last4: null }, REFUND), false);
});

test('rozdilna karta kandidata vyradi, chybejici karta se ignoruje', () => {
  assert.equal(matchesReceipt({ amount: -269, date: '2026-06-30', card_last4: '1760' }, INVOICE), false);
  assert.equal(matchesReceipt({ amount: -269, date: '2026-06-30', card_last4: null }, INVOICE), true);
  assert.equal(matchesReceipt({ amount: -269, date: '2026-06-30', card_last4: '1760' }, REFUND), false,
    'refund ma jine znamenko, karta uz nerozhoduje');
});

test('okno +-3 dny vcetne hranice', () => {
  assert.equal(matchesReceipt({ amount: -269, date: '2026-07-03', card_last4: null }, INVOICE), true);
  assert.equal(matchesReceipt({ amount: -269, date: '2026-07-04', card_last4: null }, INVOICE), false);
  assert.equal(matchesReceipt({ amount: -269, date: '2026-06-27', card_last4: null }, INVOICE), true);
});

test('tolerance castky 0,5 Kc', () => {
  assert.equal(matchesReceipt({ amount: -269.4, date: '2026-06-30', card_last4: null }, INVOICE), true);
  assert.equal(matchesReceipt({ amount: -270.2, date: '2026-06-30', card_last4: null }, INVOICE), false);
});

test('pickMatch: jeden kandidat = matched', () => {
  const r = pickMatch([{ id: 7, amount: -269, date: '2026-06-30', card_last4: '4225' }], INVOICE);
  assert.equal(r.status, 'matched');
  assert.equal(r.transaction.id, 7);
});

test('pickMatch: zadny kandidat = pending', () => {
  const r = pickMatch([{ id: 7, amount: -100, date: '2026-06-30', card_last4: null }], INVOICE);
  assert.equal(r.status, 'pending');
  assert.equal(r.transaction, null);
});

test('pickMatch: vic kandidatu = ambiguous', () => {
  const r = pickMatch([
    { id: 7, amount: -269, date: '2026-06-30', card_last4: null },
    { id: 8, amount: -269, date: '2026-07-01', card_last4: null },
  ], INVOICE);
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.transaction, null);
});

test('pickMatch: karta rozhodne mezi dvema jinak stejnymi kandidaty', () => {
  const r = pickMatch([
    { id: 7, amount: -269, date: '2026-06-30', card_last4: '1760' },
    { id: 8, amount: -269, date: '2026-07-01', card_last4: '4225' },
  ], INVOICE);
  assert.equal(r.status, 'matched');
  assert.equal(r.transaction.id, 8);
});

test('faktura bez data nebo bez castky se neparuje', () => {
  assert.equal(pickMatch([{ id: 7, amount: -269, date: '2026-06-30' }],
    { receipt_date: null, total_amount: 269, is_refund: false }).status, 'pending');
  assert.equal(pickMatch([{ id: 7, amount: -269, date: '2026-06-30' }],
    { receipt_date: '2026-06-30', total_amount: null, is_refund: false }).status, 'pending');
});
```

- [ ] **Step 2: Spusť test, ověř že padá**

Run: `node --test --test-timeout=20000 src/utils/appleMatch.test.js`
Expected: FAIL — `Cannot find module './appleMatch'`

- [ ] **Step 3: Implementuj `src/utils/appleMatch.js`**

```javascript
'use strict';

// Párování Apple faktury s bankovní transakcí. Čistá logika bez DB, aby šla testovat
// samostatně; kandidáty vybírá volající (viz services/appleReceipts.js).

const DEFAULTS = { windowDays: 3, amountTolerance: 0.5 };

function daysApart(a, b) {
  const ms = Math.abs(new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`));
  return Math.round(ms / 86400000);
}

// Znaménko je součást klíče: nákup a jeho pozdější vrácení mají stejnou částku
// i blízké datum, takže bez něj by dobropis sedl na původní platbu.
function matchesReceipt(tx, receipt, opts = {}) {
  const { windowDays, amountTolerance } = { ...DEFAULTS, ...opts };
  if (!receipt || receipt.total_amount == null || !receipt.receipt_date) return false;
  if (!tx || tx.amount == null || !tx.date) return false;

  const wantsIncoming = !!receipt.is_refund;
  if (wantsIncoming ? !(tx.amount > 0) : !(tx.amount < 0)) return false;

  if (Math.abs(Math.abs(tx.amount) - receipt.total_amount) > amountTolerance) return false;
  if (daysApart(tx.date, receipt.receipt_date) > windowDays) return false;

  // Karta rozhoduje jen když ji mají obě strany — transakce z doby před v2.0.208
  // `card_last4` nemají a přišly by jinak o možnost spárování.
  if (tx.card_last4 && receipt.card_last4 && String(tx.card_last4) !== String(receipt.card_last4)) {
    return false;
  }
  return true;
}

function pickMatch(txs, receipt, opts = {}) {
  const candidates = (txs || []).filter(tx => matchesReceipt(tx, receipt, opts));
  if (candidates.length === 1) return { status: 'matched', transaction: candidates[0] };
  if (candidates.length === 0) return { status: 'pending', transaction: null };

  // Víc kandidátů: shoda na kartě je silnější signál než pouhá částka a datum.
  if (receipt.card_last4) {
    const byCard = candidates.filter(tx => String(tx.card_last4 || '') === String(receipt.card_last4));
    if (byCard.length === 1) return { status: 'matched', transaction: byCard[0] };
  }
  return { status: 'ambiguous', transaction: null };
}

module.exports = { daysApart, matchesReceipt, pickMatch };
```

- [ ] **Step 4: Spusť test, ověř že prochází**

Run: `node --test --test-timeout=20000 src/utils/appleMatch.test.js`
Expected: PASS (12 testů)

- [ ] **Step 5: Commit**

```bash
git add src/utils/appleMatch.js src/utils/appleMatch.test.js
git commit -m "feat(apple): parovaci logika faktury a transakce"
```

---

### Task 4: Služba — uložení faktury a aplikace na transakci

**Files:**
- Create: `src/services/appleReceipts.js`
- Test: `src/services/appleReceipts.test.js`

**Interfaces:**
- Consumes: `parseAppleInvoice` (Task 1), tabulka `apple_receipts` (Task 2), `pickMatch` (Task 3),
  `loadUserRules(db, userId)` z `src/utils/load-user-rules.js` — vrací pole
  `{ pattern, category, subcategory_id? }`.
- Produces:
  - `ingestAppleInvoice(db, userId, rawBody) → { status, receiptId, transactionId }`,
    kde `status` je `'matched' | 'pending' | 'ambiguous' | 'unparsed' | 'duplicate'`.
  - `applyReceiptToTransaction(db, userId, receipt, transactionId) → { subcategory_id, note }`
  - `matchPendingForTransaction(db, userId, transactionId) → number` (počet spárovaných faktur)

- [ ] **Step 1: Napiš failing test**

Vytvoř `src/services/appleReceipts.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path'); const fs = require('fs');
const { simpleParser } = require('mailparser');

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-apple-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./appleReceipts']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (5,1,'Y_Licence',2)").run();
  db.prepare("INSERT INTO subcategories (id, user_id, category_id, name) VALUES (11,1,5,'Apple'),(12,1,5,'ChatGPT')").run();
  const svc = require('./appleReceipts');
  return { db, svc };
}

async function fixtureBody() {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'utils', '__fixtures__', 'apple-invoice.eml'), 'utf8');
  const parsed = await simpleParser(raw);
  return parsed.text || parsed.html || '';
}

test('faktura se spa ruje s odpovidajici transakci', async () => {
  const { db, svc } = setup();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, subcategory_id, amount, date, description)
              VALUES (100,1,5,11,-269,'2026-06-30','APPLE.COM/BILL, CORK')`).run();
  const r = svc.ingestAppleInvoice(db, 1, await fixtureBody());
  assert.equal(r.status, 'matched');
  assert.equal(r.transactionId, 100);
  const row = db.prepare('SELECT * FROM apple_receipts WHERE id = ?').get(r.receiptId);
  assert.equal(row.order_id, 'MQ9BQ86WV5');
  assert.equal(row.status, 'matched');
  assert.equal(row.transaction_id, 100);
  assert.ok(row.matched_at, 'matched_at se vyplni');
});

test('nazev sluzby se dopise do poznamky a nepretemi ji', async () => {
  const { db, svc } = setup();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description, note)
              VALUES (100,1,5,-269,'2026-06-30','APPLE.COM/BILL','puvodni text')`).run();
  svc.ingestAppleInvoice(db, 1, await fixtureBody());
  const tx = db.prepare('SELECT note FROM transactions WHERE id = 100').get();
  assert.ok(tx.note.includes('puvodni text'), 'puvodni poznamka zustava');
  assert.ok(tx.note.includes('YouTube Premium (Monthly)'), 'pribyl nazev sluzby');
});

test('opakovane pripsani poznamky ji nezdvoji', async () => {
  const { db, svc } = setup();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (100,1,5,-269,'2026-06-30','APPLE.COM/BILL')`).run();
  const { parseAppleInvoice } = require('../utils/appleInvoiceParser');
  const receipt = parseAppleInvoice(await fixtureBody());
  svc.applyReceiptToTransaction(db, 1, receipt, 100);
  svc.applyReceiptToTransaction(db, 1, receipt, 100);
  const tx = db.prepare('SELECT note FROM transactions WHERE id = 100').get();
  const occurrences = tx.note.split('YouTube Premium (Monthly)').length - 1;
  assert.equal(occurrences, 1, 'nazev sluzby jen jednou');
});

test('duplicita se pozna i u faktury bez order_id', () => {
  const { db, svc } = setup();
  const html = '<html><body><h1>Invoice</h1><div class="billing-information"><p>2 July 2026</p></div>'
    + '<div class="payment-information"><p>MasterCard •••• 4225</p><p>50,00 CZK</p></div></body></html>';
  const first = svc.ingestAppleInvoice(db, 1, html);
  assert.notEqual(first.status, 'duplicate');
  assert.equal(svc.ingestAppleInvoice(db, 1, html).status, 'duplicate');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 1);
});

test('pravidlo se subkategorii priradi subkategorii, kategorie zustava', async () => {
  const { db, svc } = setup();
  db.prepare("INSERT INTO category_rules (user_id, pattern, category_id, subcategory_id) VALUES (1,'YOUTUBE',5,12)").run();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, subcategory_id, amount, date, description)
              VALUES (100,1,5,11,-269,'2026-06-30','APPLE.COM/BILL')`).run();
  svc.ingestAppleInvoice(db, 1, await fixtureBody());
  const tx = db.prepare('SELECT category_id, subcategory_id FROM transactions WHERE id = 100').get();
  assert.equal(tx.subcategory_id, 12, 'subkategorie z pravidla');
  assert.equal(tx.category_id, 5, 'kategorie se nemeni');
});

test('bez sedici ho pravidla zustane subkategorie beze zmeny', async () => {
  const { db, svc } = setup();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, subcategory_id, amount, date, description)
              VALUES (100,1,5,11,-269,'2026-06-30','APPLE.COM/BILL')`).run();
  svc.ingestAppleInvoice(db, 1, await fixtureBody());
  const tx = db.prepare('SELECT subcategory_id, note FROM transactions WHERE id = 100').get();
  assert.equal(tx.subcategory_id, 11);
  assert.ok(tx.note.includes('YouTube'));
});

test('bez odpovidajici transakce zustane faktura pending', async () => {
  const { db, svc } = setup();
  const r = svc.ingestAppleInvoice(db, 1, await fixtureBody());
  assert.equal(r.status, 'pending');
  assert.equal(db.prepare('SELECT status FROM apple_receipts WHERE id = ?').get(r.receiptId).status, 'pending');
});

test('dve stejne transakce = ambiguous, nic se nemeni', async () => {
  const { db, svc } = setup();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, subcategory_id, amount, date, description)
              VALUES (100,1,5,11,-269,'2026-06-30','APPLE.COM/BILL'),
                     (101,1,5,11,-269,'2026-07-01','APPLE.COM/BILL')`).run();
  const r = svc.ingestAppleInvoice(db, 1, await fixtureBody());
  assert.equal(r.status, 'ambiguous');
  assert.equal(db.prepare('SELECT note FROM transactions WHERE id = 100').get().note ?? '', '');
});

test('duplicitni faktura se stejnym order_id se neulozi dvakrat', async () => {
  const { db, svc } = setup();
  const body = await fixtureBody();
  svc.ingestAppleInvoice(db, 1, body);
  const second = svc.ingestAppleInvoice(db, 1, body);
  assert.equal(second.status, 'duplicate');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 1);
});

test('nerozpoznany mail se ulozi jako unparsed i s raw textem', () => {
  const { db, svc } = setup();
  const r = svc.ingestAppleInvoice(db, 1, 'Dobry den, tohle neni faktura.');
  assert.equal(r.status, 'unparsed');
  const row = db.prepare('SELECT status, raw_text FROM apple_receipts WHERE id = ?').get(r.receiptId);
  assert.equal(row.status, 'unparsed');
  assert.ok(row.raw_text.includes('tohle neni faktura'));
});

test('matchPendingForTransaction spa ruje cekajici fakturu po importu platby', async () => {
  const { db, svc } = setup();
  const r = svc.ingestAppleInvoice(db, 1, await fixtureBody());
  assert.equal(r.status, 'pending');
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (100,1,5,-269,'2026-06-30','APPLE.COM/BILL')`).run();
  const n = svc.matchPendingForTransaction(db, 1, 100);
  assert.equal(n, 1);
  assert.equal(db.prepare('SELECT status FROM apple_receipts WHERE id = ?').get(r.receiptId).status, 'matched');
});

test('cizi uzivatel neni dotcen', async () => {
  const { db, svc } = setup();
  db.prepare("INSERT INTO users (id, email) VALUES (2,'b@x')").run();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (200,2,5,-269,'2026-06-30','APPLE.COM/BILL')`).run();
  const r = svc.ingestAppleInvoice(db, 1, await fixtureBody());
  assert.equal(r.status, 'pending', 'cizi transakce se neparuje');
});
```

- [ ] **Step 2: Spusť test, ověř že padá**

Run: `node --test --test-timeout=20000 src/services/appleReceipts.test.js --test-force-exit`
Expected: FAIL — `Cannot find module './appleReceipts'`

- [ ] **Step 3: Implementuj `src/services/appleReceipts.js`**

```javascript
'use strict';
const { parseAppleInvoice } = require('../utils/appleInvoiceParser');
const { pickMatch } = require('../utils/appleMatch');
const loadUserRules = require('../utils/load-user-rules');

// Kandidáti na spárování: Apple platby uživatele. Okno je širší než párovací
// (±10 dní), vlastní rozhodnutí dělá pickMatch.
function candidateTransactions(db, userId, receipt) {
  if (!receipt.receipt_date) return [];
  return db.prepare(`
    SELECT id, amount, date, card_last4, note, subcategory_id
    FROM transactions
    WHERE user_id = ?
      AND (UPPER(COALESCE(description,'')) LIKE 'APPLE.COM%'
        OR UPPER(COALESCE(place,'')) LIKE 'APPLE.COM%')
      AND date >= date(?, '-10 days') AND date <= date(?, '+10 days')
  `).all(userId, receipt.receipt_date, receipt.receipt_date);
}

// Text, proti kterému se zkoušejí uživatelská pravidla („YouTube YouTube Premium (Monthly)").
function itemText(item) {
  return [item.app, item.description].filter(Boolean).join(' ');
}

function subcategoryForItem(db, userId, item) {
  const text = itemText(item).toUpperCase();
  if (!text) return null;
  for (const rule of loadUserRules(db, userId)) {
    if (rule.subcategory_id == null) continue;
    if (text.includes(String(rule.pattern).toUpperCase())) return rule.subcategory_id;
  }
  return null;
}

// Poznámka se rozšiřuje, nikdy nepřepisuje — a nikdy nezdvojuje už přítomný text.
function appendNote(existing, addition) {
  const base = String(existing || '').trim();
  if (!addition) return base;
  if (base.includes(addition)) return base;
  return base ? `${base} · ${addition}` : addition;
}

function applyReceiptToTransaction(db, userId, receipt, transactionId) {
  const items = receipt.items || [];
  const label = items.length
    ? items.map(i => itemText(i)).filter(Boolean).join(' + ')
    : null;

  const tx = db.prepare('SELECT note, subcategory_id FROM transactions WHERE id = ? AND user_id = ?')
    .get(transactionId, userId);
  if (!tx) return { subcategory_id: null, note: null };

  // Subkategorii měníme jen u jednopoložkové faktury — u víc položek by jedna
  // subkategorie zamlčela zbytek, takže tam zůstane jen rozpis v poznámce.
  let subId = tx.subcategory_id;
  if (items.length === 1) {
    const found = subcategoryForItem(db, userId, items[0]);
    if (found != null) subId = found;
  }

  const note = appendNote(tx.note, label);
  db.prepare('UPDATE transactions SET subcategory_id = ?, note = ? WHERE id = ? AND user_id = ?')
    .run(subId ?? null, note, transactionId, userId);
  return { subcategory_id: subId ?? null, note };
}

function finishMatch(db, userId, receiptId, receipt, transactionId) {
  applyReceiptToTransaction(db, userId, receipt, transactionId);
  db.prepare("UPDATE apple_receipts SET status = 'matched', transaction_id = ?, matched_at = datetime('now') WHERE id = ?")
    .run(transactionId, receiptId);
}

function ingestAppleInvoice(db, userId, rawBody) {
  const receipt = parseAppleInvoice(rawBody);

  if (!receipt) {
    const ins = db.prepare(`INSERT INTO apple_receipts (user_id, raw_text, status) VALUES (?, ?, 'unparsed')`)
      .run(userId, String(rawBody || ''));
    return { status: 'unparsed', receiptId: Number(ins.lastInsertRowid), transactionId: null };
  }

  // Idempotence: primárně přes order_id, u dokladů bez něj přes trojici
  // datum + částka + karta, ať opakované přeposlání nezaloží druhý záznam.
  const existing = receipt.order_id
    ? db.prepare('SELECT id FROM apple_receipts WHERE user_id = ? AND order_id = ?')
        .get(userId, receipt.order_id)
    : db.prepare(`SELECT id FROM apple_receipts
                  WHERE user_id = ? AND order_id IS NULL AND status != 'rejected'
                    AND receipt_date IS ? AND total_amount IS ? AND card_last4 IS ?`)
        .get(userId, receipt.receipt_date, receipt.total_amount, receipt.card_last4);
  if (existing) return { status: 'duplicate', receiptId: existing.id, transactionId: null };

  const { status, transaction } = pickMatch(candidateTransactions(db, userId, receipt), receipt);

  const ins = db.prepare(`
    INSERT INTO apple_receipts
      (user_id, order_id, receipt_date, total_amount, is_refund, card_last4, items_json, raw_text, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, receipt.order_id, receipt.receipt_date, receipt.total_amount,
    receipt.is_refund ? 1 : 0, receipt.card_last4, JSON.stringify(receipt.items || []),
    String(rawBody || ''), status);
  const receiptId = Number(ins.lastInsertRowid);

  if (status === 'matched') finishMatch(db, userId, receiptId, receipt, transaction.id);
  return { status, receiptId, transactionId: status === 'matched' ? transaction.id : null };
}

// Po importu Apple platby zkusí dorovnat faktury, které na ni čekaly.
function matchPendingForTransaction(db, userId, transactionId) {
  const tx = db.prepare('SELECT id, amount, date, card_last4 FROM transactions WHERE id = ? AND user_id = ?')
    .get(transactionId, userId);
  if (!tx) return 0;

  const rows = db.prepare("SELECT * FROM apple_receipts WHERE user_id = ? AND status IN ('pending','ambiguous')")
    .all(userId);
  let matched = 0;
  for (const row of rows) {
    const receipt = {
      receipt_date: row.receipt_date,
      total_amount: row.total_amount,
      card_last4: row.card_last4,
      is_refund: !!row.is_refund,
      items: row.items_json ? JSON.parse(row.items_json) : [],
    };
    const r = pickMatch([tx], receipt);
    if (r.status !== 'matched') continue;
    finishMatch(db, userId, row.id, receipt, tx.id);
    matched++;
  }
  return matched;
}

module.exports = { ingestAppleInvoice, applyReceiptToTransaction, matchPendingForTransaction };
```

- [ ] **Step 4: Spusť test, ověř že prochází**

Run: `node --test --test-timeout=20000 src/services/appleReceipts.test.js --test-force-exit`
Expected: PASS (11 testů)

- [ ] **Step 5: Commit**

```bash
git add src/services/appleReceipts.js src/services/appleReceipts.test.js
git commit -m "feat(apple): sluzba pro ulozeni a parovani faktur"
```

---

### Task 5: Webhook — příjem Apple mailů

**Files:**
- Modify: `src/routes/emailInbound.js:36-58`
- Modify: `infra/cloudflare-email-worker/worker.js:5-13`
- Modify: `infra/cloudflare-email-worker/README.md`
- Test: `src/routes/emailInbound.security.test.js`

**Interfaces:**
- Consumes: `ingestAppleInvoice(db, userId, rawBody)` (Task 4).
- Produces: `POST /api/email/inbound` přijímá vedle AirBank notifikací i Apple faktury.

- [ ] **Step 1: Napiš failing test**

Do `src/routes/emailInbound.security.test.js` přidej (styl a `setup()` opiš ze souboru):

```javascript
test('Apple faktura projde a ulozi se jako apple_receipt', async () => {
  const { db, app, base, server } = await setupInbound();
  const raw = fs.readFileSync(path.join(__dirname, '..', 'utils', '__fixtures__', 'apple-invoice.eml'), 'utf8')
    .replace('user@example.com', process.env.EMAIL_ALLOWED_SENDER);
  const r = await fetch(`${base}/api/email/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET },
    body: JSON.stringify({ from: 'tomas@icloud.com', subject: 'Your invoice from Apple.', raw }),
  });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 1);
  server.close();
});

test('Apple mail bez slova invoice se NEulozi', async () => {
  const { db, base, server } = await setupInbound();
  const raw = `From: Apple <no_reply@email.apple.com>\nSubject: Novinky\n\n${process.env.EMAIL_ALLOWED_SENDER} marketing`;
  const r = await fetch(`${base}/api/email/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET },
    body: JSON.stringify({ from: 'tomas@icloud.com', subject: 'Novinky', raw }),
  });
  assert.equal((await r.json()).status, 'ignored');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 0);
  server.close();
});

test('Apple mail bez povolene adresy v raw se odmitne', async () => {
  const { db, base, server } = await setupInbound();
  const raw = 'From: Apple <no_reply@email.apple.com>\nSubject: Your invoice from Apple.\n\nInvoice 269,00 CZK';
  const r = await fetch(`${base}/api/email/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': process.env.EMAIL_WEBHOOK_SECRET },
    body: JSON.stringify({ from: 'utocnik@example.org', subject: 'Your invoice from Apple.', raw }),
  });
  assert.equal((await r.json()).status, 'ignored');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM apple_receipts').get().n, 0);
  server.close();
});
```

Soubor má dnes jen `freshApp()` bez databáze (stávající testy končí dřív, než se k DB dostane).
Přidej vedle něj `setupInbound()`, který DB založí — `freshApp()` ani stávající AirBank testy
neměň, musí dál procházet:

```javascript
const os = require('os'); const path = require('path'); const fs = require('fs');

async function setupInbound() {
  process.env.EMAIL_WEBHOOK_SECRET = 'sekret';
  process.env.EMAIL_ALLOWED_SENDER = 'tom@example.com';
  process.env.DB_PATH = path.join(os.tmpdir(), `spendex-inb-${Date.now()}-${Math.random()}.db`);
  for (const m of ['../db/connection','../db/schema','./emailInbound','../services/appleReceipts']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* ok */ }
  }
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'tom@example.com')").run();
  const app = express(); app.use(express.json({ limit: '10mb' }));
  app.use('/api/email', require('./emailInbound'));
  const { server, base } = await listen(app);
  return { db, app, base, server };
}
```

- [ ] **Step 2: Spusť test, ověř že padá**

Run: `node --test --test-timeout=20000 src/routes/emailInbound.security.test.js --test-force-exit`
Expected: FAIL — Apple faktura dostane `status: 'ignored'` a `apple_receipts` je prázdná.

- [ ] **Step 3: Rozšiř `src/routes/emailInbound.js`**

Nahraď blok vrstvy 2 (řádky 36-46) tímhle:

```javascript
    // Vrstva 2: whitelist odesílatele — dvě povolené cesty.
    //
    // (a) AirBank notifikace: Gmail forward přes filtr zachovává PŮVODNÍ obálku, takže
    //     From zůstane info@airbank.cz. Navíc ověříme, že e-mail prošel schránkou
    //     povoleného uživatele (jeho adresa zůstane v hlavičkách raw MIME).
    //
    // (b) Apple faktury: uživatel je přeposílá RUČNĚ, takže From je jeho vlastní adresa
    //     a whitelist musí stát na původním Apple odesílateli uvnitř mailu. Vědomý
    //     kompromis: hlavičku uvnitř přeposlaného mailu lze zfalšovat, ale faktura nikdy
    //     nezaloží transakci ani nezmění částku — nejhorší následek je špatná poznámka.
    const allowed = (process.env.EMAIL_ALLOWED_SENDER || '').toLowerCase();
    const fromHdr = String(from).toLowerCase();
    const rawLower = String(raw).toLowerCase();
    if (!allowed || !rawLower.includes(allowed)) {
      return res.status(202).json({ status: 'ignored' });
    }

    const isAirBank = fromHdr.includes('airbank.cz');
    const isApple = rawLower.includes('no_reply@email.apple.com')
      && /invoice|refund|credit/i.test(String(subject || '') + ' ' + rawLower);
    if (!isAirBank && !isApple) {
      return res.status(202).json({ status: 'ignored' });
    }
```

Do destrukturace na řádku 30 doplň `subject`:

```javascript
    const { envelope_from = '', from = '', subject = '', raw = '' } = req.body || {};
```

A za dekódování MIME (za řádek 53) přidej větvení:

```javascript
    if (isApple) {
      const user = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(allowed);
      if (!user) return res.status(202).json({ status: 'ignored' });
      const result = ingestAppleInvoice(db, user.id, text);
      return res.json(result);
    }
```

Import na začátek souboru:

```javascript
const { ingestAppleInvoice } = require('../services/appleReceipts');
```

- [ ] **Step 4: Rozšiř Cloudflare Worker**

V `infra/cloudflare-email-worker/worker.js` nahraď filtr (řádky 8-13):

```javascript
    // Vrstva 2 (brzká): propustit notifikace od AirBank a přeposlané Apple faktury.
    // POZOR: Gmail forward (přes filtr) zachovává PŮVODNÍ obálku — message.from zůstane
    // info@airbank.cz, NE přeposílatel. U ručně přeposlaných Apple faktur je to naopak:
    // From je adresa uživatele, původní Apple odesílatel zůstane až v těle. Server pak
    // v obou případech ověří, že e-mail prošel schránkou povoleného uživatele.
    const rawText = await new Response(message.raw).text();
    const subject = message.headers.get('subject') || '';
    const isAirBank = fromHeader.toLowerCase().includes('airbank.cz');
    const isApple = rawText.toLowerCase().includes('no_reply@email.apple.com')
      && /invoice|refund|credit/i.test(subject + ' ' + rawText);
    if (!isAirBank && !isApple) {
      return; // tiše zahodit (spam / cizí e-maily na inbox@spendex.uk)
    }
```

Níž v souboru pak použij už načtené `rawText` a `subject` místo opakovaného čtení
(`const raw = await new Response(message.raw).text();` a `const subject = …` odstraň, v `body`
posílej `raw: rawText`).

Do `infra/cloudflare-email-worker/README.md` přidej odstavec, že Worker propouští i ručně
přeposlané Apple faktury a že po změně je nutné Worker znovu nasadit přes Cloudflare dashboard
nebo `wrangler deploy` — deploy Workeru **není** součástí Railway pipeline.

- [ ] **Step 5: Spusť testy, ověř že prochází**

Run: `node --test --test-timeout=20000 src/routes/emailInbound.security.test.js --test-force-exit`
Expected: PASS, včetně původních AirBank testů

- [ ] **Step 6: Commit**

```bash
git add src/routes/emailInbound.js src/routes/emailInbound.security.test.js infra/cloudflare-email-worker/
git commit -m "feat(apple): webhook a worker prijmou prepolane Apple faktury"
```

---

### Task 6: Párování při importu Apple platby

**Files:**
- Modify: `src/services/emailIngest.js` (funkce `classifyAndStore`, větev `confident`)
- Test: `src/services/emailIngest.test.js`

**Interfaces:**
- Consumes: `matchPendingForTransaction(db, userId, transactionId)` (Task 4).

- [ ] **Step 1: Napiš failing test**

Do `src/services/emailIngest.test.js` přidej (setup opiš ze souboru):

```javascript
test('import Apple platby spa ruje cekajici fakturu', async () => {
  const { db } = setupIngest();
  db.prepare(`INSERT INTO apple_receipts (user_id, order_id, receipt_date, total_amount, is_refund, card_last4, items_json, raw_text, status)
              VALUES (1,'MQ9BQ86WV5','2026-06-30',269,0,'4225','[{"app":"YouTube","description":"YouTube Premium (Monthly)","amount":269}]','raw','pending')`).run();
  const txId = db.prepare(`INSERT INTO transactions (user_id, category_id, amount, date, description)
                           VALUES (1,5,-269,'2026-06-30','APPLE.COM/BILL')`).run().lastInsertRowid;
  const { matchPendingForTransaction } = require('./appleReceipts');
  assert.equal(matchPendingForTransaction(db, 1, Number(txId)), 1);
  assert.equal(db.prepare("SELECT status FROM apple_receipts WHERE order_id='MQ9BQ86WV5'").get().status, 'matched');
});
```

- [ ] **Step 2: Spusť test, ověř stav**

Run: `node --test --test-timeout=20000 src/services/emailIngest.test.js --test-force-exit`
Expected: test projde už teď (volá přímo službu z Tasku 4) — slouží jako pojistka. Pokud padá,
oprav ho dřív, než budeš pokračovat.

- [ ] **Step 3: Napoj párování na import**

V `src/services/emailIngest.js` v `classifyAndStore` do větve `if (confident)` za získání
`transactionId` přidej:

```javascript
    // Apple platba může mít čekající fakturu — zkusíme ji dorovnat. Best-effort:
    // selhání párování nesmí shodit import platby.
    if (transactionId && /^APPLE\.COM/i.test(String(tx.description || tx.place || ''))) {
      try {
        matchPendingForTransaction(db, userId, transactionId);
      } catch (e) {
        console.error('[apple] parovani po importu:', e && e.message);
      }
    }
```

Import na začátek souboru:

```javascript
const { matchPendingForTransaction } = require('./appleReceipts');
```

- [ ] **Step 4: Spusť celou backendovou sadu**

Run: `node --test --test-timeout=20000 'src/**/*.test.js' --test-force-exit`
Expected: PASS, žádná regrese proti výchozím 358 testům

- [ ] **Step 5: Commit**

```bash
git add src/services/emailIngest.js src/services/emailIngest.test.js
git commit -m "feat(apple): parovani cekajicich faktur pri importu platby"
```

---

### Task 7: API pro faktury

**Files:**
- Create: `src/routes/appleReceipts.js`
- Modify: `src/index.js` (mount za `/api/email-inbox`)
- Test: `src/routes/appleReceipts.test.js`

**Interfaces:**
- Produces:
  - `GET /api/apple-receipts?status=all|pending|matched|ambiguous|unparsed` → `{ receipts: [...] }`,
    každá faktura má sloupce tabulky + `items` (rozparsované pole) + `candidates`
    (pole `{ id, date, amount, description }`) u stavů `pending`/`ambiguous`.
  - `POST /api/apple-receipts/:id/match` `{ transaction_id }` → ruční přiřazení, vrací fakturu.
  - `POST /api/apple-receipts/:id/unmatch` → odpojí od transakce, stav zpět na `pending`.
  - `DELETE /api/apple-receipts/:id` → `status='rejected'`.

- [ ] **Step 1: Napiš failing test**

Vytvoř `src/routes/appleReceipts.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os'); const path = require('path');
const express = require('express');

async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-arec-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./appleReceipts']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@x'),(2,'jiny@x')").run();
  db.prepare("INSERT INTO categories (id, user_id, name, type) VALUES (5,1,'Y_Licence',2)").run();
  db.prepare(`INSERT INTO transactions (id, user_id, category_id, amount, date, description)
              VALUES (100,1,5,-269,'2026-06-30','APPLE.COM/BILL'),(200,2,5,-269,'2026-06-30','APPLE.COM/BILL')`).run();
  db.prepare(`INSERT INTO apple_receipts (id, user_id, order_id, receipt_date, total_amount, card_last4, items_json, raw_text, status)
              VALUES (1,1,'AAA','2026-06-30',269,'4225','[{"app":"YouTube","description":"YouTube Premium","amount":269}]','raw','pending'),
                     (2,2,'BBB','2026-06-30',269,NULL,'[]','raw','pending')`).run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.dataUserId=1; req.isAuthenticated=()=>true; next(); });
  app.use('/api/apple-receipts', require('./appleReceipts'));
  return { db, app };
}

test('GET vraci jen faktury vlastnika a rozparsovane polozky', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const { receipts } = await (await fetch(`${base}/api/apple-receipts?status=all`)).json();
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].order_id, 'AAA');
  assert.equal(receipts[0].items[0].app, 'YouTube');
  server.close();
});

test('GET u pending nabidne kandidaty', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const { receipts } = await (await fetch(`${base}/api/apple-receipts`)).json();
  assert.ok(Array.isArray(receipts[0].candidates));
  assert.equal(receipts[0].candidates[0].id, 100);
  server.close();
});

test('rucni prirazeni spa ruje a doplni poznamku', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  const r = await fetch(`${base}/api/apple-receipts/1/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction_id: 100 }),
  });
  assert.equal(r.status, 200);
  assert.equal(db.prepare('SELECT status, transaction_id FROM apple_receipts WHERE id=1').get().status, 'matched');
  assert.ok(db.prepare('SELECT note FROM transactions WHERE id=100').get().note.includes('YouTube'));
  server.close();
});

test('rucni prirazeni cizi transakce neprojde', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  const r = await fetch(`${base}/api/apple-receipts/1/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction_id: 200 }),
  });
  assert.equal(r.status, 404);
  server.close();
});

test('cizi fakturu nelze precist ani zmenit', async () => {
  const { app } = setup();
  const { server, base } = await listen(app);
  assert.equal((await fetch(`${base}/api/apple-receipts/2/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction_id: 100 }),
  })).status, 404);
  assert.equal((await fetch(`${base}/api/apple-receipts/2`, { method: 'DELETE' })).status, 404);
  server.close();
});

test('unmatch vrati fakturu do pending', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  await fetch(`${base}/api/apple-receipts/1/match`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transaction_id: 100 }),
  });
  const r = await fetch(`${base}/api/apple-receipts/1/unmatch`, { method: 'POST' });
  assert.equal(r.status, 200);
  const row = db.prepare('SELECT status, transaction_id FROM apple_receipts WHERE id=1').get();
  assert.equal(row.status, 'pending');
  assert.equal(row.transaction_id, null);
  server.close();
});

test('DELETE nastavi rejected, zaznam zustava', async () => {
  const { db, app } = setup();
  const { server, base } = await listen(app);
  assert.equal((await fetch(`${base}/api/apple-receipts/1`, { method: 'DELETE' })).status, 200);
  assert.equal(db.prepare('SELECT status FROM apple_receipts WHERE id=1').get().status, 'rejected');
  server.close();
});
```

- [ ] **Step 2: Spusť test, ověř že padá**

Run: `node --test --test-timeout=20000 src/routes/appleReceipts.test.js --test-force-exit`
Expected: FAIL — `Cannot find module './appleReceipts'`

- [ ] **Step 3: Implementuj `src/routes/appleReceipts.js`**

```javascript
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { applyReceiptToTransaction } = require('../services/appleReceipts');
const { matchesReceipt } = require('../utils/appleMatch');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

function toReceipt(row) {
  return {
    receipt_date: row.receipt_date,
    total_amount: row.total_amount,
    card_last4: row.card_last4,
    is_refund: !!row.is_refund,
    items: row.items_json ? JSON.parse(row.items_json) : [],
  };
}

// Kandidáti k ručnímu výběru: Apple platby v širším okně, seřazené podle data.
function candidatesFor(userId, row) {
  if (!row.receipt_date) return [];
  const rows = db.prepare(`
    SELECT id, date, amount, description, card_last4
    FROM transactions
    WHERE user_id = ?
      AND (UPPER(COALESCE(description,'')) LIKE 'APPLE.COM%'
        OR UPPER(COALESCE(place,'')) LIKE 'APPLE.COM%')
      AND date >= date(?, '-10 days') AND date <= date(?, '+10 days')
    ORDER BY date DESC, id DESC
  `).all(userId, row.receipt_date, row.receipt_date);
  const receipt = toReceipt(row);
  // Nejdřív ti, co splňují párovací pravidla, pak zbytek jako záloha pro ruční volbu.
  const fits = rows.filter(t => matchesReceipt(t, receipt));
  const rest = rows.filter(t => !fits.includes(t));
  return [...fits, ...rest].slice(0, 10);
}

// GET /api/apple-receipts?status=…
router.get('/', requireAuth, (req, res) => {
  const status = req.query.status || 'all';
  const params = [req.dataUserId];
  let where = 'user_id = ?';
  if (status !== 'all') { where += ' AND status = ?'; params.push(status); }

  const rows = db.prepare(`SELECT * FROM apple_receipts WHERE ${where} ORDER BY receipt_date DESC, id DESC`)
    .all(...params);

  res.json({
    receipts: rows.map(row => ({
      ...row,
      items: row.items_json ? JSON.parse(row.items_json) : [],
      candidates: (row.status === 'pending' || row.status === 'ambiguous')
        ? candidatesFor(req.dataUserId, row) : [],
    })),
  });
});

// POST /api/apple-receipts/:id/match — ruční přiřazení k transakci
router.post('/:id/match', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM apple_receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Faktura nenalezena.' });

  const tx = db.prepare('SELECT id FROM transactions WHERE id = ? AND user_id = ?')
    .get(req.body.transaction_id, req.dataUserId);
  if (!tx) return res.status(404).json({ error: 'Transakce nenalezena.' });

  applyReceiptToTransaction(db, req.dataUserId, toReceipt(row), tx.id);
  db.prepare("UPDATE apple_receipts SET status = 'matched', transaction_id = ?, matched_at = datetime('now') WHERE id = ?")
    .run(tx.id, row.id);

  res.json(db.prepare('SELECT * FROM apple_receipts WHERE id = ?').get(row.id));
});

// POST /api/apple-receipts/:id/unmatch — odpojení (poznámka u transakce zůstává)
router.post('/:id/unmatch', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM apple_receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Faktura nenalezena.' });
  db.prepare("UPDATE apple_receipts SET status = 'pending', transaction_id = NULL, matched_at = NULL WHERE id = ?")
    .run(row.id);
  res.json(db.prepare('SELECT * FROM apple_receipts WHERE id = ?').get(row.id));
});

// DELETE /api/apple-receipts/:id — zahození (záznam zůstává kvůli idempotenci)
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT id FROM apple_receipts WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Faktura nenalezena.' });
  db.prepare("UPDATE apple_receipts SET status = 'rejected' WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 4: Mountni router**

V `src/index.js` za `app.use('/api/email-inbox', …)` přidej:

```javascript
app.use('/api/apple-receipts', require('./routes/appleReceipts'));
```

- [ ] **Step 5: Spusť testy, ověř že prochází**

Run: `node --test --test-timeout=20000 src/routes/appleReceipts.test.js --test-force-exit`
Expected: PASS (7 testů)

- [ ] **Step 6: Commit**

```bash
git add src/routes/appleReceipts.js src/routes/appleReceipts.test.js src/index.js
git commit -m "feat(apple): API pro spravu faktur"
```

---

### Task 8: Sekce Apple faktury na stránce Import

**Files:**
- Modify: `client/src/pages/ImportPage.jsx` (sekce „Z e-mailu", kolem `:303` a `:405`)
- Modify: `client/src/App.css` (nové třídy na konec)

**Interfaces:**
- Consumes: `GET /api/apple-receipts`, `POST /api/apple-receipts/:id/match`,
  `POST /api/apple-receipts/:id/unmatch`, `DELETE /api/apple-receipts/:id` (Task 7).

- [ ] **Step 1: Načti faktury na stránce**

V `client/src/pages/ImportPage.jsx` přidej stav vedle ostatních:

```jsx
  const [appleReceipts, setAppleReceipts] = useState([]);
```

a funkci pro načtení (volej ji tam, kde se načítá `email-inbox`, i po každé mutaci):

```jsx
  function loadAppleReceipts() {
    return fetch('/api/apple-receipts?status=all')
      .then(r => r.json())
      .then(d => setAppleReceipts(d.receipts || []))
      .catch(() => setAppleReceipts([]));
  }
```

- [ ] **Step 2: Přidej akce**

```jsx
  async function matchReceipt(receiptId, transactionId) {
    const r = await fetch(`/api/apple-receipts/${receiptId}/match`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transaction_id: transactionId }),
    });
    if (!r.ok) { alert((await r.json().catch(() => ({}))).error || 'Přiřazení se nezdařilo.'); return; }
    loadAppleReceipts();
  }

  async function unmatchReceipt(receiptId) {
    await fetch(`/api/apple-receipts/${receiptId}/unmatch`, { method: 'POST' });
    loadAppleReceipts();
  }

  async function rejectReceipt(receiptId) {
    if (!confirm('Zahodit tuhle fakturu?')) return;
    await fetch(`/api/apple-receipts/${receiptId}`, { method: 'DELETE' });
    loadAppleReceipts();
  }
```

- [ ] **Step 3: Vykresli sekci**

Za blok „Nerozpoznané" (kolem `:405`) přidej:

```jsx
      {appleReceipts.filter(r => r.status !== 'rejected').length > 0 && (
        <div className="card">
          <h3 className="section-title">
            <Inbox size={14} /> Apple faktury ({appleReceipts.filter(r => r.status !== 'rejected').length})
          </h3>
          <div className="apple-receipt-list">
            {appleReceipts.filter(r => r.status !== 'rejected').map(r => (
              <div key={r.id} className="apple-receipt">
                <div className="apple-receipt-head">
                  <span>
                    {r.receipt_date || 'bez data'}
                    {r.is_refund ? ' · dobropis' : ''}
                    {r.total_amount != null && ` · ${formatCurrency(r.total_amount)}`}
                    {r.card_last4 && ` · karta ${r.card_last4}`}
                  </span>
                  <span className={`apple-receipt-status apple-receipt-status--${r.status}`}>
                    {r.status === 'matched' ? 'spárováno'
                      : r.status === 'pending' ? 'čeká na platbu'
                      : r.status === 'ambiguous' ? 'nejednoznačné'
                      : 'nerozpoznáno'}
                  </span>
                </div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  {(r.items || []).map(i => [i.app, i.description].filter(Boolean).join(' — ')).join(' + ')
                    || 'bez rozpoznaných položek'}
                </div>
                {(r.status === 'pending' || r.status === 'ambiguous') && (
                  <div className="apple-receipt-candidates">
                    {(r.candidates || []).length === 0
                      ? <span className="text-muted">Žádná odpovídající platba.</span>
                      : (r.candidates || []).map(c => (
                        <button key={c.id} className="btn btn-ghost btn-sm"
                          onClick={() => matchReceipt(r.id, c.id)}>
                          {c.date} · {formatCurrency(Math.abs(c.amount))}
                        </button>
                      ))}
                  </div>
                )}
                <div className="apple-receipt-actions">
                  {r.status === 'matched' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => unmatchReceipt(r.id)}>Odpojit</button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => rejectReceipt(r.id)}>Zahodit</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
```

Pokud `formatCurrency` nebo `Inbox` nejsou v souboru importované, doplň je (`formatCurrency`
z `../i18n`, `Inbox` z `lucide-react`).

- [ ] **Step 4: Přidej styly do `client/src/App.css`**

```css
/* ── Apple faktury na stránce Import ─────────────────────────────────────── */
.apple-receipt-list { display: flex; flex-direction: column; gap: 10px; }
.apple-receipt { border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; }
.apple-receipt-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
.apple-receipt-status { font-size: 12px; }
.apple-receipt-status--matched { color: var(--success, #22c55e); }
.apple-receipt-status--ambiguous { color: #f59e0b; }
.apple-receipt-candidates { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.apple-receipt-actions { display: flex; gap: 6px; margin-top: 8px; }
```

Pokud proměnná `--success` v projektu neexistuje, použij konkrétní barvu jako v okolním CSS.

- [ ] **Step 5: Ověř build**

Run: `cd client && npm run build`
Expected: build projde bez chyby

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/ImportPage.jsx client/src/App.css
git commit -m "feat(apple): sekce Apple faktury na strance Import"
```

---

## Ruční ověření po nasazení

1. Nasaď Cloudflare Worker (`wrangler deploy` nebo dashboard) — **není součástí Railway pipeline**.
2. Přepošli Apple fakturu na `inbox@spendex.uk`.
3. Import → sekce „Apple faktury": faktura je vidět se stavem, položkou a částkou.
4. U spárované faktury zkontroluj transakci v Transakcích — poznámka obsahuje název služby,
   částka a kategorie jsou beze změny.
5. Přepošli tutéž fakturu podruhé — nesmí vzniknout druhý záznam.
6. Přepošli Apple marketingový mail (bez „invoice") — nesmí se objevit nikde.
