# Household Phase 2 (Invite flow + UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Invite-kód flow + správa členství + sekce „Domácnost" v Nastavení, postavené na Fázi 1 (membership + resolution už existují).

**Architecture:** Nová tabulka `household_invites` (max 1 token/vlastník), router `/api/household` (GET stav, invite, join, leave, remove člena), UI sekce v Nastavení dle role. Operuje na membership grafu klíčovaném `req.user.id` (identita), NE na sdílených datech.

**Tech Stack:** Express, better-sqlite3, node:crypto, React/Vite, `node:test`.

**Spec:** `docs/superpowers/specs/2026-06-08-household-phase2-invite-design.md`

**Konvence:** testy `node --test <file>` (multi-file glob v tomto prostředí flakuje → per-file); route testy express-app + `app.listen(0)` + `fetch`, fake auth nastaví `req.user` (+ isAuthenticated); requireAuth inline v routeru si dopočítá req.dataUserId sám. Commit do `staging`.

---

## Task 1: Tabulka household_invites

**Files:** Modify `src/db/schema.js`; Test `src/db/schema.invites.test.js` (Create)

- [ ] **Step 1: Failing test** — Create `src/db/schema.invites.test.js`:
```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-invites-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  delete require.cache[require.resolve('./connection')];
  delete require.cache[require.resolve('./schema')];
  const db = require('./connection'); require('./schema').initSchema();
  return { db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
test('household_invites má očekávané sloupce', () => {
  const { db, tmp } = freshDb();
  const cols = db.prepare("PRAGMA table_info(household_invites)").all().map(c=>c.name);
  cleanup(db, tmp);
  for (const c of ['id','data_owner_id','token','created_at']) assert.ok(cols.includes(c), `chybí ${c}`);
});
test('household_invites.data_owner_id je UNIQUE (1 pozvánka/vlastník)', () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'a@b.cz')").run();
  db.prepare("INSERT INTO household_invites (data_owner_id, token) VALUES (1, 'tok1')").run();
  let threw=false; try { db.prepare("INSERT INTO household_invites (data_owner_id, token) VALUES (1, 'tok2')").run(); } catch { threw=true; }
  cleanup(db, tmp);
  assert.ok(threw, 'druhá pozvánka pro stejného vlastníka měla selhat');
});
```

- [ ] **Step 2:** `node --test src/db/schema.invites.test.js` → FAIL (no such table).

- [ ] **Step 3:** V `src/db/schema.js` přidej do hlavního `db.exec` bloku:
```sql
    CREATE TABLE IF NOT EXISTS household_invites (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      data_owner_id INTEGER NOT NULL UNIQUE,
      token         TEXT NOT NULL UNIQUE,
      created_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (data_owner_id) REFERENCES users(id) ON DELETE CASCADE
    );
```

- [ ] **Step 4:** `node --test src/db/schema.invites.test.js` → PASS (2 testy).

- [ ] **Step 5: Commit**
```bash
git add src/db/schema.js src/db/schema.invites.test.js
git commit -m "feat(household): tabulka household_invites"
```

---

## Task 2: Router /api/household

**Files:** Create `src/routes/household.js`; Modify `src/index.js` (mount); Test `src/routes/household.test.js` (Create)

- [ ] **Step 1: Failing test** — Create `src/routes/household.test.js`:
```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const express = require('express');

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-household-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./household']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email, name) VALUES (1,'owner@x','Owner'),(2,'member@x','Member'),(3,'solo@x','Solo')").run();
  return { db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
function appFor(uid){
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:uid}; req.isAuthenticated=()=>true; next(); });
  app.use('/api/household', require('./household'));
  return app;
}
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }
function jpost(base, p, body){ return fetch(`${base}${p}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})}); }

test('invite → join → membership vznikne a kód se spotřebuje', async () => {
  const { db, tmp } = setup();
  // owner (1) vygeneruje kód
  let l = await listen(appFor(1));
  const { code } = await (await jpost(l.base, '/api/household/invite')).json();
  l.server.close();
  assert.ok(code && code.length > 10);
  // member (2) se připojí
  l = await listen(appFor(2));
  const r = await jpost(l.base, '/api/household/join', { code });
  l.server.close();
  assert.equal(r.status, 200);
  const mem = db.prepare("SELECT data_owner_id FROM household_members WHERE user_id = 2").get();
  const invGone = db.prepare("SELECT 1 FROM household_invites WHERE token = ?").get(code);
  cleanup(db, tmp);
  assert.equal(mem.data_owner_id, 1);
  assert.equal(invGone, undefined);
});

test('join: vlastní domácnost → 400, neplatný kód → 400', async () => {
  const { db, tmp } = setup();
  const l = await listen(appFor(1));
  const { code } = await (await jpost(l.base, '/api/household/invite')).json();
  const own = await jpost(l.base, '/api/household/join', { code });        // vlastník svým kódem
  const bad = await jpost(l.base, '/api/household/join', { code: 'neexistuje' });
  l.server.close(); cleanup(db, tmp);
  assert.equal(own.status, 400);
  assert.equal(bad.status, 400);
});

test('join: už člen → 409', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run(); // user2 už člen
  db.prepare("INSERT INTO household_invites (data_owner_id, token) VALUES (3, 'kod3')").run(); // pozvánka od jiného (user3)
  const l = await listen(appFor(2));
  const r = await jpost(l.base, '/api/household/join', { code: 'kod3' });
  l.server.close(); cleanup(db, tmp);
  assert.equal(r.status, 409);
});

test('member nesmí generovat pozvánku → 403', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  const l = await listen(appFor(2));
  const r = await jpost(l.base, '/api/household/invite');
  l.server.close(); cleanup(db, tmp);
  assert.equal(r.status, 403);
});

test('leave smaže membership; ne-člen → 400', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  let l = await listen(appFor(2));
  const ok = await jpost(l.base, '/api/household/leave');
  l.server.close();
  const gone = db.prepare("SELECT 1 FROM household_members WHERE user_id = 2").get();
  // ne-člen (3)
  l = await listen(appFor(3));
  const no = await jpost(l.base, '/api/household/leave');
  l.server.close(); cleanup(db, tmp);
  assert.equal(ok.status, 200);
  assert.equal(gone, undefined);
  assert.equal(no.status, 400);
});

test('owner odebere člena; cizí/neexistující → 404', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  // owner (1) odebere člena 2
  let l = await listen(appFor(1));
  const ok = await fetch(`${l.base}/api/household/members/2`, { method:'DELETE' });
  l.server.close();
  const gone = db.prepare("SELECT 1 FROM household_members WHERE user_id = 2").get();
  // znovu vlož; user 3 (cizí) se pokusí odebrat člena 2 z domácnosti 1 → 404 (není jeho)
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  l = await listen(appFor(3));
  const no = await fetch(`${l.base}/api/household/members/2`, { method:'DELETE' });
  l.server.close(); cleanup(db, tmp);
  assert.equal(ok.status, 200);
  assert.equal(gone, undefined);
  assert.equal(no.status, 404);
});

test('GET / vrací role solo/owner/member', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  let l = await listen(appFor(1)); const owner = await (await fetch(`${l.base}/api/household`)).json(); l.server.close();
  l = await listen(appFor(2)); const member = await (await fetch(`${l.base}/api/household`)).json(); l.server.close();
  l = await listen(appFor(3)); const solo = await (await fetch(`${l.base}/api/household`)).json(); l.server.close();
  cleanup(db, tmp);
  assert.equal(owner.role, 'owner');
  assert.ok(owner.members.some(m=>m.user_id===2));
  assert.equal(member.role, 'member');
  assert.equal(member.owner.id, 1);
  assert.equal(solo.role, 'solo');
});
```

- [ ] **Step 2:** `node --test src/routes/household.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement** `src/routes/household.js`:
```javascript
'use strict';
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

function roleOf(userId) {
  const asMember = db.prepare('SELECT data_owner_id FROM household_members WHERE user_id = ?').get(userId);
  if (asMember) return { role: 'member', ownerId: asMember.data_owner_id };
  const members = db.prepare('SELECT 1 FROM household_members WHERE data_owner_id = ? LIMIT 1').get(userId);
  return { role: members ? 'owner' : 'solo', ownerId: userId };
}

// GET /api/household
router.get('/', requireAuth, (req, res) => {
  const { role } = roleOf(req.user.id);
  if (role === 'member') {
    const m = db.prepare('SELECT data_owner_id FROM household_members WHERE user_id = ?').get(req.user.id);
    const owner = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(m.data_owner_id);
    return res.json({ role, owner });
  }
  const members = db.prepare(`
    SELECT hm.user_id, u.name, u.email
    FROM household_members hm JOIN users u ON u.id = hm.user_id
    WHERE hm.data_owner_id = ?
  `).all(req.user.id);
  const inv = db.prepare('SELECT token FROM household_invites WHERE data_owner_id = ?').get(req.user.id);
  res.json({ role, members, invite_code: inv ? inv.token : null });
});

// POST /api/household/invite — generuje/přegeneruje (jen solo/owner)
router.post('/invite', requireAuth, writeLimiter, (req, res) => {
  const { role } = roleOf(req.user.id);
  if (role === 'member') return res.status(403).json({ error: 'Člen nemůže vytvořit pozvánku.' });
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare(`
    INSERT INTO household_invites (data_owner_id, token) VALUES (?, ?)
    ON CONFLICT(data_owner_id) DO UPDATE SET token = excluded.token, created_at = datetime('now')
  `).run(req.user.id, token);
  res.json({ code: token });
});

// POST /api/household/join { code }
router.post('/join', requireAuth, writeLimiter, (req, res) => {
  const { code } = req.body || {};
  const inv = db.prepare('SELECT data_owner_id FROM household_invites WHERE token = ?').get(code || '');
  if (!inv) return res.status(400).json({ error: 'Neplatný kód.' });
  if (inv.data_owner_id === req.user.id) return res.status(400).json({ error: 'Nelze se připojit do vlastní domácnosti.' });
  const iHaveMembers = db.prepare('SELECT 1 FROM household_members WHERE data_owner_id = ? LIMIT 1').get(req.user.id);
  if (iHaveMembers) return res.status(409).json({ error: 'Nejdřív odeber členy své domácnosti.' });
  const already = db.prepare('SELECT 1 FROM household_members WHERE user_id = ?').get(req.user.id);
  if (already) return res.status(409).json({ error: 'Už jsi ve sdílené domácnosti.' });
  db.transaction(() => {
    db.prepare('INSERT INTO household_members (data_owner_id, user_id) VALUES (?, ?)').run(inv.data_owner_id, req.user.id);
    db.prepare('DELETE FROM household_invites WHERE token = ?').run(code);
  })();
  res.json({ ok: true });
});

// POST /api/household/leave
router.post('/leave', requireAuth, writeLimiter, (req, res) => {
  const r = db.prepare('DELETE FROM household_members WHERE user_id = ?').run(req.user.id);
  if (r.changes === 0) return res.status(400).json({ error: 'Nejsi ve sdílené domácnosti.' });
  res.json({ ok: true });
});

// DELETE /api/household/members/:userId — vlastník odebere člena ze SVÉ domácnosti
router.delete('/members/:userId', requireAuth, writeLimiter, (req, res) => {
  const uid = parseInt(req.params.userId, 10);
  if (!uid) return res.status(400).json({ error: 'Neplatný uživatel.' });
  const r = db.prepare('DELETE FROM household_members WHERE user_id = ? AND data_owner_id = ?').run(uid, req.user.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Člen nenalezen.' });
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 4: Mount** — v `src/index.js` za řádek `app.use('/api/push', ...)` přidej:
```javascript
app.use('/api/household', require('./routes/household'));
```

- [ ] **Step 5:** `node --test src/routes/household.test.js` → PASS (6 testů).

- [ ] **Step 6: Commit**
```bash
git add src/routes/household.js src/index.js src/routes/household.test.js
git commit -m "feat(household): router /api/household (invite/join/leave/remove)"
```

---

## Task 3: Frontend — sekce „Domácnost" v Nastavení

**Files:** Modify `client/src/pages/SettingsPage.jsx`; Modify `client/src/i18n.js`

- [ ] **Step 1:** READ `client/src/pages/SettingsPage.jsx` (zvlášť existující sekci Notifikace — stejný vzor: `.card`, `form-hint`, `btn-secondary`, i18n přes `t.settings.*`). READ jak jiné sekce volají API.

- [ ] **Step 2:** Přidej i18n texty do `cs.settings` v `client/src/i18n.js`:
```javascript
household_title: 'Domácnost',
household_solo: 'Nejsi ve sdílené domácnosti.',
household_create_invite: 'Vytvořit pozvánku',
household_regenerate: 'Přegenerovat kód',
household_code_label: 'Kód pozvánky (pošli ho druhému členovi):',
household_join_label: 'Připojit se kódem',
household_join: 'Připojit',
household_owner_members: 'Členové domácnosti:',
household_remove: 'Odebrat',
household_member_of: 'Jsi ve sdílené domácnosti — vlastník:',
household_leave: 'Odejít z domácnosti',
household_join_bad: 'Neplatný kód.',
household_joined: 'Připojeno ✅',
```

- [ ] **Step 3:** Přidej sekci „Domácnost" do SettingsPage (přizpůsob názvy stavů/tříd realitě stránky). Vzor:
```jsx
// stav
const [household, setHousehold] = useState(null);
const [joinCode, setJoinCode] = useState('');
const [hhMsg, setHhMsg] = useState('');

async function loadHousehold() {
  const r = await fetch('/api/household', { credentials: 'include' });
  setHousehold(await r.json());
}
useEffect(() => { loadHousehold(); }, []);

async function createInvite() {
  await fetch('/api/household/invite', { method: 'POST', credentials: 'include' });
  loadHousehold();
}
async function joinHousehold() {
  const r = await fetch('/api/household/join', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: joinCode.trim() }) });
  if (r.ok) { setHhMsg(t.settings.household_joined); setJoinCode(''); loadHousehold(); }
  else { const j = await r.json().catch(()=>({})); setHhMsg(j.error || t.settings.household_join_bad); }
}
async function leaveHousehold() { await fetch('/api/household/leave', { method: 'POST', credentials: 'include' }); loadHousehold(); }
async function removeMember(uid) { await fetch(`/api/household/members/${uid}`, { method: 'DELETE', credentials: 'include' }); loadHousehold(); }

// JSX (přizpůsob className existující stránce)
<section className="card">
  <h2>{t.settings.household_title}</h2>
  {household && household.role === 'member' && (
    <>
      <p>{t.settings.household_member_of} {household.owner?.name || household.owner?.email}</p>
      <button className="btn-secondary" onClick={leaveHousehold}>{t.settings.household_leave}</button>
    </>
  )}
  {household && household.role !== 'member' && (
    <>
      {household.role === 'solo' && <p className="form-hint">{t.settings.household_solo}</p>}
      {household.invite_code
        ? (<>
            <label>{t.settings.household_code_label}</label>
            <input readOnly value={household.invite_code} onFocus={(e)=>e.target.select()} />
            <button className="btn-secondary" onClick={createInvite}>{t.settings.household_regenerate}</button>
          </>)
        : (<button onClick={createInvite}>{t.settings.household_create_invite}</button>)}
      {household.members && household.members.length > 0 && (
        <>
          <p>{t.settings.household_owner_members}</p>
          <ul>
            {household.members.map(m => (
              <li key={m.user_id}>{m.name || m.email}
                <button className="btn-secondary" onClick={()=>removeMember(m.user_id)}>{t.settings.household_remove}</button>
              </li>
            ))}
          </ul>
        </>)}
      <label>{t.settings.household_join_label}</label>
      <input value={joinCode} onChange={(e)=>setJoinCode(e.target.value)} placeholder="kód" />
      <button onClick={joinHousehold}>{t.settings.household_join}</button>
    </>
  )}
  {hhMsg && <p className="form-hint">{hhMsg}</p>}
</section>
```

- [ ] **Step 4:** `cd /Users/tomas/app-spendex && npm run build` → projde bez chyb.

- [ ] **Step 5: Commit + push**
```bash
git add client/src/pages/SettingsPage.jsx client/src/i18n.js
git commit -m "feat(household): UI sekce Domácnost v Nastavení (invite/join/leave/remove)"
git push origin staging
```

---

## Self-Review (provedeno při psaní plánu)

- **Spec coverage:** tabulka invites (T1), router GET/invite/join/leave/remove + guardy (T2), UI dle role + i18n (T3) — vše pokryto. Push fan-out je Fáze 3.
- **Placeholdery:** žádné; konkrétní kód. T3 instruuje přizpůsobit className/stav realitě SettingsPage (číst první).
- **Konzistence:** endpointy operují na `req.user.id` (identita/membership graf), NE dataUserId — správně (household.js řeší vztahy, ne sdílená data). `roleOf` konzistentní napříč GET/invite. UNIQUE(data_owner_id) ↔ ON CONFLICT v invite.
- **Bezpečnost:** token crypto.randomBytes(24); guardy self-join/double-join/owner-with-members; remove scoped na req.user.id jako data_owner. Vše requireAuth + writeLimiter.
- **Testy T2 (7 bloků):** invite→join happy path, self-join/neplatný kód → 400, už člen → 409, member nesmí invite → 403, leave + ne-člen → 400, owner remove + cizí → 404, GET role solo/owner/member. Pokrývají guardy.