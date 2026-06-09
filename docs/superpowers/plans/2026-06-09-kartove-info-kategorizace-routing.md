# Kartové info → kategorizace + routing notifikací — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Z AirBank notifikací o platbě kartou vytáhnout místo (→ lepší kategorizace) a číslo karty (→ push jen tomu, kdo platil); neznámá karta drží transakci, dokud ji člen domácnosti nepřiřadí.

**Architecture:** Parser plní `place` + `card_last4`. `apply-rules` přidá `place` do textových pravidel. Nová tabulka `cards` mapuje `last4 → člen domácnosti`. `emailIngest` routuje push na vlastníka karty; neznámá/nepřiřazená karta → stav `awaiting_card` (transakce se nezaloží). Přiřazení karty v Nastavení uvolní zadržené platby. Transakce se vždy ukládají pod data ownera — mění se jen cíl notifikace.

**Tech Stack:** Node.js + Express, better-sqlite3, React + Vite, `node:test`.

---

## File Structure

- `src/utils/emailParser.js` — rozšířit o kartové platby (place, card_last4, tx_type, Datum provedení).
- `src/utils/apply-rules.js` — přidat `place` do `hay`.
- `src/db/schema.js` — nová tabulka `cards`.
- `src/services/emailIngest.js` — refactor (`categorize`, `classifyAndStore`), card routing, `awaiting_card` hold, solo auto-assign, `releaseHeldCard`, `notifyUserId`.
- `src/services/pushNotify.js` — `notifyForResult` cílí na `result.notifyUserId`.
- `src/routes/household.js` — `GET/PATCH /cards`, helper `householdPeople`.
- `client/src/pages/SettingsPage.jsx` + `client/src/i18n.js` — blok Karty.
- Testy: `emailParser.test.js`, `apply-rules.test.js`, `emailIngest.test.js`, `household.test.js`.

---

## Task 1: Parser — kartové platby

**Files:**
- Modify: `src/utils/emailParser.js`
- Test: `src/utils/emailParser.test.js`

- [ ] **Step 1: Napiš failing test**

Přidej do `src/utils/emailParser.test.js`:

```js
test('platba kartou: vytáhne místo, poslední 4 karty, typ a datum provedení', () => {
  const CARD = `Dobrý den,

zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 482,00 CZK. Dostupný zůstatek k 08.06.2026 v 21:15 je 3 678,16 CZK.

Pro úplnost uvádíme detaily této úhrady:

Platba kartou (nezaúčtováno) v HAMR - BRANIK,RESTAURA, PRAHA 4, 000
Částka: 482,00 CZK
Karta: 516844******6062
Datum provedení: 08.06.2026
Kód transakce: 26918903543`;
  const tx = parseEmailNotification(CARD);
  assert.equal(tx.external_id, '26918903543');
  assert.equal(tx.amount, -482);
  assert.equal(tx.direction, 'Odchozí');
  assert.equal(tx.place, 'HAMR - BRANIK,RESTAURA, PRAHA 4');
  assert.equal(tx.card_last4, '6062');
  assert.equal(tx.tx_type, 'Platba kartou');
  assert.equal(tx.date, '2026-06-08');
  assert.equal(tx.source_account, '1679014023');
  assert.equal(tx.counterparty_account, null);
});

test('převod nemá kartu ani místo', () => {
  const tx = parseEmailNotification(OUTGOING);
  assert.equal(tx.place, null);
  assert.equal(tx.card_last4, null);
});
```

- [ ] **Step 2: Spusť test — musí selhat**

Run: `node --test src/utils/emailParser.test.js`
Expected: FAIL (`tx.place` je `null`, `tx.card_last4` undefined).

- [ ] **Step 3: Implementuj**

V `src/utils/emailParser.js`, za blok protistrany (po řádku `counterparty_account = cpM[2];` / uzávěrce `if (cpM) {...}`, cca ř. 59) přidej kartové parsování:

```js
  // Platba kartou: "Platba kartou (nezaúčtováno) v <MÍSTO>" → place (ořež koncový terminálový kód ", 000")
  let place = null;
  let card_last4 = null;
  let tx_type = null;
  const cardLineM = body.match(/Platba kartou(?:\s*\([^)]*\))?\s+v\s+(.+)/i);
  if (cardLineM) {
    place = cardLineM[1].trim().replace(/,\s*\d{1,3}\s*$/, '').trim();
    tx_type = 'Platba kartou';
  }
  const cardNumM = body.match(/Karta:\s*([\d*]+)/i);
  if (cardNumM) {
    const digits = cardNumM[1].replace(/[^\d]/g, '');
    if (digits.length >= 4) card_last4 = digits.slice(-4);
  }
```

Pak do `date` fallback řetězce přidej `Datum provedení` (uprav stávající přiřazení `const date = ...`):

```js
  const date =
    parseCzDate((body.match(/Datum zaú[cč]tování:\s*([\d.]+)/i) || [])[1]) ||
    parseCzDate((body.match(/Datum provedení:\s*([\d.]+)/i) || [])[1]) ||
    parseCzDate((body.match(/k\s+([\d.]+)\s+v\s+\d{2}:\d{2}/i) || [])[1]);
```

A v `return {...}` nahraď `place: null` a `tx_type: null` reálnými hodnotami a přidej `card_last4`:

```js
    ab_category: '',
    direction,
    external_id,
    tx_time,
    tx_type,
    counterparty_account,
    entered_by: null,
    place,
    card_last4,
    source_account,
```

- [ ] **Step 4: Spusť test — musí projít**

Run: `node --test src/utils/emailParser.test.js`
Expected: PASS (všechny, vč. stávajících převodů).

- [ ] **Step 5: Commit**

```bash
git add src/utils/emailParser.js src/utils/emailParser.test.js
git commit -m "feat(email): parser kartových plateb (place, card_last4, tx_type, Datum provedení)"
```

---

## Task 2: apply-rules — místo do textových pravidel

**Files:**
- Modify: `src/utils/apply-rules.js:20`
- Test: `src/utils/apply-rules.test.js`

- [ ] **Step 1: Napiš failing test**

Přidej do `src/utils/apply-rules.test.js`:

```js
test('L3 textové pravidlo matchne podle place i při prázdném description', () => {
  const rules = {
    ownAccountNumbers: [], internalTransferCategory: 'Převody',
    textOverrides: [{ pattern: 'HAMR', category: 'Restaurace' }],
    accountRules: {}, abCategoryMap: {}, fallbackCategory: 'Ostatní',
  };
  const tx = { description: '', note: '', place: 'HAMR - BRANIK,RESTAURA, PRAHA 4', amount: -482, counterparty_account: null };
  assert.equal(applyRules(tx, null, rules), 'Restaurace');
});
```

(Pokud test soubor importuje `applyRules` jinak, zachovej stávající import — funkce je default export `require('./apply-rules')`.)

- [ ] **Step 2: Spusť test — musí selhat**

Run: `node --test src/utils/apply-rules.test.js`
Expected: FAIL (vrátí `Ostatní`, protože `place` se nematchuje).

- [ ] **Step 3: Implementuj**

V `src/utils/apply-rules.js` uprav řádek 20:

```js
  const hay = `${tx.description || ''} ${tx.note || ''} ${tx.place || ''}`.toLowerCase();
```

- [ ] **Step 4: Spusť test — musí projít**

Run: `node --test src/utils/apply-rules.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/apply-rules.js src/utils/apply-rules.test.js
git commit -m "feat(rules): místo (place) vstupuje do textových kategorizačních pravidel"
```

---

## Task 3: Schema — tabulka `cards`

**Files:**
- Modify: `src/db/schema.js` (uvnitř `db.exec(...)`, před uzávěrkou na ř. ~246)

- [ ] **Step 1: Implementuj**

V `src/db/schema.js` přidej do `db.exec(\`...\`)` bloku za `CREATE TABLE ... household_invites (...)`:

```sql
    CREATE TABLE IF NOT EXISTS cards (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      data_owner_id    INTEGER NOT NULL,
      last4            TEXT NOT NULL,
      assigned_user_id INTEGER,
      label            TEXT,
      created_at       TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (data_owner_id)    REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE(data_owner_id, last4)
    );

    CREATE INDEX IF NOT EXISTS idx_cards_owner ON cards(data_owner_id);
```

- [ ] **Step 2: Ověř, že schema projde**

Run: `node -e "process.env.DB_PATH=require('os').tmpdir()+'/spx-cards-'+Date.now()+'.db'; require('./src/db/schema').initSchema(); const db=require('./src/db/connection'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name='cards'\").get());"`
Expected: vypíše `{ name: 'cards' }`.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.js
git commit -m "feat(cards): tabulka cards (mapování karty na člena domácnosti)"
```

---

## Task 4: emailIngest — routing, hold, refactor

**Files:**
- Modify: `src/services/emailIngest.js`
- Test: `src/services/emailIngest.test.js`

- [ ] **Step 1: Napiš failing testy**

Přidej do `src/services/emailIngest.test.js`. Nejdřív rozšiř `seed` o restauraci-pravidlo přes kategorii a o druhého uživatele/member:

```js
const CARD_TX = `zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 482,00 CZK. Dostupný zůstatek k 08.06.2026 v 21:15 je 3 678,16 CZK.
Platba kartou (nezaúčtováno) v HAMR - BRANIK,RESTAURA, PRAHA 4, 000
Karta: 516844******6062
Datum provedení: 08.06.2026
Kód transakce: 26918903543`;

test('neznámá karta v domácnosti se členem → awaiting_card, žádná transakce, karta nepřiřazená, bez notify', () => {
  const { db, tmp } = freshDb();
  seed(db);
  db.prepare("INSERT INTO users (id, email) VALUES (2, 'martin@example.com')").run();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', text: CARD_TX });
  const txCount = db.prepare("SELECT COUNT(*) c FROM transactions").get();
  const inbox = db.prepare("SELECT * FROM email_inbox WHERE user_id = 1").get();
  const card = db.prepare("SELECT * FROM cards WHERE data_owner_id = 1 AND last4 = '6062'").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'awaiting_card');
  assert.equal(txCount.c, 0);
  assert.equal(inbox.status, 'awaiting_card');
  assert.ok(inbox.parsed_json.includes('6062'));
  assert.equal(card.assigned_user_id, null);
  assert.equal(r.notify, undefined);
});

test('přiřazená karta člena → import + notifyUserId = člen', () => {
  const { db, tmp } = freshDb();
  seed(db);
  db.prepare("INSERT INTO users (id, email) VALUES (2, 'martin@example.com')").run();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (7, 1, 'Restaurace')").run();
  db.prepare("INSERT INTO cards (data_owner_id, last4, assigned_user_id) VALUES (1, '6062', 2)").run();
  const seedRules = require('../../scripts/seed/rules');
  seedRules.textOverrides.push({ pattern: 'HAMR', category: 'Restaurace' });
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', text: CARD_TX });
  seedRules.textOverrides.pop();
  const tx = db.prepare("SELECT * FROM transactions WHERE user_id = 1").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'imported');
  assert.equal(r.notifyUserId, 2);
  assert.equal(tx.category_id, 7);
  assert.equal(tx.place, 'HAMR - BRANIK,RESTAURA, PRAHA 4');
});

test('solo uživatel (bez členů) → karta auto-přiřazená vlastníkovi, import, notify vlastník', () => {
  const { db, tmp } = freshDb();
  seed(db);
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (7, 1, 'Restaurace')").run();
  const seedRules = require('../../scripts/seed/rules');
  seedRules.textOverrides.push({ pattern: 'HAMR', category: 'Restaurace' });
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', text: CARD_TX });
  seedRules.textOverrides.pop();
  const card = db.prepare("SELECT * FROM cards WHERE data_owner_id = 1 AND last4 = '6062'").get();
  cleanup(db, tmp);
  assert.equal(r.status, 'imported');
  assert.equal(r.notifyUserId, 1);
  assert.equal(card.assigned_user_id, 1);
});
```

- [ ] **Step 2: Spusť testy — musí selhat**

Run: `node --test src/services/emailIngest.test.js`
Expected: FAIL (`awaiting_card` neexistuje, `notifyUserId` undefined).

- [ ] **Step 3: Implementuj refactor + routing**

Přepiš tělo `src/services/emailIngest.js` (zachovej hlavičku importů). Klíč: vytáhni `categorize` a `classifyAndStore`, vlož card-routing a `releaseHeldCard`.

```js
'use strict';
const { parseEmailNotification } = require('../utils/emailParser');
const { buildExternalId } = require('../utils/externalId');
const applyRules = require('../utils/apply-rules');
const seedRules = require('../../scripts/seed/rules');

const TX_INSERT = `INSERT OR IGNORE INTO transactions
    (user_id, category_id, amount, currency, date, description, note, source, external_id,
     tx_time, tx_type, counterparty_account, entered_by, place, account_id, ab_category)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank-email', ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertTx(db, userId, tx, categoryId, extId) {
  return db.prepare(TX_INSERT).run(
    userId, categoryId || null, tx.amount, tx.currency, tx.date, tx.description, tx.note || '',
    extId || null, tx.tx_time || null, tx.tx_type || null,
    tx.counterparty_account || null, tx.entered_by || null, tx.place || null,
    tx.account_id != null ? tx.account_id : (tx._account_id || null), tx.ab_category || null);
}

// Rozhodne kategorii. account = řádek accounts ({id, account_number}) nebo null.
function categorize(db, userId, tx, account) {
  const catName = applyRules(tx, account ? { account_number: account.account_number } : null, seedRules);
  const row = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?').get(userId, catName);
  const categoryId = row ? row.id : null;
  const confident = catName !== seedRules.fallbackCategory && categoryId != null;
  return { catName, categoryId, confident };
}

// Uloží transakci (jisté) nebo do review fronty (nejisté). Vrací result vč. notifyUserId.
function classifyAndStore(db, userId, tx, account, extId, notifyUserId, text) {
  const accId = account ? account.id : null;
  const { catName, categoryId, confident } = categorize(db, userId, tx, account);
  if (confident) {
    insertTx(db, userId, { ...tx, account_id: accId }, categoryId, extId);
    return {
      status: 'imported', external_id: extId, userId, notifyUserId,
      notify: { amount: tx.amount, currency: tx.currency, merchant: tx.place || tx.description || null, categoryName: catName },
    };
  }
  db.prepare(`INSERT INTO email_inbox (user_id, received_at, raw_text, parsed_json, external_id, suggested_category_id, status)
              VALUES (?, datetime('now'), ?, ?, ?, ?, 'pending')`)
    .run(userId, text || '', JSON.stringify({ ...tx, account_id: accId }), extId || null, categoryId);
  return {
    status: 'pending', external_id: extId, userId, notifyUserId,
    notify: { amount: tx.amount, currency: tx.currency, merchant: tx.place || tx.description || null, categoryName: null },
  };
}

function ingestEmail(db, { userEmail, text }) {
  const user = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(userEmail || '');
  if (!user) return { status: 'ignored' };
  const userId = user.id;

  const tx = parseEmailNotification(text);
  if (!tx) {
    db.prepare(`INSERT INTO email_inbox (user_id, received_at, raw_text, parsed_json, external_id, suggested_category_id, status)
                VALUES (?, datetime('now'), ?, NULL, NULL, NULL, 'unparsed')`).run(userId, text || '');
    return { status: 'unparsed' };
  }

  const account = tx.source_account
    ? db.prepare('SELECT id, account_number FROM accounts WHERE user_id = ? AND account_number = ?').get(userId, tx.source_account)
    : null;

  const extId = buildExternalId(tx.external_id, tx.source_account);
  if (extId) {
    if (db.prepare('SELECT 1 FROM transactions WHERE user_id = ? AND external_id = ?').get(userId, extId))
      return { status: 'duplicate', external_id: extId };
    if (db.prepare("SELECT 1 FROM email_inbox WHERE user_id = ? AND external_id = ? AND status IN ('pending','awaiting_card')").get(userId, extId))
      return { status: 'duplicate', external_id: extId };
  }

  // Routing podle karty
  let notifyUserId = userId; // fallback: vlastník dat
  if (tx.card_last4) {
    let card = db.prepare('SELECT assigned_user_id FROM cards WHERE data_owner_id = ? AND last4 = ?').get(userId, tx.card_last4);
    if (!card) {
      const hasMembers = db.prepare('SELECT 1 FROM household_members WHERE data_owner_id = ? LIMIT 1').get(userId);
      const assignTo = hasMembers ? null : userId; // solo → auto-přiřaď vlastníkovi
      db.prepare('INSERT OR IGNORE INTO cards (data_owner_id, last4, assigned_user_id) VALUES (?, ?, ?)').run(userId, tx.card_last4, assignTo);
      card = { assigned_user_id: assignTo };
    }
    if (card.assigned_user_id == null) {
      // Neznámá / nepřiřazená karta → drž transakci
      db.prepare(`INSERT INTO email_inbox (user_id, received_at, raw_text, parsed_json, external_id, suggested_category_id, status)
                  VALUES (?, datetime('now'), ?, ?, ?, NULL, 'awaiting_card')`)
        .run(userId, text || '', JSON.stringify({ ...tx, account_id: account ? account.id : null }), extId || null);
      return { status: 'awaiting_card', external_id: extId, userId };
    }
    notifyUserId = card.assigned_user_id;
  }

  return classifyAndStore(db, userId, tx, account, extId, notifyUserId, text);
}

// Uvolní zadržené platby pro nově přiřazenou kartu. Vrací počet zpracovaných.
function releaseHeldCard(db, dataOwnerId, last4) {
  const rows = db.prepare("SELECT * FROM email_inbox WHERE user_id = ? AND status = 'awaiting_card'").all(dataOwnerId);
  let released = 0;
  for (const row of rows) {
    if (!row.parsed_json) continue;
    const tx = JSON.parse(row.parsed_json);
    if (String(tx.card_last4) !== String(last4)) continue;
    const account = tx.account_id != null
      ? db.prepare('SELECT id, account_number FROM accounts WHERE id = ?').get(tx.account_id)
      : null;
    const { categoryId, confident } = categorize(db, dataOwnerId, tx, account);
    if (confident) {
      insertTx(db, dataOwnerId, tx, categoryId, row.external_id);
      db.prepare("UPDATE email_inbox SET status = 'imported' WHERE id = ?").run(row.id);
    } else {
      db.prepare("UPDATE email_inbox SET status = 'pending', suggested_category_id = ? WHERE id = ?").run(categoryId, row.id);
    }
    released++;
  }
  return released;
}

module.exports = { ingestEmail, releaseHeldCard, categorize };
```

- [ ] **Step 4: Spusť testy — musí projít**

Run: `node --test src/services/emailIngest.test.js`
Expected: PASS (vč. všech stávajících testů — `ingestEmail` signatura beze změny pro převody).

- [ ] **Step 5: Commit**

```bash
git add src/services/emailIngest.js src/services/emailIngest.test.js
git commit -m "feat(email): routing notifikace dle karty + awaiting_card hold + releaseHeldCard"
```

---

## Task 5: pushNotify — cíl dle `notifyUserId`

**Files:**
- Modify: `src/services/pushNotify.js:40-52`
- Test: `src/services/pushNotify.test.js`

- [ ] **Step 1: Napiš failing test**

Přidej do `src/services/pushNotify.test.js` (drž se stávajícího vzoru fake klienta v souboru):

```js
test('notifyForResult posílá na notifyUserId, ne na userId (data owner)', async () => {
  const { db, tmp } = freshDb(); // použij stávající helper v souboru
  db.prepare("INSERT INTO users (id, email) VALUES (1,'tom@x'),(2,'martin@x')").run();
  db.prepare("INSERT INTO settings (user_id, notify_scope) VALUES (2, 'all')").run();
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (2, 'e2', 'p', 'a')").run();
  const sent = [];
  const client = { sendNotification: async (sub) => { sent.push(sub.endpoint); } };
  const { notifyForResult } = require('./pushNotify');
  await notifyForResult(db, { status: 'imported', userId: 1, notifyUserId: 2, notify: { amount: -482, currency: 'CZK', merchant: 'HAMR', categoryName: 'Restaurace' } }, client);
  cleanup(db, tmp);
  assert.deepEqual(sent, ['e2']);
});
```

(Pokud `pushNotify.test.js` nemá `freshDb/cleanup` helpery, zkopíruj vzor z `emailIngest.test.js` na začátek souboru.)

- [ ] **Step 2: Spusť test — musí selhat**

Run: `node --test src/services/pushNotify.test.js`
Expected: FAIL (posílá na userId=1, který nemá subscription → `sent` prázdné).

- [ ] **Step 3: Implementuj**

Uprav `notifyForResult` v `src/services/pushNotify.js`:

```js
async function notifyForResult(db, result, client) {
  if (!result || !result.notify) return;
  if (result.status !== 'pending' && result.status !== 'imported') return;
  const target = result.notifyUserId || result.userId;
  if (!target) return;
  const row = db.prepare('SELECT notify_scope FROM settings WHERE user_id = ?').get(target);
  const scope = row?.notify_scope || 'pending_only';
  if (scope === 'off') return;
  if (result.status === 'imported' && scope !== 'all') return;
  await sendToUser(db, target, {
    title: 'SPENDEX',
    body: formatBody(result.notify),
    url: '/import',
  }, client);
}
```

- [ ] **Step 4: Spusť test — musí projít**

Run: `node --test src/services/pushNotify.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/pushNotify.js src/services/pushNotify.test.js
git commit -m "feat(push): notifikace cílí na vlastníka karty (notifyUserId)"
```

---

## Task 6: household.js — endpointy `cards`

**Files:**
- Modify: `src/routes/household.js`
- Test: `src/routes/household.test.js`

- [ ] **Step 1: Napiš failing testy**

Přidej do `src/routes/household.test.js`. Doplň helpery `jpatch` a `jget` (nahoře u `jpost`):

```js
function jpatch(base, p, body){ return fetch(`${base}${p}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})}); }

test('GET /cards vrací karty + lidi domácnosti; PATCH přiřadí kartu (může i člen)', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  db.prepare("INSERT INTO cards (data_owner_id, last4) VALUES (1, '6062')").run();
  // člen (uid=2) přiřadí kartu sobě
  let l = await listen(appFor(2));
  const before = await (await fetch(`${l.base}/api/household/cards`)).json();
  const patch = await jpatch(l.base, '/api/household/cards/6062', { assigned_user_id: 2, label: 'Martin Visa' });
  l.server.close();
  const card = db.prepare("SELECT * FROM cards WHERE data_owner_id = 1 AND last4 = '6062'").get();
  cleanup(db, tmp);
  assert.ok(before.people.some(p => p.user_id === 1) && before.people.some(p => p.user_id === 2));
  assert.equal(before.cards.length, 1);
  assert.equal(patch.status, 200);
  assert.equal(card.assigned_user_id, 2);
  assert.equal(card.label, 'Martin Visa');
});

test('PATCH /cards uvolní zadržené platby (awaiting_card → imported/pending)', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (7, 1, 'Restaurace')").run();
  db.prepare("INSERT INTO cards (data_owner_id, last4) VALUES (1, '6062')").run();
  const seedRules = require('../../scripts/seed/rules');
  seedRules.textOverrides.push({ pattern: 'HAMR', category: 'Restaurace' });
  const parsed = JSON.stringify({ amount: -482, currency: 'CZK', date: '2026-06-08', description: '', note: '', place: 'HAMR - BRANIK', card_last4: '6062', account_id: null, tx_type: 'Platba kartou' });
  db.prepare("INSERT INTO email_inbox (user_id, raw_text, parsed_json, external_id, status) VALUES (1, '', ?, '26918903543-1679014023', 'awaiting_card')").run(parsed);
  const l = await listen(appFor(1));
  const patch = await jpatch(l.base, '/api/household/cards/6062', { assigned_user_id: 2 });
  l.server.close();
  seedRules.textOverrides.pop();
  const tx = db.prepare("SELECT * FROM transactions WHERE user_id = 1").get();
  const inbox = db.prepare("SELECT status FROM email_inbox WHERE external_id = '26918903543-1679014023'").get();
  cleanup(db, tmp);
  assert.equal(patch.status, 200);
  assert.equal(tx.category_id, 7);
  assert.equal(inbox.status, 'imported');
});
```

- [ ] **Step 2: Spusť testy — musí selhat**

Run: `node --test src/routes/household.test.js`
Expected: FAIL (404 — endpointy `/cards` neexistují).

- [ ] **Step 3: Implementuj**

V `src/routes/household.js` přidej helper a endpointy (před `module.exports`):

```js
const { releaseHeldCard } = require('../services/emailIngest');

// Lidé domácnosti = vlastník + členové (pro dropdown přiřazení karty)
function householdPeople(ownerId) {
  const owner = db.prepare('SELECT id AS user_id, name, email FROM users WHERE id = ?').get(ownerId);
  const members = db.prepare(`
    SELECT hm.user_id, u.name, u.email
    FROM household_members hm JOIN users u ON u.id = hm.user_id
    WHERE hm.data_owner_id = ?
  `).all(ownerId);
  return [owner, ...members].filter(Boolean);
}

// GET /api/household/cards — karty + lidé + počet zadržených plateb na kartu
router.get('/cards', requireAuth, (req, res) => {
  const { ownerId } = roleOf(req.user.id);
  const cards = db.prepare(`
    SELECT c.last4, c.assigned_user_id, c.label, u.name AS assigned_name,
      (SELECT COUNT(*) FROM email_inbox i
         WHERE i.user_id = c.data_owner_id AND i.status = 'awaiting_card'
           AND json_extract(i.parsed_json, '$.card_last4') = c.last4) AS waiting
    FROM cards c
    LEFT JOIN users u ON u.id = c.assigned_user_id
    WHERE c.data_owner_id = ?
    ORDER BY (c.assigned_user_id IS NOT NULL), c.last4
  `).all(ownerId);
  res.json({ cards, people: householdPeople(ownerId) });
});

// PATCH /api/household/cards/:last4 — přiřaď/přejmenuj kartu + uvolni zadržené platby
router.patch('/cards/:last4', requireAuth, writeLimiter, (req, res) => {
  const { ownerId } = roleOf(req.user.id);
  const last4 = String(req.params.last4).replace(/[^\d]/g, '').slice(-4);
  const { assigned_user_id = null, label } = req.body || {};
  const card = db.prepare('SELECT 1 FROM cards WHERE data_owner_id = ? AND last4 = ?').get(ownerId, last4);
  if (!card) return res.status(404).json({ error: 'Karta nenalezena.' });

  let assignTo = null;
  if (assigned_user_id != null) {
    assignTo = parseInt(assigned_user_id, 10);
    const ok = householdPeople(ownerId).some(p => p.user_id === assignTo);
    if (!ok) return res.status(400).json({ error: 'Uživatel není v domácnosti.' });
  }
  db.prepare('UPDATE cards SET assigned_user_id = ?, label = COALESCE(?, label) WHERE data_owner_id = ? AND last4 = ?')
    .run(assignTo, label != null ? String(label).slice(0, 60) : null, ownerId, last4);

  let released = 0;
  if (assignTo != null) released = releaseHeldCard(db, ownerId, last4);
  res.json({ ok: true, released });
});
```

Pozn.: `json_extract` je vestavěná funkce SQLite (better-sqlite3 ji podporuje) — čte `card_last4` z `parsed_json`.

- [ ] **Step 4: Spusť testy — musí projít**

Run: `node --test src/routes/household.test.js`
Expected: PASS (vč. stávajících household testů).

- [ ] **Step 5: Commit**

```bash
git add src/routes/household.js src/routes/household.test.js
git commit -m "feat(household): GET/PATCH /cards (přiřazení karty + uvolnění zadržených plateb)"
```

---

## Task 7: UI — blok Karty v Nastavení

**Files:**
- Modify: `client/src/i18n.js` (sekce `settings`, za `household_*` klíče)
- Modify: `client/src/pages/SettingsPage.jsx`

- [ ] **Step 1: Přidej i18n klíče**

V `client/src/i18n.js` za `household_joined` přidej:

```js
    cards_title: 'Platební karty',
    cards_hint: 'Přiřaď každou kartu členovi domácnosti — notifikace o platbě pak dostane jen ten, kdo platil.',
    cards_unassigned: 'Nepřiřazená',
    cards_assign_placeholder: 'Přiřadit členovi…',
    cards_waiting: 'platby čekají na přiřazení',
    cards_none: 'Zatím žádné karty (objeví se po první platbě kartou).',
```

- [ ] **Step 2: Přidej state + loader + handler v SettingsPage.jsx**

Za `const [hhMsg, setHhMsg] = useState('');` (ř. ~92) přidej:

```js
  const [cards, setCards] = useState({ cards: [], people: [] });
```

Za `loadHousehold` (ř. ~118) přidej:

```js
  async function loadCards() {
    const r = await fetch('/api/household/cards', { credentials: 'include' });
    if (r.ok) setCards(await r.json());
  }
  useEffect(() => { loadCards(); }, []);

  async function assignCard(last4, userId) {
    await fetch(`/api/household/cards/${last4}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_user_id: userId || null }),
    });
    loadCards();
  }
```

- [ ] **Step 3: Vykresli blok Karty**

V JSX, hned za uzávěrkou bloku domácnosti `{hhMsg && ...}` (ř. ~374), přidej:

```jsx
          <div style={{ marginTop: 20 }}>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t.settings.cards_title}</p>
            <p className="form-hint" style={{ marginBottom: 8 }}>{t.settings.cards_hint}</p>
            {cards.cards.length === 0 ? (
              <p className="form-hint">{t.settings.cards_none}</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cards.cards.map(c => (
                  <li key={c.last4} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>•••• {c.last4}</span>
                    <select
                      className="input"
                      value={c.assigned_user_id || ''}
                      onChange={(e) => assignCard(c.last4, e.target.value ? parseInt(e.target.value) : null)}
                      style={{ fontSize: 13, maxWidth: 200 }}
                    >
                      <option value="">{t.settings.cards_assign_placeholder}</option>
                      {cards.people.map(p => (
                        <option key={p.user_id} value={p.user_id}>{p.name || p.email}</option>
                      ))}
                    </select>
                    {c.waiting > 0 && (
                      <span style={{ color: '#c0392b', fontSize: 12 }}>{c.waiting} {t.settings.cards_waiting}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
```

- [ ] **Step 4: Ověř build**

Run: `cd client && npm run build`
Expected: build projde bez chyb.

- [ ] **Step 5: Commit**

```bash
git add client/src/i18n.js client/src/pages/SettingsPage.jsx
git commit -m "feat(ui): sekce Platební karty v Nastavení (přiřazení člena, počet čekajících)"
```

---

## Task 8: Celá testovací sada + deploy na staging

- [ ] **Step 1: Spusť celou sadu**

Run: `node --test 'src/**/*.test.js'`
Expected: vše zelené (stávající + nové).

- [ ] **Step 2: Build klienta**

Run: `cd client && npm run build`
Expected: OK.

- [ ] **Step 3: Push na staging**

```bash
git push origin staging
```

Po pushi nahlas číslo verze (auto-bump v `package.json`). Prod deploy až na explicitní pokyn (viz CLAUDE.md deploy flow).

---

## Self-review (provedeno při psaní)

- **Pokrytí spec**: parser (T1), kategorizace-place (T2), tabulka cards (T3), routing+hold+release+solo (T4), push cíl (T5), endpointy+autorizace „oba členové" (T6), UI+i18n (T7). ✓
- **Held parsed_json** ukládá `card_last4` i `account_id` → `releaseHeldCard` i `json_extract` v GET je čtou. ✓
- **Konzistence názvů**: `releaseHeldCard`, `categorize`, `notifyUserId`, `householdPeople`, stav `awaiting_card`, sloupce `cards(data_owner_id,last4,assigned_user_id,label)` shodné napříč T3–T7. ✓
- **Dedup** rozšířen i na `awaiting_card` (T4) — opakovaný autorizační e-mail nevytvoří druhý hold. ✓
- **Zpětná notifikace** při uvolnění se vědomě neposílá (T4/T6 `releaseHeldCard` nevrací notify). ✓
