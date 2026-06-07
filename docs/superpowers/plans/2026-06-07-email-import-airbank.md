# Import transakcí z e-mailových notifikací AirBank — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transakce se do Spendexu dostávají automaticky z notifikačních e-mailů AirBank (přeposlaných z Gmailu přes Cloudflare Email Worker na webhook), jako rychlejší alternativa k CSV importu.

**Architecture:** Cloudflare Email Worker přepošle raw MIME e-mail na `POST /api/email/inbound`. Server ověří secret + whitelist odesílatele, dekóduje MIME na plain text (`mailparser`), naparsuje notifikaci (`emailParser.js`), postaví `external_id` shodně s CSV importem (`externalId.js`) a hybrid routingem rozhodne: jistá kategorie → rovnou do `transactions`; „Ostatní"/nerozpoznáno → do review fronty `email_inbox`. Frontová sekce na `ImportPage.jsx` umožní jedním klikem zařadit pending položky.

**Tech Stack:** Node.js + Express, better-sqlite3, `mailparser` (nová dep), node:test, React + Vite, Cloudflare Email Workers.

**Spec:** `docs/superpowers/specs/2026-06-07-email-import-airbank-design.md`

---

## File Structure

| Soubor | Odpovědnost | Akce |
|--------|-------------|------|
| `src/db/schema.js` | tabulka `email_inbox` + index | Modify |
| `src/utils/emailParser.js` | parsování těla notifikace (sada matcherů) → struktura tx | Create |
| `src/utils/emailParser.test.js` | testy parseru (fixture e-maily) | Create |
| `src/services/emailIngest.js` | čistá routing logika: parsed tx → transactions / email_inbox | Create |
| `src/services/emailIngest.test.js` | testy routingu (temp DB) | Create |
| `src/routes/emailInbound.js` | webhook: secret + whitelist + MIME decode → ingest | Create |
| `src/routes/emailInbox.js` | UI API: list / approve / delete pending položek | Create |
| `src/index.js` | mount nových routerů | Modify |
| `client/src/pages/ImportPage.jsx` | sekce „Z e-mailu" (pending + unparsed) | Modify |
| `infra/cloudflare-email-worker/worker.js` | Email Worker: whitelist + forward raw na webhook | Create |
| `infra/cloudflare-email-worker/README.md` | návod k nasazení Workeru + env | Create |
| `.env.example` | nové env proměnné | Modify (nebo Create) |

**Statusy `email_inbox.status`:** `pending` | `unparsed` | `imported` | `rejected`
**Statusy vracené z `ingestEmail()`:** `imported` | `pending` | `unparsed` | `duplicate` | `ignored`
**`source` u e-mailových transakcí:** `'airbank-email'`

---

## Task 1: DB tabulka `email_inbox`

**Files:**
- Modify: `src/db/schema.js` (hlavní `db.exec` blok, k ostatním `CREATE TABLE`)
- Test: `src/db/schema.email-inbox.test.js` (Create)

- [ ] **Step 1: Napiš failing test**

Create `src/db/schema.email-inbox.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-einbox-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}

test('email_inbox tabulka existuje a má očekávané sloupce', () => {
  const { db, tmp } = freshDb();
  const cols = db.prepare("PRAGMA table_info(email_inbox)").all().map(c => c.name);
  db.close();
  try { fs.unlinkSync(tmp); } catch { /* ok */ }
  for (const c of ['id', 'user_id', 'received_at', 'raw_text', 'parsed_json',
                   'external_id', 'suggested_category_id', 'status', 'created_at']) {
    assert.ok(cols.includes(c), `chybí sloupec ${c}`);
  }
});
```

- [ ] **Step 2: Spusť test — musí selhat**

Run: `node --test src/db/schema.email-inbox.test.js`
Expected: FAIL (tabulka `email_inbox` neexistuje → `cols` prázdné).

- [ ] **Step 3: Přidej tabulku do schema.js**

V `src/db/schema.js`, do hlavního `db.exec(\`...\`)` bloku přidej za poslední `CREATE TABLE` (před uzavírací `);` execu, vedle `csv_archive`):

```sql
    CREATE TABLE IF NOT EXISTS email_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      received_at TEXT,
      raw_text TEXT,
      parsed_json TEXT,
      external_id TEXT,
      suggested_category_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (suggested_category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_email_inbox_user ON email_inbox(user_id, status);
```

- [ ] **Step 4: Spusť test — musí projít**

Run: `node --test src/db/schema.email-inbox.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.js src/db/schema.email-inbox.test.js
git commit -m "feat(email-import): tabulka email_inbox pro review frontu"
```

---

## Task 2: Parser notifikačního e-mailu

Vrací stejnou strukturu jako `csvParser.js` + navíc `source_account` (číslo zdrojového účtu pro `external_id` a párování účtu). Při nerozpoznání vrací `null` → webhook to uloží jako `unparsed`.

**Files:**
- Create: `src/utils/emailParser.js`
- Test: `src/utils/emailParser.test.js`

- [ ] **Step 1: Napiš failing test**

Create `src/utils/emailParser.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEmailNotification } = require('./emailParser');

// Reálný vzorek: odchozí převod (BOM/zero-width znak za kódem schválně ponechán)
const OUTGOING = `Dobrý den,

zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 10,00 CZK. Dostupný zůstatek k 07.06.2026 v 17:47 je 4 934,46 CZK.

Pro úplnost uvádíme detaily této úhrady:

Odchozí úhrada na účet Tomáš Střída číslo 1679014138/3030
Částka: 10,00 CZK
Datum zaúčtování: 07.06.2026
Zpráva pro plátce: test 10 Kč
Kód transakce: 160610143222﻿

Vaše Air Bank`;

test('odchozí převod: vytáhne všechna pole', () => {
  const tx = parseEmailNotification(OUTGOING);
  assert.equal(tx.external_id, '160610143222');
  assert.equal(tx.amount, -10);
  assert.equal(tx.direction, 'Odchozí');
  assert.equal(tx.currency, 'CZK');
  assert.equal(tx.source_account, '1679014023');
  assert.equal(tx.counterparty_account, '1679014138/3030');
  assert.equal(tx.description, 'Tomáš Střída');
  assert.equal(tx.note, 'test 10 Kč');
  assert.equal(tx.date, '2026-06-07');
  assert.equal(tx.tx_time, '17:47');
  assert.equal(tx.ab_category, '');
});

test('příchozí úhrada: kladná částka, směr Příchozí', () => {
  const incoming = `zůstatek na účtu Hlavní číslo 1679014138/3030 se zvýšil o částku 250,00 CZK. Dostupný zůstatek k 08.06.2026 v 09:12 je 5 000,00 CZK.

Příchozí úhrada od Jan Novák číslo 9876543210/0800
Datum zaúčtování: 08.06.2026
Zpráva pro příjemce: vraceni
Kód transakce: 160610999000`;
  const tx = parseEmailNotification(incoming);
  assert.equal(tx.amount, 250);
  assert.equal(tx.direction, 'Příchozí');
  assert.equal(tx.source_account, '1679014138');
  assert.equal(tx.description, 'Jan Novák');
  assert.equal(tx.note, 'vraceni');
});

test('bez kódu transakce → null (unparsed)', () => {
  assert.equal(parseEmailNotification('nějaký marketingový e-mail bez transakce'), null);
});

test('bez částky → null', () => {
  assert.equal(parseEmailNotification('Kód transakce: 123\nžádná částka tu není'), null);
});
```

- [ ] **Step 2: Spusť test — musí selhat**

Run: `node --test src/utils/emailParser.test.js`
Expected: FAIL ("Cannot find module './emailParser'").

- [ ] **Step 3: Implementuj parser**

Create `src/utils/emailParser.js`:

```js
'use strict';
/**
 * Parser notifikačních e-mailů AirBank (plain text, už dekódovaný z MIME).
 * Vrací stejnou strukturu transakce jako csvParser.js + navíc `source_account`
 * (číslo zdrojového účtu, bez /kódbanky) pro stavbu external_id a párování účtu.
 * Při nerozpoznání (chybí kód transakce nebo částka) vrací null → webhook uloží
 * položku jako 'unparsed' (žádná tichá ztráta dat).
 */

function parseAmount(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseCzDate(str) {
  // "07.06.2026" → "2026-06-07"
  const m = str && String(str).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function parseEmailNotification(text) {
  if (!text) return null;
  // nbsp (U+00A0) → obyčejná mezera, ať \s a literály mezer v regexech spolehlivě sedí
  const body = String(text).replace(/\u00a0/g, ' ');

  // Kód transakce — povinné (= AirBank referenční číslo, shodné s CSV)
  const codeM = body.match(/Kód transakce:\s*(\d+)/i);
  if (!codeM) return null;
  const external_id = codeM[1];

  // Hlavička: "se snížil/zvýšil o částku 10,00 CZK"
  const headM = body.match(/se\s+(snížil|zvýšil)\s+o\s+částku\s+([\d\s.,]+?)\s*(CZK|EUR|USD)/i);
  if (!headM) return null;
  const absAmount = parseAmount(headM[2]);
  if (absAmount === null) return null;
  const sign = /snížil/i.test(headM[1]) ? -1 : 1;
  const amount = sign * Math.abs(absAmount);
  const currency = headM[3].toUpperCase();
  const direction = sign < 0 ? 'Odchozí' : 'Příchozí';

  // Zdrojový účet z hlavičky: "na účtu Společný číslo 1679014023/3030 se snížil"
  const srcM = body.match(/na účtu\s+.*?číslo\s*(\d+)\/\d+\s+se\s+(?:snížil|zvýšil)/i);
  const source_account = srcM ? srcM[1] : null;

  // Protistrana + protiúčet: "úhrada na účet/od <jméno> číslo <num>/<bank>"
  let description = '';
  let counterparty_account = null;
  const cpM = body.match(/úhrada\s+(?:na účet|od)\s+(.+?)\s+číslo\s*(\d+\/\d+)/i);
  if (cpM) {
    description = cpM[1].trim();
    counterparty_account = cpM[2];
  }

  // Zpráva pro plátce/příjemce → note
  const msgM = body.match(/Zpráva pro (?:plátce|příjemce):\s*(.+)/i);
  const note = msgM ? msgM[1].trim() : '';

  // Datum: primárně "Datum zaúčtování", fallback z hlavičky "k 07.06.2026 v ..."
  const date =
    parseCzDate((body.match(/Datum zaúčtování:\s*([\d.]+)/i) || [])[1]) ||
    parseCzDate((body.match(/k\s+([\d.]+)\s+v\s+\d{2}:\d{2}/i) || [])[1]);

  // Čas: "v 17:47"
  const timeM = body.match(/\bv\s+(\d{2}:\d{2})\b/);
  const tx_time = timeM ? timeM[1] : null;

  return {
    date,
    amount,
    currency,
    description,
    note,
    ab_category: '',          // v e-mailu není → L2 kategorizace odpadá
    direction,
    external_id,
    tx_time,
    tx_type: null,
    counterparty_account,
    entered_by: null,
    place: null,
    source_account,
  };
}

module.exports = { parseEmailNotification, parseAmount, parseCzDate };
```

- [ ] **Step 4: Spusť test — musí projít**

Run: `node --test src/utils/emailParser.test.js`
Expected: PASS (4 testy).

- [ ] **Step 5: Commit**

```bash
git add src/utils/emailParser.js src/utils/emailParser.test.js
git commit -m "feat(email-import): parser notifikačních e-mailů AirBank"
```

---

## Task 3: Routing logika (ingestEmail)

Čistá funkce, kterou volá webhook. Dělá: parse → external_id → dedup → kategorizace → INSERT do `transactions` (jistá kategorie) nebo `email_inbox` (fallback / nerozpoznáno). Testovatelná s temp DB (vzor z `income.test.js`).

**Files:**
- Create: `src/services/emailIngest.js`
- Test: `src/services/emailIngest.test.js`

- [ ] **Step 1: Napiš failing test**

Create `src/services/emailIngest.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-ingest-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  delete require.cache[require.resolve('./emailIngest')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + s); } catch { /* ok */ } }
}
function seed(db) {
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'tom@example.com')").run();
  // kategorie potřebné pro jisté zařazení
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (5, 1, 'Převody')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (6, 1, 'Ostatní')").run();
  // zdrojový účet
  db.prepare("INSERT INTO accounts (id, user_id, name, account_number, role) VALUES (10, 1, 'Společný', '1679014023', 'spending')").run();
}

const INTERNAL = `zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 10,00 CZK. Dostupný zůstatek k 07.06.2026 v 17:47 je 4 934,46 CZK.
Odchozí úhrada na účet Tomáš Střída číslo 1679014138/3030
Datum zaúčtování: 07.06.2026
Kód transakce: 160610143222`;

test('interní převod (protiúčet = vlastní) → rovnou do transactions jako Převody', () => {
  const { db, tmp } = freshDb();
  seed(db);
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', fromHeader: 'info@airbank.cz', text: INTERNAL });
  const tx = db.prepare("SELECT * FROM transactions WHERE user_id = 1").get();
  const inbox = db.prepare("SELECT COUNT(*) c FROM email_inbox").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'imported');
  assert.equal(tx.category_id, 5);            // Převody (L0 — protiúčet 1679014138 ∈ ownAccountNumbers)
  assert.equal(tx.amount, -10);
  assert.equal(tx.external_id, '160610143222-1679014023');
  assert.equal(tx.source, 'airbank-email');
  assert.equal(tx.account_id, 10);
  assert.equal(inbox.c, 0);
});

test('neznámý obchodník bez pravidla → pending do email_inbox', () => {
  const { db, tmp } = freshDb();
  seed(db);
  const text = `zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 349,00 CZK. Dostupný zůstatek k 07.06.2026 v 12:00 je 100,00 CZK.
Odchozí úhrada na účet NĚJAKÝ ESHOP s.r.o. číslo 2222222222/0800
Datum zaúčtování: 07.06.2026
Kód transakce: 160610777111`;
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', fromHeader: 'info@airbank.cz', text });
  const inbox = db.prepare("SELECT * FROM email_inbox WHERE user_id = 1").get();
  const txCount = db.prepare("SELECT COUNT(*) c FROM transactions").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'pending');
  assert.equal(txCount.c, 0);
  assert.equal(inbox.status, 'pending');
  assert.equal(inbox.external_id, '160610777111-1679014023');
  assert.equal(inbox.suggested_category_id, 6); // Ostatní
  assert.ok(inbox.parsed_json.includes('349'));
});

test('nerozpoznaný e-mail → unparsed s raw textem', () => {
  const { db, tmp } = freshDb();
  seed(db);
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', fromHeader: 'info@airbank.cz', text: 'marketingový newsletter' });
  const inbox = db.prepare("SELECT * FROM email_inbox WHERE user_id = 1").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'unparsed');
  assert.equal(inbox.status, 'unparsed');
  assert.equal(inbox.parsed_json, null);
  assert.equal(inbox.raw_text, 'marketingový newsletter');
});

test('duplicita: stejná tx už v transactions → status duplicate, nevloží se', () => {
  const { db, tmp } = freshDb();
  seed(db);
  db.prepare("INSERT INTO transactions (user_id, amount, date, external_id) VALUES (1, -10, '2026-06-07', '160610143222-1679014023')").run();
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', fromHeader: 'info@airbank.cz', text: INTERNAL });
  const cnt = db.prepare("SELECT COUNT(*) c FROM transactions").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'duplicate');
  assert.equal(cnt.c, 1);
});

test('neznámý odesílatel / mimo whitelist → ignored, nic se neuloží', () => {
  const { db, tmp } = freshDb();
  seed(db);
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'nikdo@jiny.cz', fromHeader: 'info@airbank.cz', text: INTERNAL });
  const cnt = db.prepare("SELECT COUNT(*) c FROM transactions").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'ignored'); // uživatel s tímto e-mailem v DB neexistuje
  assert.equal(cnt.c, 0);
});
```

- [ ] **Step 2: Spusť test — musí selhat**

Run: `node --test src/services/emailIngest.test.js`
Expected: FAIL ("Cannot find module './emailIngest'").

- [ ] **Step 3: Implementuj ingestEmail**

Create `src/services/emailIngest.js`:

```js
'use strict';
const { parseEmailNotification } = require('../utils/emailParser');
const { buildExternalId } = require('../utils/externalId');
const applyRules = require('../utils/apply-rules');
const seedRules = require('../../scripts/seed/rules');

/**
 * Zpracuje jeden notifikační e-mail. Čistá vůči HTTP — dostává už dekódovaný text.
 * @param {import('better-sqlite3').Database} db
 * @param {{userEmail: string, fromHeader: string, text: string}} input
 * @returns {{status: 'imported'|'pending'|'unparsed'|'duplicate'|'ignored', external_id?: string}}
 */
function ingestEmail(db, { userEmail, text }) {
  // Whitelist je vrstva 2: e-mail musí patřit existujícímu uživateli (dle login e-mailu).
  const user = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(userEmail || '');
  if (!user) return { status: 'ignored' };
  const userId = user.id;

  const tx = parseEmailNotification(text);

  // Nerozpoznáno → unparsed, ulož raw (žádná ztráta dat)
  if (!tx) {
    db.prepare(`INSERT INTO email_inbox (user_id, received_at, raw_text, parsed_json, external_id, suggested_category_id, status)
                VALUES (?, datetime('now'), ?, NULL, NULL, NULL, 'unparsed')`).run(userId, text || '');
    return { status: 'unparsed' };
  }

  // Párování zdrojového účtu (číslo bez /kódbanky)
  const account = tx.source_account
    ? db.prepare('SELECT id, account_number FROM accounts WHERE user_id = ? AND account_number = ?')
        .get(userId, tx.source_account)
    : null;

  const extId = buildExternalId(tx.external_id, tx.source_account);

  // Dedup proti transactions i čekajícím pending položkám
  if (extId) {
    const inTx = db.prepare('SELECT 1 FROM transactions WHERE user_id = ? AND external_id = ?').get(userId, extId);
    if (inTx) return { status: 'duplicate', external_id: extId };
    const inPending = db.prepare("SELECT 1 FROM email_inbox WHERE user_id = ? AND external_id = ? AND status = 'pending'").get(userId, extId);
    if (inPending) return { status: 'duplicate', external_id: extId };
  }

  // Kategorizace: applyRules vrací jméno (L0>L3>L1>L2>fallback). ab_category z e-mailu
  // chybí, takže L2 nikdy nezabere. seedRules bez user-override (e-mail nemá UI mapping).
  const catName = applyRules(tx, account ? { account_number: account.account_number } : null, seedRules);
  const catIdByName = Object.fromEntries(
    db.prepare('SELECT id, name FROM categories WHERE user_id = ?').all(userId).map(r => [r.name, r.id])
  );
  const categoryId = catIdByName[catName] || null;
  const confident = catName !== seedRules.fallbackCategory && categoryId != null;

  if (confident) {
    db.prepare(`INSERT OR IGNORE INTO transactions
        (user_id, category_id, amount, currency, date, description, note, source, external_id,
         tx_time, tx_type, counterparty_account, entered_by, place, account_id, ab_category)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank-email', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, categoryId, tx.amount, tx.currency, tx.date, tx.description, tx.note || '',
           extId || null, tx.tx_time || null, tx.tx_type || null,
           tx.counterparty_account || null, tx.entered_by || null, tx.place || null,
           account ? account.id : null, tx.ab_category || null);
    return { status: 'imported', external_id: extId };
  }

  // fallback / kategorie chybí → review fronta
  db.prepare(`INSERT INTO email_inbox (user_id, received_at, raw_text, parsed_json, external_id, suggested_category_id, status)
              VALUES (?, datetime('now'), ?, ?, ?, ?, 'pending')`)
    .run(userId, text || '', JSON.stringify({ ...tx, account_id: account ? account.id : null }),
         extId || null, categoryId);
  return { status: 'pending', external_id: extId };
}

module.exports = { ingestEmail };
```

- [ ] **Step 4: Spusť test — musí projít**

Run: `node --test src/services/emailIngest.test.js`
Expected: PASS (5 testů).

- [ ] **Step 5: Commit**

```bash
git add src/services/emailIngest.js src/services/emailIngest.test.js
git commit -m "feat(email-import): routing logika ingestEmail (hybrid: tx vs review fronta)"
```

---

## Task 4: Webhook endpoint + MIME decode

**Files:**
- Create: `src/routes/emailInbound.js`
- Modify: `src/index.js` (mount + nainstalovat `mailparser`)

- [ ] **Step 1: Nainstaluj mailparser**

Run: `npm install mailparser`
Expected: přidá `mailparser` do `dependencies` v `package.json`.

- [ ] **Step 2: Napiš webhook router**

Create `src/routes/emailInbound.js`:

```js
'use strict';
const express = require('express');
const router = express.Router();
const { simpleParser } = require('mailparser');
const db = require('../db/connection');
const { ingestEmail } = require('../services/emailIngest');

// Vrstva 1: sdílený secret (query ?secret= nebo hlavička x-webhook-secret).
function checkSecret(req, res, next) {
  const expected = process.env.EMAIL_WEBHOOK_SECRET;
  const got = req.query.secret || req.get('x-webhook-secret');
  if (!expected || got !== expected) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// POST /api/email/inbound
// Body (JSON od Cloudflare Workeru): { envelope_from, from, subject, raw }
router.post('/inbound', checkSecret, async (req, res) => {
  try {
    const { envelope_from = '', from = '', raw = '' } = req.body || {};

    // Vrstva 2: whitelist odesílatele.
    const allowed = (process.env.EMAIL_ALLOWED_SENDER || '').toLowerCase();
    const env = String(envelope_from).toLowerCase();
    const fromHdr = String(from).toLowerCase();
    // envelope sender musí být povolená adresa A původní From musí být z airbank.cz
    if (!allowed || env !== allowed || !fromHdr.includes('airbank.cz')) {
      return res.status(202).json({ status: 'ignored' });
    }

    // Dekóduj MIME → plain text (vrstva 3 strukturální validace je v parseru)
    let text = '';
    if (raw) {
      const parsed = await simpleParser(raw);
      text = parsed.text || parsed.html || '';
    }

    const result = ingestEmail(db, { userEmail: allowed, fromHeader: fromHdr, text });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 3: Mount router v index.js**

V `src/index.js` přidej k ostatním API routes (za `app.use('/api/import', ...)`):

```js
app.use('/api/email', require('./routes/emailInbound'));
```

- [ ] **Step 4: Smoke test webhooku**

Run (server běží přes `npm run dev` v jiném terminálu; bez secretu musí odmítnout):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/email/inbound \
  -H 'Content-Type: application/json' -d '{"raw":"x"}'
```

Expected: `401` (chybí secret).

Pak se správným secretem, ale cizím odesílatelem (nastav `EMAIL_WEBHOOK_SECRET=testsecret` v `.env`, restartuj):

```bash
curl -s -X POST 'http://localhost:3000/api/email/inbound?secret=testsecret' \
  -H 'Content-Type: application/json' \
  -d '{"envelope_from":"cizi@nikdo.cz","from":"info@airbank.cz","raw":"x"}'
```

Expected: `{"status":"ignored"}`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/emailInbound.js src/index.js package.json package-lock.json
git commit -m "feat(email-import): webhook /api/email/inbound (secret + whitelist + MIME decode)"
```

---

## Task 5: UI API pro review frontu

**Files:**
- Create: `src/routes/emailInbox.js`
- Modify: `src/index.js` (mount)

- [ ] **Step 1: Napiš router**

Create `src/routes/emailInbox.js`:

```js
'use strict';
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// GET /api/email-inbox — čekající (pending) i nerozpoznané (unparsed) položky
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.received_at, i.raw_text, i.parsed_json, i.external_id,
           i.suggested_category_id, i.status, i.created_at,
           c.name AS suggested_category_name, c.color AS suggested_category_color
    FROM email_inbox i
    LEFT JOIN categories c ON c.id = i.suggested_category_id
    WHERE i.user_id = ? AND i.status IN ('pending', 'unparsed')
    ORDER BY i.created_at DESC, i.id DESC
  `).all(req.user.id);
  res.json(rows);
});

// POST /api/email-inbox/:id/approve { category_id } — zařadí pending položku do transactions
router.post('/:id/approve', requireAuth, writeLimiter, (req, res) => {
  const { category_id = null } = req.body || {};
  const row = db.prepare("SELECT * FROM email_inbox WHERE id = ? AND user_id = ? AND status = 'pending'")
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Položka nenalezena.' });
  if (!row.parsed_json) return res.status(400).json({ error: 'Položku nelze zařadit (nerozpoznaná).' });

  const tx = JSON.parse(row.parsed_json);
  // category_id z UI má přednost; jinak navržená kategorie
  let categoryId = category_id ? parseInt(category_id) : row.suggested_category_id;
  if (categoryId) {
    const ok = db.prepare('SELECT 1 FROM categories WHERE id = ? AND user_id = ?').get(categoryId, req.user.id);
    if (!ok) return res.status(400).json({ error: 'Neplatná kategorie.' });
  }

  const result = db.transaction(() => {
    const r = db.prepare(`INSERT OR IGNORE INTO transactions
        (user_id, category_id, amount, currency, date, description, note, source, external_id,
         tx_time, tx_type, counterparty_account, entered_by, place, account_id, ab_category)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank-email', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, categoryId || null, tx.amount, tx.currency, tx.date, tx.description,
           tx.note || '', row.external_id || null, tx.tx_time || null, tx.tx_type || null,
           tx.counterparty_account || null, tx.entered_by || null, tx.place || null,
           tx.account_id || null, tx.ab_category || null);
    db.prepare("UPDATE email_inbox SET status = 'imported' WHERE id = ?").run(row.id);
    return r;
  })();

  res.json({ ok: true, imported: result.changes > 0 });
});

// DELETE /api/email-inbox/:id — zahodí položku (pending i unparsed)
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT id FROM email_inbox WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Položka nenalezena.' });
  db.prepare("UPDATE email_inbox SET status = 'rejected' WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 2: Mount router v index.js**

V `src/index.js` za `app.use('/api/email', ...)`:

```js
app.use('/api/email-inbox', require('./routes/emailInbox'));
```

- [ ] **Step 3: Smoke test (vyžaduje přihlášení) — ověř jen že endpoint existuje a chrání se**

Run:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/email-inbox
```

Expected: `401` (requireAuth — nepřihlášen).

- [ ] **Step 4: Commit**

```bash
git add src/routes/emailInbox.js src/index.js
git commit -m "feat(email-import): API review fronty (list/approve/delete)"
```

---

## Task 6: Frontend — sekce „Z e-mailu" na ImportPage

Sekce nad CSV uploadem: pending položky (1 klik zařadit) + unparsed (raw text). Drží se stylu stávajícího archivu (tabulka, `card`, `formatCurrency`).

**Files:**
- Modify: `client/src/pages/ImportPage.jsx`

- [ ] **Step 1: Přidej import ikon**

V `client/src/pages/ImportPage.jsx` uprav řádek 2 (přidej `Inbox`, `Mail`):

```js
import { Upload, Check, AlertCircle, Plus, Pencil, Trash2, X, Download, Inbox, Mail } from 'lucide-react';
```

- [ ] **Step 2: Přidej komponentu EmailInbox na konec souboru (před `export default` hlavní komponenty není potřeba — definuj nad ní)**

Vlož před hlavní `export default function ImportPage()` tuto komponentu:

```jsx
function EmailInbox() {
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    const [ri, rc] = await Promise.all([
      fetch('/api/email-inbox'),
      fetch('/api/categories'),
    ]);
    if (ri.ok) setItems(await ri.json());
    if (rc.ok) setCats(await rc.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  async function approve(item, categoryId) {
    setBusy(item.id);
    try {
      const r = await fetch(`/api/email-inbox/${item.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: categoryId || null }),
      });
      if (r.ok) await load();
    } finally { setBusy(null); }
  }

  async function remove(item) {
    setBusy(item.id);
    try {
      const r = await fetch(`/api/email-inbox/${item.id}`, { method: 'DELETE' });
      if (r.ok) await load();
    } finally { setBusy(null); }
  }

  const pending = items.filter(i => i.status === 'pending');
  const unparsed = items.filter(i => i.status === 'unparsed');

  if (items.length === 0) return null;

  return (
    <section style={{ marginBottom: 24 }}>
      <h2 className="page-title" style={{ fontSize: 18, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Mail size={18} /> Z e-mailu
        <span className="badge" style={{ background: 'var(--primary)', color: '#fff', borderRadius: 10, padding: '2px 8px', fontSize: 12 }}>
          {items.length}
        </span>
      </h2>

      {pending.map(item => {
        const tx = item.parsed_json ? JSON.parse(item.parsed_json) : {};
        return (
          <div key={item.id} className="card" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tx.description || '—'}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>{tx.date} {tx.tx_time || ''}</div>
            </div>
            <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatCurrency(tx.amount)}</div>
            <select
              defaultValue={item.suggested_category_id || ''}
              id={`cat-${item.id}`}
              style={{ flex: '0 1 180px' }}
            >
              <option value="">— kategorie —</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" disabled={busy === item.id}
              onClick={() => approve(item, document.getElementById(`cat-${item.id}`).value)}>
              <Check size={14} /> Zařadit
            </button>
            <button className="btn btn-ghost btn-icon" disabled={busy === item.id}
              onClick={() => remove(item)} title="Smazat">
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}

      {unparsed.length > 0 && (
        <div className="card" style={{ marginTop: 8 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Inbox size={14} /> Nerozpoznané ({unparsed.length})
          </h3>
          {unparsed.map(item => (
            <details key={item.id} style={{ marginBottom: 6 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                {item.created_at}
                <button className="btn btn-ghost btn-icon" style={{ marginLeft: 8 }}
                  disabled={busy === item.id} onClick={() => remove(item)} title="Smazat">
                  <Trash2 size={14} />
                </button>
              </summary>
              <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', background: 'var(--bg2)', padding: 8, borderRadius: 6 }}>
                {item.raw_text}
              </pre>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Vlož `<EmailInbox />` do renderu hlavní komponenty**

V hlavní `return (...)` komponenty `ImportPage` (kolem řádku 362) vlož `<EmailInbox />` hned za otevírací `<Layout ...>` (nad krokový import), aby fronta byla nahoře:

```jsx
    <Layout>
      <EmailInbox />
      {/* ...stávající obsah (kroky importu)... */}
```

- [ ] **Step 4: Build ověř**

Run: `cd client && npm run build`
Expected: build projde bez chyb.

- [ ] **Step 5: Vizuální kontrola**

Spusť `npm run dev` + `npm run dev:client`, přihlas se, otevři Import. Bez položek se sekce nezobrazí (vrací `null`). Vlož ručně testovací pending řádek do DB pro ověření vzhledu:

```bash
sqlite3 data.db "INSERT INTO email_inbox (user_id, received_at, raw_text, parsed_json, external_id, suggested_category_id, status) VALUES (1, datetime('now'), 'raw', '{\"description\":\"Test obchod\",\"amount\":-349,\"date\":\"2026-06-07\",\"tx_time\":\"12:00\"}', 'X-1', NULL, 'pending');"
```

Expected: na Import stránce nahoře sekce „Z e-mailu" s řádkem Test obchod / -349 Kč / dropdown / Zařadit. Po zařazení zmizí a objeví se v transakcích.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/ImportPage.jsx
git commit -m "feat(email-import): sekce Z e-mailu na ImportPage (pending + nerozpoznané)"
```

---

## Task 7: Cloudflare Email Worker

Worker je ~30 řádků bez závislostí — editovatelný přímo v Cloudflare dashboardu. Ověří envelope sender (vrstva 2, brzké zahození) a přepošle raw MIME na webhook se secretem (vrstva 1).

**Files:**
- Create: `infra/cloudflare-email-worker/worker.js`
- Create: `infra/cloudflare-email-worker/README.md`

- [ ] **Step 1: Napiš Worker**

Create `infra/cloudflare-email-worker/worker.js`:

```js
// Cloudflare Email Worker — příjem AirBank notifikací a forward na Spendex webhook.
// Konfigurace přes Worker Variables/Secrets: WEBHOOK_URL, WEBHOOK_SECRET, ALLOWED_SENDER.
export default {
  async email(message, env) {
    const allowed = (env.ALLOWED_SENDER || '').toLowerCase();
    const envelopeFrom = (message.from || '').toLowerCase();

    // Vrstva 2 (brzká): zahoď cokoli, co nepřišlo z povolené (přeposílací) adresy.
    if (!allowed || envelopeFrom !== allowed) {
      return; // tiše zahodit
    }

    const raw = await new Response(message.raw).text();
    const fromHeader = message.headers.get('from') || '';
    const subject = message.headers.get('subject') || '';

    await fetch(env.WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': env.WEBHOOK_SECRET,
      },
      body: JSON.stringify({ envelope_from: message.from, from: fromHeader, subject, raw }),
    });
  },
};
```

- [ ] **Step 2: Napiš README s návodem**

Create `infra/cloudflare-email-worker/README.md`:

```markdown
# Cloudflare Email Worker — Spendex e-mailový import

Přeposílá notifikační e-maily AirBank z Gmailu na Spendex webhook.

## Tok

AirBank → Gmail (auto-forward) → `inbox@spendex.uk` (MX na Cloudflare)
→ tento Email Worker → `POST https://<spendex>/api/email/inbound`

## Nastavení

1. **Doména na Cloudflare:** přidej `spendex.uk` do Cloudflare (nameservery na CF).
2. **Email Routing:** Dashboard → Email → Email Routing → zapni. Ověř doménu
   (Cloudflare přidá MX + TXT záznamy automaticky).
3. **Destination address / catch-all:** vytvoř adresu `inbox@spendex.uk`.
4. **Worker:** Dashboard → Workers & Pages → Create → vlož `worker.js`.
   - Žádný build, žádné npm — čistý ES modul.
5. **Worker Variables & Secrets** (Settings → Variables):
   - `WEBHOOK_URL` = `https://<spendex-railway-domain>/api/email/inbound`
   - `WEBHOOK_SECRET` = stejná hodnota jako `EMAIL_WEBHOOK_SECRET` na Railway
   - `ALLOWED_SENDER` = tvoje Gmail adresa (envelope sender přeposílaných e-mailů)
6. **Routing rule:** Email Routing → Routes → `inbox@spendex.uk` → *Send to a Worker* → tento Worker.
7. **Gmail:** Nastavení → Přeposílání → přidej `inbox@spendex.uk`, potvrď, a
   filtrem „od info@airbank.cz → přeposlat na inbox@spendex.uk".

## Bezpečnostní vrstvy

1. `WEBHOOK_SECRET` — server odmítne POST bez správného secretu (HTTP 401).
2. `ALLOWED_SENDER` — Worker i server ověří envelope sender; server navíc
   vyžaduje `From` z `airbank.cz`.
3. Strukturální validace — server uloží jen e-maily s rozpoznatelnou transakcí;
   ostatní jako `unparsed` do review fronty.
```

- [ ] **Step 3: Commit**

```bash
git add infra/cloudflare-email-worker/
git commit -m "feat(email-import): Cloudflare Email Worker + návod k nasazení"
```

---

## Task 8: Env proměnné a dokumentace

**Files:**
- Modify/Create: `.env.example`

- [ ] **Step 1: Zjisti, zda `.env.example` existuje**

Run: `ls -la .env.example 2>/dev/null && cat .env.example 2>/dev/null || echo "NEEXISTUJE"`

- [ ] **Step 2: Přidej nové proměnné**

Pokud `.env.example` existuje, přidej na konec; jinak ho vytvoř s těmito řádky (a zkopíruj i ostatní existující proměnné z `.env`, pokud nějaké jsou — bez hodnot):

```
# E-mailový import (Cloudflare Email Worker → webhook)
EMAIL_WEBHOOK_SECRET=zmen-na-nahodny-dlouhy-retezec
EMAIL_ALLOWED_SENDER=tvuj-gmail@gmail.com
```

- [ ] **Step 3: Ověř, že `.env` je v `.gitignore`**

Run: `grep -q '^\.env$' .gitignore && echo OK || echo CHYBI`
Expected: `OK`. Pokud `CHYBI`, přidej `.env` do `.gitignore`.

- [ ] **Step 4: Nastav reálné hodnoty do `.env` (lokálně) a na Railway (produkce)**

Lokálně do `.env`:
```
EMAIL_WEBHOOK_SECRET=<vygeneruj: openssl rand -hex 24>
EMAIL_ALLOWED_SENDER=<tvuj gmail>
```
Na Railway: Variables → přidej `EMAIL_WEBHOOK_SECRET` a `EMAIL_ALLOWED_SENDER` (stejný secret jako ve Workeru).

- [ ] **Step 5: Commit**

```bash
git add .env.example .gitignore
git commit -m "docs(email-import): env proměnné pro e-mailový webhook"
```

---

## Závěrečné ověření

- [ ] **Spusť celou test suite**

Run: `node --test src/utils/emailParser.test.js src/services/emailIngest.test.js src/db/schema.email-inbox.test.js`
Expected: vše PASS.

- [ ] **End-to-end (po nasazení Workeru):** pošli z Gmailu testovací AirBank notifikaci (nebo přepošli reálnou) → ověř, že se objeví buď v transakcích (jistá kategorie), nebo v sekci „Z e-mailu" na Import stránce.

- [ ] **Deploy:** commit + push do `staging` (Railway nasadí), nastav Railway env proměnné, nasaď Worker. Po ověření na stagingu případně merge do `main` na pokyn uživatele.

---

## Poznámky k rozsahu

- **MVP** pokrývá formát převodu (odchozí + příchozí). Karetní platby u obchodníka,
  výběry z bankomatu a poplatky mají jiný text → zatím spadnou do `unparsed`
  (neztratí se). Po nasbírání reálných vzorků se do `emailParser.js` přidají další
  matchery (rozšíření pole regexů + odpovídající testy).
- **Dedup napříč CSV i e-mailem** funguje díky shodnému `external_id`
  (`<Kód transakce>-<číslo zdrojového účtu>`). Předpoklad: v CSV importu uživatel
  vybere tentýž zdrojový účet, jaký e-mail uvádí explicitně.
- **Multi-user:** vše se přiřazuje uživateli, jehož login e-mail = `EMAIL_ALLOWED_SENDER`.
  Druhý partner = samostatná adresa/Worker proměnná v budoucnu (mimo rozsah).
```
