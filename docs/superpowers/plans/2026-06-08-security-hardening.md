# Security hardening batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Opravit ověřené nálezy z bezpečnostního auditu (IDOR na FK, chybějící validace, CSRF/sameSite, rate-limit e-mailů, helmet, import limity, webhook hardening, verify expirace, HTML-escape) bez rozbití OAuth/Worker flow.

**Architecture:** Sada nezávislých, malých fixů po doménách. Žádný nový subsystém. Helmet bez CSP. sameSite=lax kvůli OAuth.

**Tech Stack:** Express, better-sqlite3, helmet, express-rate-limit, node:crypto, `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-08-security-hardening-design.md`

**Konvence:** testy `node --test <file>`; route testy vzorem express-app + `app.listen(0)` + `fetch` s fake auth middleware (`req.user={id:1}; req.isAuthenticated=()=>true`) — viz `src/routes/push.test.js`. Commit do `staging`.

---

## Task 1: Schema — sloupec users.verify_expires

**Files:** Modify `src/db/schema.js`; Test `src/db/schema.verify-expires.test.js` (Create)

- [ ] **Step 1: Failing test** — Create `src/db/schema.verify-expires.test.js`:
```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-verifyexp-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('./connection')];
  delete require.cache[require.resolve('./schema')];
  const db = require('./connection'); require('./schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
test('users má sloupec verify_expires', () => {
  const { db, tmp } = freshDb();
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c=>c.name);
  cleanup(db, tmp);
  assert.ok(cols.includes('verify_expires'), 'chybí verify_expires');
});
```
- [ ] **Step 2:** `node --test src/db/schema.verify-expires.test.js` → FAIL (no such column).
- [ ] **Step 3:** Do pole migrací v `src/db/schema.js` (za poslední položku před `];`) přidej:
```javascript
    'ALTER TABLE users ADD COLUMN verify_expires INTEGER',
```
- [ ] **Step 4:** `node --test src/db/schema.verify-expires.test.js` → PASS.
- [ ] **Step 5: Commit**
```bash
git add src/db/schema.js src/db/schema.verify-expires.test.js
git commit -m "feat(security): users.verify_expires sloupec"
```

---

## Task 2: transactions — ověření vlastníka kategorie + validace vstupu

**Files:** Modify `src/routes/transactions.js` (POST `:126-136`, PATCH `:139-157`); Test `src/routes/transactions.security.test.js` (Create)

- [ ] **Step 1: Failing test** — Create `src/routes/transactions.security.test.js`:
```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const express = require('express');
function freshApp() {
  const tmp = path.join(os.tmpdir(), `spendex-tx-sec-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./transactions']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO users (id, email) VALUES (2,'c@d.cz')").run();
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (10, 2, 'CizíKat')").run(); // patří userovi 2
  db.prepare("INSERT INTO categories (id, user_id, name) VALUES (11, 1, 'MojeKat')").run();
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:1}; req.isAuthenticated=()=>true; next(); });
  app.use('/api/transactions', require('./transactions'));
  return { app, db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }
function post(base, body){ return fetch(`${base}/api/transactions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}); }

test('POST s cizí category_id → 400', async () => {
  const { app, db, tmp } = freshApp(); const { server, base } = await listen(app);
  const r = await post(base, { amount: -100, date: '2026-06-08', category_id: 10 });
  server.close(); cleanup(db, tmp);
  assert.equal(r.status, 400);
});
test('POST s vlastní category_id → 201', async () => {
  const { app, db, tmp } = freshApp(); const { server, base } = await listen(app);
  const r = await post(base, { amount: -100, date: '2026-06-08', category_id: 11 });
  server.close(); cleanup(db, tmp);
  assert.equal(r.status, 201);
});
test('POST amount=0 projde (regrese), amount="abc" → 400, date špatný → 400', async () => {
  const { app, db, tmp } = freshApp(); const { server, base } = await listen(app);
  const ok = await post(base, { amount: 0, date: '2026-06-08' });
  const badAmt = await post(base, { amount: 'abc', date: '2026-06-08' });
  const badDate = await post(base, { amount: -5, date: '8.6.2026' });
  server.close(); cleanup(db, tmp);
  assert.equal(ok.status, 201);
  assert.equal(badAmt.status, 400);
  assert.equal(badDate.status, 400);
});
```
- [ ] **Step 2:** `node --test src/routes/transactions.security.test.js` → FAIL (cizí kategorie projde, amount=0 odmítnuto).
- [ ] **Step 3:** V `src/routes/transactions.js` nahraď POST handler (`:126-136`) za:
```javascript
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { amount, currency, date, description, note, category_id } = req.body;
  const amt = Number(amount);
  if (!Number.isFinite(amt)) return res.status(400).json({ error: 'Částka musí být číslo.' });
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Datum musí být ve formátu YYYY-MM-DD.' });
  if (category_id != null) {
    const owned = db.prepare('SELECT 1 FROM categories WHERE id = ? AND user_id = ?').get(category_id, req.user.id);
    if (!owned) return res.status(400).json({ error: 'Neplatná kategorie.' });
  }
  const cur = (currency && String(currency).slice(0, 8)) || 'CZK';
  const desc = description != null ? String(description).slice(0, 500) : '';
  const nt = note != null ? String(note).slice(0, 500) : '';
  const result = db.prepare(
    'INSERT INTO transactions (user_id, category_id, amount, currency, date, description, note, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, category_id || null, amt, cur, date, desc, nt, 'manual');
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});
```
- [ ] **Step 4:** V `src/routes/transactions.js` nahraď PATCH handler (`:139-157`) za:
```javascript
router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!tx) return res.status(404).json({ error: 'Transakce nenalezena.' });
  const { amount, currency, date, description, note, category_id } = req.body;
  if (amount !== undefined && !Number.isFinite(Number(amount))) return res.status(400).json({ error: 'Částka musí být číslo.' });
  if (date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) return res.status(400).json({ error: 'Datum musí být ve formátu YYYY-MM-DD.' });
  if (category_id !== undefined && category_id !== null) {
    const owned = db.prepare('SELECT 1 FROM categories WHERE id = ? AND user_id = ?').get(category_id, req.user.id);
    if (!owned) return res.status(400).json({ error: 'Neplatná kategorie.' });
  }
  db.prepare(
    'UPDATE transactions SET amount = ?, currency = ?, date = ?, description = ?, note = ?, category_id = ? WHERE id = ?'
  ).run(
    amount !== undefined ? Number(amount) : tx.amount,
    currency !== undefined ? String(currency).slice(0, 8) : tx.currency,
    date ?? tx.date,
    description !== undefined ? String(description).slice(0, 500) : tx.description,
    note !== undefined ? String(note).slice(0, 500) : tx.note,
    category_id !== undefined ? category_id : tx.category_id,
    tx.id
  );
  res.json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id));
});
```
- [ ] **Step 5:** `node --test src/routes/transactions.security.test.js` → PASS. Také `node --test src/routes/transactions.test.js` pokud existuje → no regrese.
- [ ] **Step 6: Commit**
```bash
git add src/routes/transactions.js src/routes/transactions.security.test.js
git commit -m "feat(security): transakce — ověření vlastníka kategorie + validace amount/date"
```

---

## Task 3: auth — emailLimiter, /verify limiter + expirace

**Files:** Modify `src/routes/auth.js`; Test `src/routes/auth.security.test.js` (Create)

- [ ] **Step 1: Failing test** — Create `src/routes/auth.security.test.js` (testuje jen verify expiraci — limiter se ověří manuálně/load):
```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const express = require('express');
function freshApp() {
  const tmp = path.join(os.tmpdir(), `spendex-auth-sec-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./auth','../services/passport']) { try { delete require.cache[require.resolve(m)]; } catch {/* ok */} }
  const db = require('../db/connection'); require('../db/schema').initSchema();
  const app = express(); app.use(express.json());
  app.use('/auth', require('./auth'));
  return { app, db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

test('/auth/verify s prošlým tokenem → redirect na invalid_token', async () => {
  const { app, db, tmp } = freshApp();
  db.prepare("INSERT INTO users (id, email, verify_token, verify_expires) VALUES (1, 'a@b.cz', 'tok', ?)").run(Date.now() - 1000);
  const { server, base } = await listen(app);
  const r = await fetch(`${base}/auth/verify?token=tok`, { redirect: 'manual' });
  server.close(); cleanup(db, tmp);
  assert.ok(r.status >= 300 && r.status < 400);
  assert.match(r.headers.get('location') || '', /invalid_token/);
});
test('/auth/verify s platným tokenem → projde (redirect na /)', async () => {
  const { app, db, tmp } = freshApp();
  db.prepare("INSERT INTO users (id, email, verify_token, verify_expires) VALUES (1, 'a@b.cz', 'tok2', ?)").run(Date.now() + 3600_000);
  const { server, base } = await listen(app);
  const r = await fetch(`${base}/auth/verify?token=tok2`, { redirect: 'manual' });
  const verified = db.prepare("SELECT email_verified FROM users WHERE id=1").get().email_verified;
  server.close(); cleanup(db, tmp);
  assert.equal(verified, 1);
});
```
Pozn.: `/verify` volá `req.login` (passport). V testovacím app bez passport.initialize to může spadnout — proto handler musí být odolný: pokud `req.login` není funkce, jen přesměruj. Zohledni v implementaci (Step 3).
- [ ] **Step 2:** `node --test src/routes/auth.security.test.js` → FAIL.
- [ ] **Step 3:** V `src/routes/auth.js`:
  (a) Za `const authLimiter = ...` (`:10`) přidej:
```javascript
const emailLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });
```
  (b) `/register` (`:22`) — přidej `emailLimiter` do middleware řetězce: `router.post('/register', authLimiter, emailLimiter, async (req, res) => {`. Uvnitř po vygenerování tokenu nastav expiraci — změň INSERT (`:33-35`) na:
```javascript
    const verifyExpires = Date.now() + 24 * 60 * 60 * 1000;
    db.prepare(
      'INSERT INTO users (email, name, password_hash, verify_token, verify_expires) VALUES (?, ?, ?, ?, ?)'
    ).run(email, name || email.split('@')[0], hash, token, verifyExpires);
```
  (c) `/verify` (`:46`) — přidej `authLimiter` a kontrolu expirace + odolnost vůči chybějícímu `req.login`:
```javascript
router.get('/verify', authLimiter, (req, res) => {
  const { token } = req.query;
  const user = db.prepare('SELECT * FROM users WHERE verify_token = ?').get(token);
  if (!user) return res.redirect('/login?error=invalid_token');
  if (user.verify_expires != null && user.verify_expires < Date.now()) {
    return res.redirect('/login?error=invalid_token');
  }
  db.prepare('UPDATE users SET email_verified = 1, verify_token = NULL, verify_expires = NULL WHERE id = ?').run(user.id);
  if (typeof req.login === 'function') return req.login(user, () => res.redirect('/'));
  return res.redirect('/');
});
```
  (d) `/forgot` (`:61`) — přidej `emailLimiter`: `router.post('/forgot', authLimiter, emailLimiter, async (req, res) => {`.
- [ ] **Step 4:** `node --test src/routes/auth.security.test.js` → PASS.
- [ ] **Step 5: Commit**
```bash
git add src/routes/auth.js src/routes/auth.security.test.js
git commit -m "feat(security): auth — emailLimiter na register/forgot, limiter+expirace na verify"
```

---

## Task 4: index.js — helmet, sameSite, urlencoded limit

**Files:** Modify `src/index.js`; `package.json` (helmet)

- [ ] **Step 1:** `npm install helmet`
- [ ] **Step 2:** V `src/index.js`:
  (a) Nahoře k importům přidej `const helmet = require('helmet');`
  (b) Hned za `app.set('trust proxy', 1);` (`:20`) přidej:
```javascript
app.use(helmet({ contentSecurityPolicy: false }));
```
  (c) `express.urlencoded` (`:24`) → přidej limit:
```javascript
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
```
  (d) session cookie (`:32-36`) → přidej `sameSite: 'lax'`:
```javascript
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
```
- [ ] **Step 3: Ověření** (helmet/cookie nemají snadný unit test — ověř integrací):
Run: `node -e "const e=require('helmet'); console.log(typeof e)"` → `function`.
Run: `node -e "require('./src/index.js')" ` **NESPOUŠTĚJ** (nastartuje server). Místo toho ověř syntax: `node --check src/index.js` → OK.
Manuální (volitelně po deploy): `curl -sI https://<staging>/health | grep -i "x-frame-options\|strict-transport"`.
- [ ] **Step 4:** Spusť celou sadu: `node --test 'src/**/*.test.js' 2>&1 | grep -E "^# (tests|pass|fail)"` → 0 fail.
- [ ] **Step 5: Commit**
```bash
git add src/index.js package.json package-lock.json
git commit -m "feat(security): helmet (bez CSP) + cookie sameSite=lax + urlencoded limit"
```

---

## Task 5: import — rate-limit + stropy + filename sanitizace

**Files:** Modify `src/routes/import.js`

- [ ] **Step 1:** `/preview` (`:15`) — přidej `writeLimiter`, sniž limit na 2mb, přidej strop řádků:
```javascript
router.post('/preview', requireAuth, writeLimiter, express.text({ limit: '2mb', type: '*/*' }), (req, res) => {
  try {
    const transactions = parseAirBankCSV(req.body);
    if (!transactions.length) return res.status(400).json({ error: 'CSV neobsahuje žádné transakce.' });
    if (transactions.length > 5000) return res.status(400).json({ error: 'Příliš velký výpis (> 5000 transakcí).' });
```
(zbytek handleru beze změny)
- [ ] **Step 2:** `/confirm` (`:65-67`) — přidej `writeLimiter` a strop délky:
```javascript
router.post('/confirm', requireAuth, writeLimiter, (req, res) => {
  const { transactions, ... } = req.body; // zachovej stávající destrukturalizaci
  if (!Array.isArray(transactions)) return res.status(400).json({ error: 'Neplatná data.' });
  if (transactions.length > 5000) return res.status(400).json({ error: 'Příliš mnoho transakcí (> 5000).' });
```
POZOR: zachovej přesnou stávající destrukturalizaci z řádku 66 (přečti ji a doplň jen kontrolu délky za `Array.isArray`).
- [ ] **Step 3:** Content-Disposition (`:237`) — sanitizuj filename:
```javascript
  const safeName = String(row.filename || 'export.csv').replace(/[^\w.\- ]+/g, '_').slice(0, 100);
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
```
- [ ] **Step 4: Ověření:** `node --check src/routes/import.js` → OK. Pokud existuje `src/routes/import.test.js`, spusť → no regrese. Jinak `node -e "require('./src/routes/import.js'); console.log('ok')"` → `ok`.
- [ ] **Step 5: Commit**
```bash
git add src/routes/import.js
git commit -m "feat(security): import — rate-limit, stropy velikosti/řádků, sanitizace filename"
```

---

## Task 6: emailInbound — constant-time secret + raw size bound

**Files:** Modify `src/routes/emailInbound.js`; Test `src/routes/emailInbound.security.test.js` (Create)

- [ ] **Step 1: Failing test** — Create `src/routes/emailInbound.security.test.js`:
```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
function freshApp() {
  process.env.EMAIL_WEBHOOK_SECRET = 'sekret';
  process.env.EMAIL_ALLOWED_SENDER = 'tom@example.com';
  for (const m of ['./emailInbound']) { try { delete require.cache[require.resolve(m)]; } catch {/* ok */} }
  const app = express(); app.use(express.json({ limit: '10mb' }));
  app.use('/api/email', require('./emailInbound'));
  return app;
}
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

test('špatný secret → 401', async () => {
  const app = freshApp(); const { server, base } = await listen(app);
  const r = await fetch(`${base}/api/email/inbound?secret=spatne`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ from:'x@airbank.cz', raw:'tom@example.com' }) });
  server.close();
  assert.equal(r.status, 401);
});
test('raw > 1MB → 413', async () => {
  const app = freshApp(); const { server, base } = await listen(app);
  const big = 'tom@example.com' + 'x'.repeat(1_000_001);
  const r = await fetch(`${base}/api/email/inbound?secret=sekret`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ from:'info@airbank.cz', raw: big }) });
  server.close();
  assert.equal(r.status, 413);
});
```
- [ ] **Step 2:** `node --test src/routes/emailInbound.security.test.js` → FAIL (raw bomb projde / 400 místo 413).
- [ ] **Step 3:** V `src/routes/emailInbound.js`:
  (a) `checkSecret` (`:12-17`) — timing-safe:
```javascript
function checkSecret(req, res, next) {
  const expected = process.env.EMAIL_WEBHOOK_SECRET;
  const got = req.query.secret || req.get('x-webhook-secret') || '';
  if (!expected) return res.status(401).json({ error: 'unauthorized' });
  const a = Buffer.from(String(got));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}
```
  Přidej nahoru `const crypto = require('crypto');` (pokud tam ještě není).
  (b) Strop raw — uvnitx handleru hned po `const { envelope_from = '', from = '', raw = '' } = req.body || {};` přidej:
```javascript
    if (typeof raw === 'string' && raw.length > 1_000_000) {
      return res.status(413).json({ error: 'Příliš velká zpráva.' });
    }
```
- [ ] **Step 4:** `node --test src/routes/emailInbound.security.test.js` → PASS.
- [ ] **Step 5: Commit**
```bash
git add src/routes/emailInbound.js src/routes/emailInbound.security.test.js
git commit -m "feat(security): webhook — timingSafeEqual secret + strop raw MIME"
```

---

## Task 7: email.js — HTML-escape name

**Files:** Modify `src/services/email.js`; Test `src/services/email.security.test.js` (Create)

- [ ] **Step 1: Failing test** — Create `src/services/email.security.test.js`:
```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml } = require('./email');
test('escapeHtml escapuje nebezpečné znaky', () => {
  assert.equal(escapeHtml('<script>&"\''), '&lt;script&gt;&amp;&quot;&#39;');
});
```
- [ ] **Step 2:** `node --test src/services/email.security.test.js` → FAIL (escapeHtml není exportován).
- [ ] **Step 3:** V `src/services/email.js`:
  (a) Přidej helper (nahoře po konstantách):
```javascript
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
```
  (b) V `sendVerificationEmail` (`:35`) a `sendPasswordResetEmail` (`:50`) nahraď `${name || ''}` za `${escapeHtml(name || '')}`. (URL je z uuid tokenu, escapovat netřeba, ale je bezpečné nechat.)
  (c) Přidej `escapeHtml` do `module.exports`.
- [ ] **Step 4:** `node --test src/services/email.security.test.js` → PASS.
- [ ] **Step 5: Commit + push**
```bash
git add src/services/email.js src/services/email.security.test.js
git commit -m "feat(security): HTML-escape name v odchozích e-mailech"
git push origin staging
```

---

## Self-Review (provedeno při psaní plánu)

- **Spec coverage:** #1 kategorie-ownership (T2), #2 sameSite (T4), #3 amount/date validace (T2), #4 emailLimiter+/verify (T3), #5 helmet (T4), #6 import limity (T5), #7 webhook timingSafe (T6), #8 raw bound (T6), #9 verify expirace (T1+T3), #10 urlencoded+escapeHtml+filename (T4/T7/T5) — vše pokryto.
- **Placeholdery:** žádné; každý krok má konkrétní kód. Výjimka označená: T5/Step2 vyžaduje zachovat stávající destrukturalizaci `/confirm` (přečíst ř. 66) — záměrné, aby se nerozbila existující pole.
- **Konzistence:** `escapeHtml`, `emailLimiter`, `verify_expires`, `writeLimiter` názvy konzistentní. sameSite=lax (ne strict). helmet `contentSecurityPolicy:false`.
- **Riziko:** sameSite=lax ověřeně nerozbije OAuth (callback je top-level GET). Helmet bez CSP nerozbije frontend. Limity importu 5000/2MB dle schváleného specu. `/verify` handler odolný vůči chybějícímu passportu v testu.
