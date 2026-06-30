# Deep-link notifikace na platbu + filtr import sekce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Po kliknutí na push notifikaci o platbě zobrazit zařazení té konkrétní platby; member domácnosti vidí v import sekci jen svoje platby.

**Architecture:** Backend obohatí `result` z e-mailového ingestu o ID položky a sestaví deep-link URL + unikátní tag do push payloadu. Service worker a React stránky (Import, Transakce) přečtou parametry a scrollnou/zvýrazní cíl. Filtr import sekce je čistě SQL WHERE podmínka pro člena domácnosti.

**Tech Stack:** Node.js + Express, better-sqlite3, React + Vite, web-push, service worker. Testy přes `node:test` (`node --test`).

## Global Constraints

- Jazyk UI a komentářů: čeština (s diakritikou).
- Žádné `any` (projekt je JS, ale dodržuj striktní typy kde TS je).
- Žádné změny DB schématu (žádné nové tabulky/sloupce).
- Období vždy přes helpery z `src/utils/period.js` — nikdy nepočítej datum ručně.
- Po dokončení commituj do větve `staging` (ne `main`).
- Testy se spouští `node --test <soubor>`; žádný `test` script v package.json není.
- Frontend komponenty (`.jsx`) nemají test harness — ověřují se `npm run build` + manuálně. Backend a utils mají plné TDD.

---

### Task 1: Helper `periodKeyForDate` v period.js

**Files:**
- Modify: `src/utils/period.js`
- Test: `src/utils/period.test.js` (create)

**Interfaces:**
- Produces: `periodKeyForDate(billingDay: number, dateStr: string) -> string` — vrátí periodKey `"YYYY-MM"`, do kterého datum `"YYYY-MM-DD"` spadá podle billing_day. Den `>= billingDay` → měsíc data; den `< billingDay` → předchozí měsíc.

- [ ] **Step 1: Write the failing test**

Vytvoř `src/utils/period.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { periodKeyForDate, getPeriodDates } = require('./period');

test('billingDay=1 → periodKey je prostě YYYY-MM data', () => {
  assert.equal(periodKeyForDate(1, '2026-06-15'), '2026-06');
  assert.equal(periodKeyForDate(1, '2026-06-01'), '2026-06');
  assert.equal(periodKeyForDate(1, '2026-12-31'), '2026-12');
});

test('billingDay=15 → den před billingDay patří do předchozího měsíce', () => {
  assert.equal(periodKeyForDate(15, '2026-06-15'), '2026-06');
  assert.equal(periodKeyForDate(15, '2026-06-20'), '2026-06');
  assert.equal(periodKeyForDate(15, '2026-06-14'), '2026-05');
});

test('billingDay>1 přelom roku: leden před billingDay → prosinec loni', () => {
  assert.equal(periodKeyForDate(10, '2026-01-05'), '2025-12');
  assert.equal(periodKeyForDate(10, '2026-01-10'), '2026-01');
});

test('vrácený periodKey je konzistentní s getPeriodDates (datum padne do okna)', () => {
  const key = periodKeyForDate(15, '2026-06-14');
  const { start, end } = getPeriodDates(15, key);
  assert.ok('2026-06-14' >= start && '2026-06-14' <= end, `${start}..${end}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/utils/period.test.js`
Expected: FAIL — `periodKeyForDate is not a function`.

- [ ] **Step 3: Write minimal implementation**

V `src/utils/period.js` přidej před `module.exports`:

```javascript
/**
 * Vrátí periodKey ("YYYY-MM") pro billing cyklus, do kterého spadá dané datum.
 * Den >= billingDay patří do měsíce data; den < billingDay do předchozího měsíce.
 * @param {number} billingDay - den v měsíci (1–31)
 * @param {string} dateStr    - "YYYY-MM-DD"
 * @returns {string} "YYYY-MM"
 */
function periodKeyForDate(billingDay, dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (day >= billingDay) {
    return `${year}-${String(month).padStart(2, '0')}`;
  }
  const d = new Date(Date.UTC(year, month - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
```

A uprav export:

```javascript
module.exports = { getPeriodDates, currentPeriodKey, getUserBillingDay, periodKeyForDate };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/utils/period.test.js`
Expected: PASS (4 testy).

- [ ] **Step 5: Commit**

```bash
git add src/utils/period.js src/utils/period.test.js
git commit -m "feat(period): helper periodKeyForDate pro deep-link na transakci"
```

---

### Task 2: `result` z emailIngest nese ID cíle (inboxId / transactionId / txDate)

**Files:**
- Modify: `src/services/emailIngest.js:32-49` (classifyAndStore), `:85-99` (awaiting_card větev)
- Test: `src/services/emailIngest.test.js` (rozšířit)

**Interfaces:**
- Consumes: nic nového.
- Produces: `ingestEmail(...)` result rozšířen o:
  - status `imported` → `transactionId: number`, `txDate: string` (`tx.date`)
  - status `pending` → `inboxId: number`
  - status `awaiting_card` → `inboxId: number`

- [ ] **Step 1: Write the failing test**

Přidej na konec `src/services/emailIngest.test.js` (helpery `freshDb`, `seed`, `CARD_TX`, `INTERNAL` už v souboru existují):

```javascript
test('result imported nese transactionId a txDate', () => {
  const { db, tmp } = freshDb();
  seed(db);
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', text: INTERNAL });
  assert.equal(r.status, 'imported');
  assert.ok(Number.isInteger(r.transactionId) && r.transactionId > 0);
  assert.equal(r.txDate, '2026-06-07');
  const row = db.prepare('SELECT id FROM transactions WHERE id = ?').get(r.transactionId);
  assert.ok(row);
  cleanup(db, tmp);
});

test('result awaiting_card (neznámá karta v domácnosti) nese inboxId', () => {
  const { db, tmp } = freshDb();
  seed(db);
  // domácnost: owner=1, member=2 → nová karta zůstane nepřiřazená
  db.prepare("INSERT INTO users (id, email) VALUES (2, 'martin@example.com')").run();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', text: CARD_TX });
  assert.equal(r.status, 'awaiting_card');
  assert.ok(Number.isInteger(r.inboxId) && r.inboxId > 0);
  const row = db.prepare("SELECT id FROM email_inbox WHERE id = ? AND status = 'awaiting_card'").get(r.inboxId);
  assert.ok(row);
  cleanup(db, tmp);
});

test('result pending nese inboxId', () => {
  const { db, tmp } = freshDb();
  seed(db);
  // bez kategorie "Ostatní" fallback → ale necháme kartu přiřazenou ownerovi (solo),
  // platba kartou bez jistého pravidla → pending
  const { ingestEmail } = require('./emailIngest');
  const r = ingestEmail(db, { userEmail: 'tom@example.com', text: CARD_TX });
  assert.equal(r.status, 'pending');
  assert.ok(Number.isInteger(r.inboxId) && r.inboxId > 0);
  const row = db.prepare("SELECT id FROM email_inbox WHERE id = ? AND status = 'pending'").get(r.inboxId);
  assert.ok(row);
  cleanup(db, tmp);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/emailIngest.test.js`
Expected: FAIL — `r.transactionId` / `r.inboxId` jsou `undefined`.

- [ ] **Step 3: Write minimal implementation**

V `src/services/emailIngest.js` uprav `classifyAndStore` (řádky 35-48). Confident větev — zachyť výsledek insertu a dohledej id při IGNORE:

```javascript
  if (confident) {
    const r = insertTx(db, userId, { ...tx, account_id: accId }, categoryId, extId);
    const transactionId = r.changes > 0
      ? Number(r.lastInsertRowid)
      : (db.prepare('SELECT id FROM transactions WHERE user_id = ? AND external_id = ?').get(userId, extId)?.id ?? null);
    return {
      status: 'imported', external_id: extId, userId, notifyUserId,
      transactionId, txDate: tx.date,
      notify: { amount: tx.amount, currency: tx.currency, merchant: tx.place || tx.description || null, categoryName: catName },
    };
  }
  const ins = db.prepare(`INSERT INTO email_inbox (user_id, received_at, raw_text, parsed_json, external_id, suggested_category_id, status)
              VALUES (?, datetime('now'), ?, ?, ?, ?, 'pending')`)
    .run(userId, text || '', JSON.stringify({ ...tx, account_id: accId }), extId || null, categoryId);
  return {
    status: 'pending', external_id: extId, userId, notifyUserId,
    inboxId: Number(ins.lastInsertRowid),
    notify: { amount: tx.amount, currency: tx.currency, merchant: tx.place || tx.description || null, categoryName: null },
  };
```

V awaiting_card větvi (řádky 87-98) zachyť id:

```javascript
    if (card.assigned_user_id == null) {
      // Neznámá / nepřiřazená karta → drž transakci
      const ins = db.prepare(`INSERT INTO email_inbox (user_id, received_at, raw_text, parsed_json, external_id, suggested_category_id, status)
                  VALUES (?, datetime('now'), ?, ?, ?, NULL, 'awaiting_card')`)
        .run(userId, text || '', JSON.stringify({ ...tx, account_id: account ? account.id : null }), extId || null);
      return {
        status: 'awaiting_card', external_id: extId, userId,
        inboxId: Number(ins.lastInsertRowid),
        notify: {
          amount: tx.amount, currency: tx.currency,
          merchant: tx.place || tx.description || null,
          unknownCard: true, last4: tx.card_last4,
        },
        broadcast: true,
      };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/emailIngest.test.js`
Expected: PASS (původní + 3 nové testy).

- [ ] **Step 5: Commit**

```bash
git add src/services/emailIngest.js src/services/emailIngest.test.js
git commit -m "feat(ingest): result nese inboxId/transactionId/txDate pro deep-link notifikace"
```

---

### Task 3: pushNotify sestaví deep-link URL + unikátní tag

**Files:**
- Modify: `src/services/pushNotify.js:41-66` (notifyForResult)
- Test: `src/services/pushNotify.test.js` (rozšířit)

**Interfaces:**
- Consumes: `result.inboxId`, `result.transactionId`, `result.txDate`, `result.userId` (z Task 2); `periodKeyForDate`, `getUserBillingDay` (z `src/utils/period.js`).
- Produces: push payload `{ title, body, url, tag }`:
  - `awaiting_card` / `pending` s `inboxId` → `url=/import?focus=<inboxId>`, `tag=spendex-<inboxId>`
  - `imported` s `transactionId` → `url=/transactions?period=<key>&highlight=<transactionId>`, `tag=spendex-tx-<transactionId>`
  - fallback (chybí id) → `url=/import`, `tag=spendex-payment`

- [ ] **Step 1: Write the failing test**

Přidej do `src/services/pushNotify.test.js` (helpery `freshDb`, `cleanup` v souboru jsou). Test odchytí payload přes fake klienta:

```javascript
test('notifyForResult pending → url s focus a unikátní tag', async () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO settings (user_id, billing_day, notify_scope) VALUES (1, 1, 'pending_only')").run();
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://x/ep', 'k', 'a')").run();
  const sent = [];
  const fake = { sendNotification: async (_s, body) => { sent.push(JSON.parse(body)); return { statusCode: 201 }; } };
  const { notifyForResult } = require('./pushNotify');
  await notifyForResult(db, { status: 'pending', userId: 1, notifyUserId: 1, inboxId: 42, notify: { amount: -100, currency: 'CZK', merchant: 'X' } }, fake);
  cleanup(db, tmp);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/import?focus=42');
  assert.equal(sent[0].tag, 'spendex-42');
});

test('notifyForResult imported (scope all) → url na transakci se správným obdobím', async () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO settings (user_id, billing_day, notify_scope) VALUES (1, 1, 'all')").run();
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://x/ep', 'k', 'a')").run();
  const sent = [];
  const fake = { sendNotification: async (_s, body) => { sent.push(JSON.parse(body)); return { statusCode: 201 }; } };
  const { notifyForResult } = require('./pushNotify');
  await notifyForResult(db, { status: 'imported', userId: 1, notifyUserId: 1, transactionId: 128, txDate: '2026-06-07', notify: { amount: -100, currency: 'CZK', merchant: 'X', categoryName: 'Strava' } }, fake);
  cleanup(db, tmp);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/transactions?period=2026-06&highlight=128');
  assert.equal(sent[0].tag, 'spendex-tx-128');
});

test('notifyForResult awaiting_card broadcast → url s focus pro všechny v domácnosti', async () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'o@b.cz'),(2,'m@b.cz')").run();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1,'https://x/e1','k','a'),(2,'https://x/e2','k','a')").run();
  const sent = [];
  const fake = { sendNotification: async (_s, body) => { sent.push(JSON.parse(body)); return { statusCode: 201 }; } };
  const { notifyForResult } = require('./pushNotify');
  await notifyForResult(db, { status: 'awaiting_card', broadcast: true, userId: 1, inboxId: 7, notify: { amount: -482, currency: 'CZK', merchant: 'HAMR', unknownCard: true, last4: '6062' } }, fake);
  cleanup(db, tmp);
  assert.equal(sent.length, 2);
  for (const p of sent) { assert.equal(p.url, '/import?focus=7'); assert.equal(p.tag, 'spendex-7'); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/pushNotify.test.js`
Expected: FAIL — `url` je `/import` bez focus, `tag` chybí.

- [ ] **Step 3: Write minimal implementation**

V `src/services/pushNotify.js` přidej nahoře require:

```javascript
const { periodKeyForDate, getUserBillingDay } = require('../utils/period');
```

Přidej helper nad `notifyForResult`:

```javascript
// Sestaví deep-link URL + unikátní tag podle typu výsledku.
function deepLink(db, result) {
  if (result.status === 'imported' && result.transactionId && result.txDate) {
    const key = periodKeyForDate(getUserBillingDay(db, result.userId), result.txDate);
    return { url: `/transactions?period=${key}&highlight=${result.transactionId}`, tag: `spendex-tx-${result.transactionId}` };
  }
  if (result.inboxId) {
    return { url: `/import?focus=${result.inboxId}`, tag: `spendex-${result.inboxId}` };
  }
  return { url: '/import', tag: 'spendex-payment' };
}
```

Uprav awaiting_card větev (řádek 49-51) — nahraď tělo `for` cyklu:

```javascript
    const link = deepLink(db, result);
    for (const t of targets) {
      await sendToUser(db, t, { title: 'SPENDEX', body: formatBody(result.notify), url: link.url, tag: link.tag }, client);
    }
    return;
```

Uprav závěr (řádky 61-65):

```javascript
  const link = deepLink(db, result);
  await sendToUser(db, target, {
    title: 'SPENDEX',
    body: formatBody(result.notify),
    url: link.url,
    tag: link.tag,
  }, client);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/pushNotify.test.js`
Expected: PASS (původní + 3 nové testy).

- [ ] **Step 5: Commit**

```bash
git add src/services/pushNotify.js src/services/pushNotify.test.js
git commit -m "feat(push): deep-link URL + unikátní tag v notifikaci o platbě"
```

---

### Task 4: Service worker použije tag z payloadu

**Files:**
- Modify: `client/public/sw.js:5-17` (push handler)

**Interfaces:**
- Consumes: `data.tag` z payloadu (z Task 3).
- Produces: notifikace s tagem per platba (fallback `spendex-payment`).

- [ ] **Step 1: Uprav push handler**

V `client/public/sw.js` v `push` listeneru změň `showNotification` tak, aby tag bral z dat:

```javascript
self.addEventListener('push', (event) => {
  let data = { title: 'SPENDEX', body: 'Nová platba k zařazení', url: '/import' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_e) { /* keep default */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/import' },
      tag: data.tag || 'spendex-payment',
    })
  );
});
```

- [ ] **Step 2: Build ověří syntaxi**

Run: `npm run build`
Expected: build projde bez chyb (sw.js se kopíruje z `public/` jako statika).

- [ ] **Step 3: Commit**

```bash
git add client/public/sw.js
git commit -m "feat(sw): notifikace používá tag z payloadu (per platba)"
```

---

### Task 5: ImportPage — scroll + zvýraznění položky podle ?focus

**Files:**
- Modify: `client/src/pages/ImportPage.jsx` (EmailInbox: import `useSearchParams`/`useRef`, přidat `id` na review karty, focus effect)
- Modify: `client/src/index.css` (sdílená třída zvýraznění — ověř cestu CSS níže)

**Interfaces:**
- Consumes: URL param `?focus=<inboxId>`.
- Produces: po načtení fronty scroll + třída `.deep-focus` na `#inbox-<id>` na ~2 s.

- [ ] **Step 1: Najdi globální CSS soubor**

Run: `grep -rln "review-item" client/src/*.css`
Expected: vypíše soubor s CSS importů (např. `client/src/index.css`). Do něj přidávej CSS v dalším kroku.

- [ ] **Step 2: Přidej CSS pro zvýraznění**

Do nalezeného CSS souboru přidej:

```css
@keyframes deepFocusPulse {
  0%   { box-shadow: 0 0 0 0 var(--primary); }
  30%  { box-shadow: 0 0 0 4px var(--primary); }
  100% { box-shadow: 0 0 0 0 rgba(0,0,0,0); }
}
.deep-focus {
  animation: deepFocusPulse 1.2s ease-out 2;
  border-radius: 12px;
}
```

- [ ] **Step 3: Uprav EmailInbox — importy a focus effect**

V `client/src/pages/ImportPage.jsx` doplň importy reactu o `useRef` a routeru o `useSearchParams`. Na začátku těla `EmailInbox()` (po `const [busy...]`) přidej:

```javascript
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('focus');
  const focusedRef = useRef(false);
```

Za stávající `useEffect(() => { load(); }, [load]);` přidej effect, který se spustí po načtení `items`:

```javascript
  useEffect(() => {
    if (!focusId || focusedRef.current || items.length === 0) return;
    const el = document.getElementById(`inbox-${focusId}`);
    if (!el) return;
    focusedRef.current = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('deep-focus');
    const t = setTimeout(() => el.classList.remove('deep-focus'), 2600);
    return () => clearTimeout(t);
  }, [items, focusId]);
```

- [ ] **Step 4: Přidej `id` na review karty**

V renderu `EmailInbox` přidej na obě `<div ... className="card review-item">` (awaiting i pending) atribut `id`:

```jsx
          <div key={item.id} id={`inbox-${item.id}`} className="card review-item">
```

(Uprav obě výskyty — awaiting_card větev cca ř. 270 a pending větev cca ř. 307.)

- [ ] **Step 5: Build a manuální ověření**

Run: `npm run build`
Expected: build projde. Manuální ověření: otevři `/import?focus=<id_existující_pending_položky>` → stránka scrollne na položku a krátce ji zvýrazní.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/ImportPage.jsx client/src/index.css
git commit -m "feat(import): scroll + zvýraznění položky podle ?focus z notifikace"
```

---

### Task 6: TransactionsPage — scroll + zvýraznění řádku podle ?highlight

**Files:**
- Modify: `client/src/pages/TransactionsPage.jsx` (číst `?highlight`, `data-tx-id` na řádek, highlight effect)

**Interfaces:**
- Consumes: URL param `?highlight=<transactionId>`; sdílená CSS třída `.deep-focus` (z Task 5).
- Produces: po načtení transakcí scroll + zvýraznění řádku dané transakce.

- [ ] **Step 1: Přidej čtení highlight paramu**

V `client/src/pages/TransactionsPage.jsx` u ostatních `searchParams.get(...)` (cca ř. 54-57) přidej:

```javascript
  const highlightId = searchParams.get('highlight');
```

Mezi importy ověř, že `useRef` je importován z reactu (ř. 1 už `useRef` obsahuje). Přidej ref vedle ostatních stavů:

```javascript
  const highlightedRef = useRef(false);
```

- [ ] **Step 2: Přidej `data-tx-id` na řádek transakce**

Na normální (needitovaný) řádek transakce (cca ř. 681-685) přidej atribut:

```jsx
              <div
                key={tx.id}
                data-tx-id={tx.id}
                className={`tx-row${selected.has(tx.id) ? ' tx-row-selected' : ''}`}
                style={{ gridTemplateColumns: colsToGrid(cols) }}
              >
```

- [ ] **Step 3: Přidej highlight effect**

Za `useEffect(() => { loadTransactions(); }, [loadTransactions]);` (cca ř. 190) přidej:

```javascript
  useEffect(() => {
    if (!highlightId || highlightedRef.current || transactions.length === 0) return;
    const el = document.querySelector(`[data-tx-id="${highlightId}"]`);
    if (!el) return;
    highlightedRef.current = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('deep-focus');
    const t = setTimeout(() => el.classList.remove('deep-focus'), 2600);
    return () => clearTimeout(t);
  }, [transactions, highlightId]);
```

- [ ] **Step 4: Build a manuální ověření**

Run: `npm run build`
Expected: build projde. Manuální ověření: `/transactions?period=<klíč>&highlight=<id>` → scroll na řádek + zvýraznění.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/TransactionsPage.jsx
git commit -m "feat(transakce): scroll + zvýraznění řádku podle ?highlight z notifikace"
```

---

### Task 7: Filtr import sekce pro člena domácnosti

**Files:**
- Modify: `src/routes/emailInbox.js:11-26` (GET /), `:31-46` (GET /history)
- Test: `src/routes/emailInbox.test.js` (rozšířit)

**Interfaces:**
- Consumes: `req.user.id`, `req.dataUserId` (z `requireAuth`).
- Produces: pro member (`req.user.id !== req.dataUserId`) vrací jen položky placené jeho kartou (`cards.assigned_user_id = req.user.id`) + `awaiting_card`. Owner/solo beze změny.

- [ ] **Step 1: Write the failing test**

Současné testy volají `appFor(uid)`, který nastaví `req.dataUserId = uid` (= owner). Pro member potřebujeme `req.user.id != req.dataUserId`. Přidej do `src/routes/emailInbox.test.js` helper a testy:

```javascript
function appForMember(currentUid, ownerUid){
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:currentUid}; req.dataUserId=ownerUid; req.isAuthenticated=()=>true; next(); });
  app.use('/api/email-inbox', require('./emailInbox'));
  return app;
}

test('member vidí jen svoje karetní platby + awaiting_card, ne cizí ani bez karty', async () => {
  const { db, tmp } = setup();
  // karty: 6062 → Martin(2), 1111 → owner(1)
  db.prepare("INSERT INTO cards (data_owner_id, last4, assigned_user_id) VALUES (1,'6062',2),(1,'1111',1)").run();
  // Martinova karetní platba (pending)
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'pending')")
    .run(JSON.stringify({ description: 'Martin nákup', amount: -200, card_last4: '6062' }));
  // Owner karetní platba (pending) — Martin NEMÁ vidět
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'pending')")
    .run(JSON.stringify({ description: 'Owner nákup', amount: -300, card_last4: '1111' }));
  // Platba bez karty (převod) — Martin NEMÁ vidět
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'pending')")
    .run(JSON.stringify({ description: 'Převod', amount: -100 }));
  // awaiting_card (neznámá) — Martin MÁ vidět
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'awaiting_card')")
    .run(JSON.stringify({ description: 'Neznámá karta', amount: -50, card_last4: '9999' }));

  const l = await listen(appForMember(2, 1));
  const rows = await (await fetch(`${l.base}/api/email-inbox`)).json();
  l.server.close(); cleanup(db, tmp);
  const descs = rows.map(r => JSON.parse(r.parsed_json).description).sort();
  assert.deepEqual(descs, ['Martin nákup', 'Neznámá karta']);
});

test('owner vidí vše (beze změny)', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO cards (data_owner_id, last4, assigned_user_id) VALUES (1,'6062',2)").run();
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'pending')")
    .run(JSON.stringify({ description: 'Martin nákup', amount: -200, card_last4: '6062' }));
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'pending')")
    .run(JSON.stringify({ description: 'Převod', amount: -100 }));
  const l = await listen(appFor(1));
  const rows = await (await fetch(`${l.base}/api/email-inbox`)).json();
  l.server.close(); cleanup(db, tmp);
  assert.equal(rows.length, 2);
});

test('member /history filtruje stejně', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO cards (data_owner_id, last4, assigned_user_id) VALUES (1,'6062',2),(1,'1111',1)").run();
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'imported')")
    .run(JSON.stringify({ description: 'Martin nákup', amount: -200, card_last4: '6062' }));
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'imported')")
    .run(JSON.stringify({ description: 'Owner nákup', amount: -300, card_last4: '1111' }));
  const l = await listen(appForMember(2, 1));
  const rows = await (await fetch(`${l.base}/api/email-inbox/history`)).json();
  l.server.close(); cleanup(db, tmp);
  const descs = rows.map(r => JSON.parse(r.parsed_json).description);
  assert.deepEqual(descs, ['Martin nákup']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/routes/emailInbox.test.js`
Expected: FAIL — member vidí všechny položky (filtr ještě není).

- [ ] **Step 3: Implementace GET /**

V `src/routes/emailInbox.js` nahraď handler `GET /` (řádky 11-26):

```javascript
router.get('/', requireAuth, (req, res) => {
  const isMember = req.user.id !== req.dataUserId;
  const memberFilter = isMember
    ? "AND (cd.assigned_user_id = @currentUser OR i.status = 'awaiting_card')"
    : '';
  const rows = db.prepare(`
    SELECT i.id, i.received_at, i.raw_text, i.parsed_json, i.external_id,
           i.suggested_category_id, i.status, i.created_at,
           c.name AS suggested_category_name, c.color AS suggested_category_color,
           cu.id AS card_owner_id, cu.name AS card_owner_name
    FROM email_inbox i
    LEFT JOIN categories c ON c.id = i.suggested_category_id
    LEFT JOIN cards cd ON cd.data_owner_id = i.user_id
                      AND cd.last4 = json_extract(i.parsed_json, '$.card_last4')
    LEFT JOIN users cu ON cu.id = cd.assigned_user_id
    WHERE i.user_id = @owner AND i.status IN ('pending', 'unparsed', 'awaiting_card')
      ${memberFilter}
    ORDER BY i.created_at DESC, i.id DESC
  `).all({ owner: req.dataUserId, currentUser: req.user.id });
  res.json(rows);
});
```

- [ ] **Step 4: Implementace GET /history**

Nahraď handler `GET /history` (řádky 31-46) — doplň JOIN na `cards` a filtr:

```javascript
router.get('/history', requireAuth, (req, res) => {
  const isMember = req.user.id !== req.dataUserId;
  const memberFilter = isMember
    ? "AND (cd.assigned_user_id = @currentUser OR i.status = 'awaiting_card')"
    : '';
  const rows = db.prepare(`
    SELECT i.id, i.received_at, i.parsed_json, i.external_id, i.status, i.created_at,
           COALESCE(tc.name, sc.name)  AS category_name,
           COALESCE(tc.color, sc.color) AS category_color
    FROM email_inbox i
    LEFT JOIN categories sc ON sc.id = i.suggested_category_id
    LEFT JOIN transactions t ON i.status = 'imported'
                            AND t.user_id = i.user_id
                            AND t.external_id = i.external_id
    LEFT JOIN categories tc ON tc.id = t.category_id
    LEFT JOIN cards cd ON cd.data_owner_id = i.user_id
                      AND cd.last4 = json_extract(i.parsed_json, '$.card_last4')
    WHERE i.user_id = @owner
      ${memberFilter}
    ORDER BY i.created_at DESC, i.id DESC
  `).all({ owner: req.dataUserId, currentUser: req.user.id });
  res.json(rows);
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test src/routes/emailInbox.test.js`
Expected: PASS (původní 2 + 3 nové testy).

- [ ] **Step 6: Commit**

```bash
git add src/routes/emailInbox.js src/routes/emailInbox.test.js
git commit -m "feat(import): člen domácnosti vidí v importu jen svoje platby + neznámé karty"
```

---

### Task 8: Závěrečná verifikace celé sady

- [ ] **Step 1: Spusť celou backendovou sadu**

Run: `node --test src/**/*.test.js`
Expected: vše zelené (původní sada + nové testy).

- [ ] **Step 2: Build klienta**

Run: `npm run build`
Expected: build projde bez chyb.

- [ ] **Step 3: Push do staging**

```bash
git push origin staging
```

Po pushi nahlas číslo verze (bump-version hook).

---

## Self-Review

**Spec coverage:**
- Feature 1 deep-link statusy → Task 1 (periodKey), Task 2 (ids), Task 3 (URL+tag), Task 4 (sw tag), Task 5 (import focus), Task 6 (transakce highlight). ✓
- Feature 2 filtr member → Task 7 (GET / a /history). ✓
- Testy: period.test.js (T1), emailIngest.test.js (T2), pushNotify.test.js (T3), emailInbox.test.js (T7). ✓
- "Co se nemění" (routing, CSV, schéma) — respektováno, žádný task to nemění. ✓

**Placeholder scan:** žádné TBD/TODO; všechny kroky mají konkrétní kód a příkazy. ✓

**Type consistency:** `periodKeyForDate(billingDay, dateStr)` def. v T1, použito v T3. `result.inboxId/transactionId/txDate` def. v T2, použito v T3. CSS `.deep-focus` def. v T5, použito v T6. URL formáty `/import?focus=` a `/transactions?period=&highlight=` konzistentní mezi T3 (generuje) a T5/T6 (čte). ✓
