# Push notifikace (PWA + Web Push) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Při příchozí AirBank platbě, která čeká na zařazení do kategorie, vyskočí uživateli push notifikace na iPhonu s částkou + obchodníkem a deep-linkem do `/import`.

**Architecture:** Backend rozšíří čistou funkci `ingestEmail` o data pro notifikaci, webhook router `emailInbound` po úspěšném ingestu best-effort zavolá novou službu `pushNotify`, která odešle Web Push přes `web-push` na všechna zařízení uživatele uložená v tabulce `push_subscriptions`. Frontend se stane instalovatelnou PWA (manifest + service worker) a v Nastavení nabídne zapnutí notifikací a výběr rozsahu (`off` / `pending_only` / `all`).

**Tech Stack:** Node.js + Express, better-sqlite3, `web-push` (VAPID), React + Vite, statický service worker, `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-08-push-notifikace-design.md`

**Konvence projektu (dodržuj):**
- Testy: `node --test <soubor>` (framework `node:test` + `node:assert/strict`). Vzor izolované DB viz `src/services/emailIngest.test.js` (`freshDb()` / `cleanup()` / `seed()`).
- Migrace: nový `ALTER TABLE` string se přidává do pole migrací v `src/db/schema.js` (kolem ř. 237–253), aplikuje se v try/catch.
- Routy: jeden soubor = jeden router, mount v `src/index.js`.
- Deploy: commituj a pushuj do větve `staging`.
- Žádné `any`, čeština v UI (`client/src/i18n.js`).

---

## File Structure

**Backend (nové):**
- `src/services/pushNotify.js` — odeslání Web Push + rozhodnutí dle `notify_scope`
- `src/services/pushNotify.test.js` — unit testy služby
- `src/routes/push.js` — endpointy pro VAPID key, subscribe, unsubscribe, test
- `scripts/gen-pwa-icons.js` — jednorázový generátor PNG ikon z `favicon.svg`

**Backend (úpravy):**
- `src/db/schema.js` — tabulka `push_subscriptions` + sloupec `settings.notify_scope`
- `src/services/emailIngest.js` — návrat rozšířit o `userId` a `notify` payload
- `src/services/emailIngest.test.js` — doplnit assert na nová pole
- `src/routes/emailInbound.js` — best-effort trigger po ingestu
- `src/routes/settings.js` — GET/PUT rozšířit o `notify_scope`
- `src/index.js` — mount `/api/push`

**Frontend (nové):**
- `client/public/manifest.webmanifest`
- `client/public/sw.js`
- `client/public/icon-192.png`, `client/public/icon-512.png` (generované)
- `client/src/push.js` — helper: permission → register SW → subscribe → POST

**Frontend (úpravy):**
- `client/index.html` — link na manifest, theme-color, apple-touch-icon
- stránka Nastavení (`client/src/pages/SettingsPage.jsx` nebo ekvivalent) — sekce Notifikace
- `client/src/i18n.js` — nové texty

---

## Task 1: DB migrace — tabulka push_subscriptions + sloupec notify_scope

**Files:**
- Modify: `src/db/schema.js` (pole migrací ~ř. 237–253; CREATE TABLE bloky ~ř. 5–70)
- Test: `src/db/schema.push.test.js` (Create)

- [ ] **Step 1: Write the failing test**

Create `src/db/schema.push.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-schema-push-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + s); } catch { /* ok */ } }
}

test('push_subscriptions tabulka existuje a má očekávané sloupce', () => {
  const { db, tmp } = freshDb();
  const cols = db.prepare("PRAGMA table_info(push_subscriptions)").all().map(c => c.name);
  cleanup(db, tmp);
  for (const c of ['id', 'user_id', 'endpoint', 'p256dh', 'auth', 'user_agent', 'created_at']) {
    assert.ok(cols.includes(c), `chybí sloupec ${c}`);
  }
});

test('settings.notify_scope existuje s defaultem pending_only', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO settings (user_id, billing_day) VALUES (1, 1)").run();
  const row = db.prepare("SELECT notify_scope FROM settings WHERE user_id = 1").get();
  cleanup(db, tmp);
  assert.equal(row.notify_scope, 'pending_only');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/db/schema.push.test.js`
Expected: FAIL — `no such table: push_subscriptions` resp. `no such column: notify_scope`.

- [ ] **Step 3: Add the table and column**

V `src/db/schema.js` přidej `CREATE TABLE` blok (vedle ostatních `CREATE TABLE IF NOT EXISTS`, např. hned za blok `settings` kolem ř. 70):

```javascript
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      endpoint    TEXT NOT NULL UNIQUE,
      p256dh      TEXT NOT NULL,
      auth        TEXT NOT NULL,
      user_agent  TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );
  `);
```

(Pozn.: pokud schema.js používá jeden velký `db.exec` se všemi tabulkami, přidej `CREATE TABLE` dovnitř toho stejného template-stringu místo nového `db.exec`.)

Do pole migrací (ALTER TABLE stringy, ~ř. 253) přidej:

```javascript
    "ALTER TABLE settings ADD COLUMN notify_scope TEXT DEFAULT 'pending_only'",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/db/schema.push.test.js`
Expected: PASS (2 testy).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.js src/db/schema.push.test.js
git commit -m "feat(push): schema — push_subscriptions + settings.notify_scope"
```

---

## Task 2: Služba pushNotify — odeslání Web Push + rozhodnutí dle scope

**Files:**
- Create: `src/services/pushNotify.js`
- Test: `src/services/pushNotify.test.js`
- Modify: `package.json` (dependency `web-push`)

- [ ] **Step 1: Install web-push**

Run: `npm install web-push`
Expected: `web-push` v `dependencies`.

- [ ] **Step 2: Write the failing test**

Create `src/services/pushNotify.test.js`. Test injektuje fake `web-push` klienta, aby se nic reálně neposílalo:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-pushnotify-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('../db/connection')];
  delete require.cache[require.resolve('../db/schema')];
  delete require.cache[require.resolve('./pushNotify')];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + s); } catch { /* ok */ } }
}
function seedUser(db, scope) {
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  db.prepare("INSERT INTO settings (user_id, billing_day, notify_scope) VALUES (1, 1, ?)").run(scope);
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://x/ep1', 'k', 'a')").run();
}

test('sendToUser odešle na všechna zařízení uživatele', async () => {
  const { db, tmp } = freshDb();
  seedUser(db, 'pending_only');
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://x/ep2', 'k', 'a')").run();
  const sent = [];
  const fakeClient = { sendNotification: async (sub) => { sent.push(sub.endpoint); return { statusCode: 201 }; } };
  const { sendToUser } = require('./pushNotify');
  await sendToUser(db, 1, { title: 'T', body: 'B', url: '/import' }, fakeClient);
  cleanup(db, tmp);
  assert.deepEqual(sent.sort(), ['https://x/ep1', 'https://x/ep2']);
});

test('410 z push služby → subscription se smaže', async () => {
  const { db, tmp } = freshDb();
  seedUser(db, 'pending_only');
  const fakeClient = { sendNotification: async () => { const e = new Error('gone'); e.statusCode = 410; throw e; } };
  const { sendToUser } = require('./pushNotify');
  await sendToUser(db, 1, { title: 'T', body: 'B', url: '/import' }, fakeClient);
  const cnt = db.prepare("SELECT COUNT(*) c FROM push_subscriptions WHERE user_id = 1").get().c;
  cleanup(db, tmp);
  assert.equal(cnt, 0);
});

test('notifyForResult: pending + scope off → nic neodešle', async () => {
  const { db, tmp } = freshDb();
  seedUser(db, 'off');
  let calls = 0;
  const fakeClient = { sendNotification: async () => { calls++; return { statusCode: 201 }; } };
  const { notifyForResult } = require('./pushNotify');
  await notifyForResult(db, { status: 'pending', userId: 1, notify: { amount: -349, currency: 'CZK', merchant: 'Albert' } }, fakeClient);
  cleanup(db, tmp);
  assert.equal(calls, 0);
});

test('notifyForResult: pending + scope pending_only → odešle', async () => {
  const { db, tmp } = freshDb();
  seedUser(db, 'pending_only');
  let calls = 0;
  const fakeClient = { sendNotification: async () => { calls++; return { statusCode: 201 }; } };
  const { notifyForResult } = require('./pushNotify');
  await notifyForResult(db, { status: 'pending', userId: 1, notify: { amount: -349, currency: 'CZK', merchant: 'Albert' } }, fakeClient);
  cleanup(db, tmp);
  assert.equal(calls, 1);
});

test('notifyForResult: imported + scope pending_only → nic; scope all → odešle', async () => {
  const { db, tmp } = freshDb();
  seedUser(db, 'pending_only');
  let calls = 0;
  const fakeClient = { sendNotification: async () => { calls++; return { statusCode: 201 }; } };
  const { notifyForResult } = require('./pushNotify');
  const res = { status: 'imported', userId: 1, notify: { amount: -349, currency: 'CZK', merchant: 'Albert', categoryName: 'Potraviny' } };
  await notifyForResult(db, res, fakeClient);
  assert.equal(calls, 0);
  db.prepare("UPDATE settings SET notify_scope = 'all' WHERE user_id = 1").run();
  await notifyForResult(db, res, fakeClient);
  cleanup(db, tmp);
  assert.equal(calls, 1);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test src/services/pushNotify.test.js`
Expected: FAIL — `Cannot find module './pushNotify'`.

- [ ] **Step 4: Implement pushNotify**

Create `src/services/pushNotify.js`:

```javascript
'use strict';
const webpush = require('web-push');

let configured = false;
// Lazy konfigurace VAPID z env. Pokud klíče chybí, služba je no-op (best-effort).
function defaultClient() {
  if (!configured) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:tomas.strida@gmail.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      configured = true;
    }
  }
  return webpush;
}

/**
 * Odešle push na všechna zařízení uživatele. Neplatná (404/410) maže.
 * @param {object} payload { title, body, url }
 * @param {{sendNotification:Function}} [client] injektovatelný klient (testy)
 */
async function sendToUser(db, userId, payload, client) {
  const sender = client || defaultClient();
  if (!client && !configured) return; // bez VAPID klíčů nic neposíláme
  const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
  const body = JSON.stringify(payload);
  for (const s of subs) {
    const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await sender.sendNotification(sub, body);
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      } else {
        console.error('[push] odeslání selhalo:', err && err.message);
      }
    }
  }
}

function formatBody(notify) {
  const amount = Math.abs(Number(notify.amount) || 0);
  const sum = `${amount.toLocaleString('cs-CZ')} ${notify.currency || 'CZK'}`;
  const merchant = notify.merchant || 'Platba';
  if (notify.categoryName) return `${sum} • ${merchant} → ${notify.categoryName}`;
  return `${sum} • ${merchant} — potřebuje kategorii`;
}

/**
 * Rozhodne dle settings.notify_scope, zda a co poslat pro výsledek ingestu.
 * @param {object} result { status, userId, notify }
 */
async function notifyForResult(db, result, client) {
  if (!result || !result.userId || !result.notify) return;
  if (result.status !== 'pending' && result.status !== 'imported') return;
  const row = db.prepare('SELECT notify_scope FROM settings WHERE user_id = ?').get(result.userId);
  const scope = row?.notify_scope || 'pending_only';
  if (scope === 'off') return;
  if (result.status === 'imported' && scope !== 'all') return;
  await sendToUser(db, result.userId, {
    title: 'SPENDEX',
    body: formatBody(result.notify),
    url: '/import',
  }, client);
}

module.exports = { sendToUser, notifyForResult, formatBody };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test src/services/pushNotify.test.js`
Expected: PASS (5 testů).

- [ ] **Step 6: Commit**

```bash
git add src/services/pushNotify.js src/services/pushNotify.test.js package.json package-lock.json
git commit -m "feat(push): služba pushNotify (sendToUser + notifyForResult dle scope)"
```

---

## Task 3: Rozšířit ingestEmail návrat o userId a notify payload

**Files:**
- Modify: `src/services/emailIngest.js:54-71`
- Test: `src/services/emailIngest.test.js`

- [ ] **Step 1: Write the failing test**

Do `src/services/emailIngest.test.js` přidej nový test (na konec souboru, před případný `module.exports` není — soubor jen registruje testy):

```javascript
test('ingestEmail vrací userId a notify payload (pending i imported)', () => {
  const { db, tmp } = freshDb();
  seed(db);
  const { ingestEmail } = require('./emailIngest');
  // INTERNAL je interní převod → imported (viz horní testy)
  const r = ingestEmail(db, { userEmail: 'tom@example.com', fromHeader: 'info@airbank.cz', text: INTERNAL });
  cleanup(db, tmp);
  assert.equal(r.userId, 1);
  assert.ok(r.notify, 'notify payload chybí');
  assert.equal(typeof r.notify.amount, 'number');
  assert.ok('merchant' in r.notify);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/services/emailIngest.test.js`
Expected: FAIL — `r.userId` je `undefined`.

- [ ] **Step 3: Rozšířit návraty v ingestEmail**

V `src/services/emailIngest.js` uprav dvě návratové větve.

Větev `imported` (ř. 63) změň z:

```javascript
    return { status: 'imported', external_id: extId };
```

na:

```javascript
    return {
      status: 'imported', external_id: extId, userId,
      notify: { amount: tx.amount, currency: tx.currency, merchant: tx.place || tx.description || null, categoryName: catName },
    };
```

Větev `pending` (ř. 71) změň z:

```javascript
  return { status: 'pending', external_id: extId };
```

na:

```javascript
  return {
    status: 'pending', external_id: extId, userId,
    notify: { amount: tx.amount, currency: tx.currency, merchant: tx.place || tx.description || null, categoryName: null },
  };
```

(Ostatní návraty — `ignored`, `unparsed`, `duplicate` — nech beze změny; `notifyForResult` je ignoruje.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/services/emailIngest.test.js`
Expected: PASS (všechny stávající + nový test).

- [ ] **Step 5: Commit**

```bash
git add src/services/emailIngest.js src/services/emailIngest.test.js
git commit -m "feat(push): ingestEmail vrací userId + notify payload"
```

---

## Task 4: Endpointy /api/push (public-key, subscribe, unsubscribe, test)

**Files:**
- Create: `src/routes/push.js`
- Modify: `src/index.js:62` (mount)
- Test: `src/routes/push.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/routes/push.test.js`. Testuje router přes `supertest`-free přístup — voláme handlery přes lehký express app a `node:http`. Projekt nemá supertest; použij vestavěný `fetch` proti dočasnému serveru:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

function freshApp() {
  const tmp = path.join(os.tmpdir(), `spendex-push-route-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  process.env.VAPID_PUBLIC_KEY = 'TEST_PUBLIC_KEY';
  for (const m of ['../db/connection', '../db/schema', './push']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  const app = express();
  app.use(express.json());
  // fake auth: vždy user 1
  app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
  app.use('/api/push', require('./push'));
  return { app, db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + s); } catch { /* ok */ } }
}
async function listen(app) {
  const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  const port = server.address().port;
  return { server, base: `http://127.0.0.1:${port}` };
}

test('GET /api/push/public-key vrací VAPID public key', async () => {
  const { app, db, tmp } = freshApp();
  const { server, base } = await listen(app);
  const r = await fetch(`${base}/api/push/public-key`);
  const j = await r.json();
  server.close(); cleanup(db, tmp);
  assert.equal(j.publicKey, 'TEST_PUBLIC_KEY');
});

test('POST /api/push/subscribe uloží subscription (upsert dle endpoint)', async () => {
  const { app, db, tmp } = freshApp();
  const { server, base } = await listen(app);
  const sub = { endpoint: 'https://x/ep1', keys: { p256dh: 'k', auth: 'a' } };
  await fetch(`${base}/api/push/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) });
  await fetch(`${base}/api/push/subscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) });
  const cnt = db.prepare("SELECT COUNT(*) c FROM push_subscriptions WHERE endpoint = 'https://x/ep1'").get().c;
  server.close(); cleanup(db, tmp);
  assert.equal(cnt, 1);
});

test('POST /api/push/unsubscribe smaže subscription', async () => {
  const { app, db, tmp } = freshApp();
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1, 'https://x/ep1', 'k', 'a')").run();
  const { server, base } = await listen(app);
  await fetch(`${base}/api/push/unsubscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'https://x/ep1' }) });
  const cnt = db.prepare("SELECT COUNT(*) c FROM push_subscriptions").get().c;
  server.close(); cleanup(db, tmp);
  assert.equal(cnt, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/routes/push.test.js`
Expected: FAIL — `Cannot find module './push'`.

- [ ] **Step 3: Implement router**

Create `src/routes/push.js`:

```javascript
'use strict';
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { sendToUser } = require('../services/pushNotify');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// Veřejný VAPID klíč pro PushManager.subscribe na klientovi.
router.get('/public-key', requireAuth, (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// Uloží/aktualizuje subscription aktuálního zařízení.
router.post('/subscribe', requireAuth, writeLimiter, (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'Neplatná subscription.' });
  }
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id, p256dh = excluded.p256dh,
      auth = excluded.auth, user_agent = excluded.user_agent
  `).run(req.user.id, endpoint, keys.p256dh, keys.auth, req.get('user-agent') || null);
  res.json({ ok: true });
});

// Odhlásí zařízení.
router.post('/unsubscribe', requireAuth, writeLimiter, (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, req.user.id);
  res.json({ ok: true });
});

// Pošle testovací notifikaci na všechna zařízení uživatele.
router.post('/test', requireAuth, writeLimiter, async (req, res) => {
  await sendToUser(db, req.user.id, { title: 'SPENDEX', body: 'Testovací notifikace ✅', url: '/import' });
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 4: Mount router**

V `src/index.js` za řádek 62 (`app.use('/api/email-inbox', ...)`) přidej:

```javascript
app.use('/api/push', require('./routes/push'));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test src/routes/push.test.js`
Expected: PASS (3 testy).

- [ ] **Step 6: Commit**

```bash
git add src/routes/push.js src/index.js src/routes/push.test.js
git commit -m "feat(push): endpointy /api/push (public-key, subscribe, unsubscribe, test)"
```

---

## Task 5: Trigger push ve webhook routeru emailInbound

**Files:**
- Modify: `src/routes/emailInbound.js:44-45`

- [ ] **Step 1: Napoj notifyForResult po ingestu (best-effort)**

V `src/routes/emailInbound.js` přidej k importům (za ř. 7):

```javascript
const { notifyForResult } = require('../services/pushNotify');
```

A uprav blok ř. 44–45 z:

```javascript
    const result = ingestEmail(db, { userEmail: allowed, fromHeader: fromHdr, text });
    return res.json(result);
```

na:

```javascript
    const result = ingestEmail(db, { userEmail: allowed, fromHeader: fromHdr, text });
    // Push je best-effort: případné selhání nesmí ovlivnit odpověď webhooku ani import.
    notifyForResult(db, result).catch((e) => console.error('[push] notifyForResult:', e && e.message));
    return res.json(result);
```

- [ ] **Step 2: Ověř, že existující testy webhooku procházejí**

Run: `node --test src/routes/emailInbound.test.js` (pokud existuje) a `node --test src/services/emailIngest.test.js`
Expected: PASS — žádná regrese. Pokud `emailInbound.test.js` neexistuje, přeskoč a spolehni se na ruční ověření v Tasku 11.

- [ ] **Step 3: Commit**

```bash
git add src/routes/emailInbound.js
git commit -m "feat(push): trigger notifikace po ingestu příchozího e-mailu"
```

---

## Task 6: Settings route — čtení/zápis notify_scope

**Files:**
- Modify: `src/routes/settings.js:8-31`
- Test: `src/routes/settings.push.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/routes/settings.push.test.js` (stejný vzor jako Task 4 — express app + fetch):

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

function freshApp() {
  const tmp = path.join(os.tmpdir(), `spendex-settings-push-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection', '../db/schema', './settings']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection');
  require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'a@b.cz')").run();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
  app.use('/api/settings', require('./settings'));
  return { app, db, tmp };
}
function cleanup(db, tmp) {
  db.close();
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmp + s); } catch { /* ok */ } }
}
async function listen(app) {
  const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test('PUT /api/settings uloží notify_scope a GET ho vrátí', async () => {
  const { app, db, tmp } = freshApp();
  const { server, base } = await listen(app);
  await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ billing_day: 1, notify_scope: 'all' }) });
  const r = await fetch(`${base}/api/settings`);
  const j = await r.json();
  server.close(); cleanup(db, tmp);
  assert.equal(j.notify_scope, 'all');
});

test('PUT /api/settings odmítne neplatný notify_scope', async () => {
  const { app, db, tmp } = freshApp();
  const { server, base } = await listen(app);
  const r = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ billing_day: 1, notify_scope: 'haha' }) });
  server.close(); cleanup(db, tmp);
  assert.equal(r.status, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/routes/settings.push.test.js`
Expected: FAIL — `j.notify_scope` je `undefined`.

- [ ] **Step 3: Rozšířit settings router**

V `src/routes/settings.js` uprav GET (ř. 8–15):

```javascript
router.get('/', requireAuth, (req, res) => {
  const row = db.prepare('SELECT billing_day, notify_scope FROM settings WHERE user_id = ?').get(req.user.id);
  const billingDay = row?.billing_day ?? 1;
  const notifyScope = row?.notify_scope ?? 'pending_only';
  const currentKey = currentPeriodKey(billingDay);
  const periodKey = req.query.period || currentKey;
  const { start, end } = getPeriodDates(billingDay, periodKey);
  res.json({ billing_day: billingDay, notify_scope: notifyScope, current_period: currentKey, period_start: start, period_end: end });
});
```

A PUT (ř. 18–31):

```javascript
router.put('/', requireAuth, (req, res) => {
  const { billing_day, notify_scope } = req.body;
  const day = parseInt(billing_day, 10);
  if (!day || day < 1 || day > 31) return res.status(400).json({ error: 'billing_day musí být 1–31.' });

  const VALID_SCOPES = ['off', 'pending_only', 'all'];
  const scope = notify_scope === undefined ? undefined : String(notify_scope);
  if (scope !== undefined && !VALID_SCOPES.includes(scope)) {
    return res.status(400).json({ error: 'Neplatný notify_scope.' });
  }

  db.prepare(`
    INSERT INTO settings (user_id, billing_day, notify_scope)
    VALUES (?, ?, COALESCE(?, 'pending_only'))
    ON CONFLICT(user_id) DO UPDATE SET
      billing_day = excluded.billing_day,
      notify_scope = COALESCE(?, settings.notify_scope)
  `).run(req.user.id, day, scope ?? null, scope ?? null);

  const periodKey = currentPeriodKey(day);
  const { start, end } = getPeriodDates(day, periodKey);
  const row = db.prepare('SELECT notify_scope FROM settings WHERE user_id = ?').get(req.user.id);
  res.json({ billing_day: day, notify_scope: row.notify_scope, current_period: periodKey, period_start: start, period_end: end });
});
```

(Pozn.: `settings` má `user_id` jako PK / UNIQUE — `ON CONFLICT(user_id)` funguje, viz původní kód.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/routes/settings.push.test.js`
Expected: PASS (2 testy).

- [ ] **Step 5: Commit**

```bash
git add src/routes/settings.js src/routes/settings.push.test.js
git commit -m "feat(push): settings GET/PUT notify_scope s validací"
```

---

## Task 7: PWA shell — manifest, ikony, index.html

**Files:**
- Create: `client/public/manifest.webmanifest`
- Create: `scripts/gen-pwa-icons.js`
- Create: `client/public/icon-192.png`, `client/public/icon-512.png` (generované)
- Modify: `client/index.html`
- Modify: `package.json` (devDependency `sharp`)

- [ ] **Step 1: Manifest**

Create `client/public/manifest.webmanifest`:

```json
{
  "name": "Spendex",
  "short_name": "Spendex",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#111827",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 2: Generátor ikon**

Run: `npm install --save-dev sharp`

Create `scripts/gen-pwa-icons.js`:

```javascript
'use strict';
// Jednorázový generátor PWA ikon z client/public/favicon.svg.
// Spuštění: node scripts/gen-pwa-icons.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const pub = path.join(__dirname, '..', 'client', 'public');
const svg = fs.readFileSync(path.join(pub, 'favicon.svg'));

(async () => {
  for (const size of [192, 512]) {
    await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'contain', background: { r: 17, g: 24, b: 39, alpha: 1 } })
      .png()
      .toFile(path.join(pub, `icon-${size}.png`));
    console.log(`icon-${size}.png hotovo`);
  }
})();
```

- [ ] **Step 3: Vygeneruj ikony**

Run: `node scripts/gen-pwa-icons.js`
Expected: vzniknou `client/public/icon-192.png` a `client/public/icon-512.png`. Ověř: `ls -la client/public/icon-*.png`.

(Pokud `favicon.svg` neexistuje nebo sharp selže na SVG, fallback: vytvoř ikony z libovolného PNG loga 512×512 a downscale; v krajním případě dočasně použij plnou barvu `sharp({create:{width:512,height:512,channels:4,background:'#111827'}})`.)

- [ ] **Step 4: Zapoj manifest a ikony do index.html**

V `client/index.html` přidej do `<head>` (za `<link rel="icon" ...>`):

```html
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#111827" />
    <link rel="apple-touch-icon" href="/icon-192.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Spendex" />
```

- [ ] **Step 5: Ověř build**

Run: `cd /Users/tomas/app-spendex && npm run build`
Expected: build projde, `client/dist/manifest.webmanifest` a `client/dist/icon-*.png` existují (Vite kopíruje `public/` do `dist/`).

- [ ] **Step 6: Commit**

```bash
git add client/public/manifest.webmanifest client/public/icon-192.png client/public/icon-512.png client/index.html scripts/gen-pwa-icons.js package.json package-lock.json
git commit -m "feat(push): PWA shell — manifest, ikony, index.html"
```

---

## Task 8: Service worker

**Files:**
- Create: `client/public/sw.js`

- [ ] **Step 1: Service worker**

Create `client/public/sw.js`:

```javascript
/* Service worker pro Spendex — pouze push (žádné offline caching zatím). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'SPENDEX', body: 'Nová platba k zařazení', url: '/import' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (_e) { /* keep default */ }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/import' },
      tag: 'spendex-payment',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/import';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.focus(); c.navigate(url); return; }
      }
      return self.clients.openWindow(url);
    })
  );
});
```

- [ ] **Step 2: Ověř, že se servíruje z rootu**

Run: `cd /Users/tomas/app-spendex && npm run build && ls client/dist/sw.js`
Expected: `client/dist/sw.js` existuje (scope `/` vyžaduje servírování z kořene — `public/` to zajišťuje).

- [ ] **Step 3: Commit**

```bash
git add client/public/sw.js
git commit -m "feat(push): service worker (push + notificationclick → /import)"
```

---

## Task 9: Frontend helper push.js

**Files:**
- Create: `client/src/push.js`

- [ ] **Step 1: Helper**

Create `client/src/push.js`:

```javascript
// Web Push klientská logika. Bez frameworku, čisté fetch + Service Worker API.

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// True jen když appka běží jako nainstalovaná PWA (na iOS nutné pro push).
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export async function getRegistration() {
  return navigator.serviceWorker.register('/sw.js');
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await getRegistration();
  return reg.pushManager.getSubscription();
}

// Vyžádá povolení, zaregistruje a pošle subscription na backend. Vrací 'granted'|'denied'|'unsupported'.
export async function enablePush() {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission; // 'denied' | 'default'

  const reg = await getRegistration();
  const keyRes = await fetch('/api/push/public-key', { credentials: 'include' });
  const { publicKey } = await keyRes.json();
  if (!publicKey) throw new Error('VAPID public key chybí na serveru.');

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  const json = sub.toJSON();
  await fetch('/api/push/subscribe', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  return 'granted';
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (sub) {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
  }
}

export async function sendTestPush() {
  await fetch('/api/push/test', { method: 'POST', credentials: 'include' });
}
```

- [ ] **Step 2: Ověř, že se to zabuildí (import nikde zatím nepoužit — jen lint/build)**

Run: `cd /Users/tomas/app-spendex && npm run build`
Expected: build projde.

- [ ] **Step 3: Commit**

```bash
git add client/src/push.js
git commit -m "feat(push): frontend helper push.js (enable/disable/test)"
```

---

## Task 10: UI sekce Notifikace v Nastavení

**Files:**
- Modify: stránka Nastavení (najdi: `grep -rl "billing_day" client/src/pages`) — pravděpodobně `client/src/pages/SettingsPage.jsx`
- Modify: `client/src/i18n.js`

- [ ] **Step 1: Najdi a přečti stránku Nastavení**

Run: `grep -rl "billing_day\|/api/settings" client/src/pages`
Pak přečti nalezený soubor, ať navážeš na existující stav (jak načítá `/api/settings`, jak ukládá PUT).

- [ ] **Step 2: Přidej texty do i18n**

V `client/src/i18n.js` přidej do české slovníkové struktury (následuj existující tvar souboru) klíče:

```javascript
notifications_title: 'Notifikace',
notifications_enable: 'Zapnout notifikace na tomto zařízení',
notifications_enabled: 'Notifikace zapnuté ✅',
notifications_denied: 'Notifikace zakázané v prohlížeči — povol je v nastavení telefonu.',
notifications_ios_hint: 'Na iPhonu nejdřív přidej Spendex na plochu (Sdílet → Přidat na plochu) a otevři ho odtud.',
notifications_scope_label: 'Co notifikovat',
notifications_scope_off: 'Vypnuto',
notifications_scope_pending: 'Jen nezařazené platby',
notifications_scope_all: 'Všechny platby',
notifications_test: 'Poslat testovací notifikaci',
```

- [ ] **Step 3: Přidej sekci do stránky Nastavení**

Do komponenty Nastavení doplň novou sekci. Použij helpery z `../push`. Vzorová implementace (přizpůsob názvy stavů/handlerů existující stránce):

```jsx
import { useEffect, useState } from 'react';
import { pushSupported, isStandalone, enablePush, disablePush, currentSubscription, sendTestPush } from '../push';
// t() je z i18n.js – použij existující import na stránce

// ...uvnitř komponenty:
const [notifyScope, setNotifyScope] = useState('pending_only');
const [pushState, setPushState] = useState('unknown'); // 'on' | 'off' | 'denied' | 'unsupported'

useEffect(() => {
  // notify_scope přijde ze stejného GET /api/settings, který stránka už volá – nastav z něj setNotifyScope.
  (async () => {
    if (!pushSupported()) { setPushState('unsupported'); return; }
    const sub = await currentSubscription();
    setPushState(sub ? 'on' : 'off');
  })();
}, []);

async function handleEnable() {
  try {
    const r = await enablePush();
    if (r === 'granted') setPushState('on');
    else if (r === 'denied') setPushState('denied');
    else setPushState('unsupported');
  } catch (e) { alert('Nepodařilo se zapnout notifikace: ' + e.message); }
}

async function handleDisable() {
  await disablePush();
  setPushState('off');
}

async function saveScope(scope) {
  setNotifyScope(scope);
  // billing_day musí jít s PUT – pošli aktuální hodnotu, kterou stránka už drží ve stavu.
  await fetch('/api/settings', {
    method: 'PUT', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ billing_day: billingDay, notify_scope: scope }),
  });
}

// ...v JSX:
<section className="settings-section">
  <h2>{t('notifications_title')}</h2>

  {pushState === 'unsupported' && !isStandalone() && (
    <p className="hint">{t('notifications_ios_hint')}</p>
  )}
  {pushState === 'denied' && <p className="hint">{t('notifications_denied')}</p>}

  {pushState === 'off' && (
    <button onClick={handleEnable}>{t('notifications_enable')}</button>
  )}
  {pushState === 'on' && (
    <>
      <p>{t('notifications_enabled')}</p>
      <button onClick={handleDisable}>{t('notifications_scope_off')}</button>
      <button onClick={sendTestPush}>{t('notifications_test')}</button>
    </>
  )}

  <label>{t('notifications_scope_label')}</label>
  <select value={notifyScope} onChange={(e) => saveScope(e.target.value)}>
    <option value="off">{t('notifications_scope_off')}</option>
    <option value="pending_only">{t('notifications_scope_pending')}</option>
    <option value="all">{t('notifications_scope_all')}</option>
  </select>
</section>
```

Pozn.: `billingDay` ve `saveScope` je proměnná, kterou stránka už používá pro billing_day. Pokud se jmenuje jinak, použij existující název. Nastav `setNotifyScope` z odpovědi GET `/api/settings` v existujícím načítacím efektu stránky.

- [ ] **Step 4: Ověř build**

Run: `cd /Users/tomas/app-spendex && npm run build`
Expected: build projde bez chyb.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages client/src/i18n.js
git commit -m "feat(push): UI sekce Notifikace v Nastavení (zapnutí + rozsah + test)"
```

---

## Task 11: VAPID klíče, env, dokumentace a ruční ověření

**Files:**
- Create: `docs/push-setup.md`
- Modify: `.env.example` (pokud existuje)

- [ ] **Step 1: Vygeneruj VAPID klíče**

Run: `npx web-push generate-vapid-keys`
Zkopíruj `Public Key` a `Private Key`.

- [ ] **Step 2: Lokální .env**

Do `.env` (NE do gitu — ověř, že je v `.gitignore`) přidej:

```
VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:tomas.strida@gmail.com
```

Pokud existuje `.env.example`, přidej tam ty samé klíče s prázdnou hodnotou.

- [ ] **Step 3: Railway env**

Nastav stejné tři proměnné v Railway (staging i prod prostředí). Uživatel je vloží přes Railway dashboard nebo `railway variables`.

- [ ] **Step 4: Návod pro uživatele**

Create `docs/push-setup.md`:

```markdown
# Push notifikace — nastavení

## Server (jednorázově)
1. `npx web-push generate-vapid-keys`
2. Do Railway (staging i prod) přidej: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:tomas.strida@gmail.com`.

## Telefon (iPhone, každé zařízení)
1. Otevři `spendex.uk` v **Safari**.
2. Sdílet → **Přidat na plochu**.
3. Otevři Spendex **z ikony na ploše** (ne ze Safari).
4. Nastavení → **Zapnout notifikace** → povolit.
5. Tlačítkem **Poslat testovací notifikaci** ověř doručení.

## Rozsah
- Vypnuto / Jen nezařazené / Všechny platby — přepíná se v Nastavení.
```

- [ ] **Step 5: Ruční end-to-end ověření**

1. Lokálně/staging: zapni notifikace v PWA na iPhonu, pošli testovací push → musí dorazit.
2. Pošli na webhook `POST /api/email/inbound` reálný AirBank e-mail s neznámým obchodníkem (nebo simulací) → musí přijít push „… potřebuje kategorii" a klik otevřít `/import`.
3. Přepni rozsah na „Vypnuto" → push nepřijde. Na „Všechny platby" → přijde i u auto-zařazené.

- [ ] **Step 6: Commit a push do staging**

```bash
git add docs/push-setup.md
git commit -m "docs(push): návod na VAPID klíče a aktivaci na iPhonu"
git push origin staging
```

---

## Self-Review (provedeno při psaní plánu)

- **Spec coverage:** manifest/SW/ikony (T7,T8), subscribe flow (T4,T9), tabulka push_subscriptions (T1), pushNotify + mazání 410 (T2), trigger pending/all (T3,T5), notify_scope off/pending/all (T1,T6,T10), obsah notifikace částka+obchodník (T2 `formatBody`), error best-effort (T5), iOS návod (T11), testy (T1,T2,T4,T6) — vše pokryto.
- **Type/naming konzistence:** `notifyForResult(db, result, client)`, `sendToUser(db, userId, payload, client)`, `result.notify = {amount, currency, merchant, categoryName}`, `notify_scope ∈ {off, pending_only, all}` — používáno konzistentně napříč T2/T3/T5/T6.
- **Bez placeholderů:** každý krok má konkrétní kód a příkaz.
- **Riziko k ověření při exekuci:** přesný tvar `client/src/i18n.js` (slovník vs. funkce) a název stránky Nastavení — proto T10 začíná `grep`/Read krokem místo natvrdo dané cesty.
