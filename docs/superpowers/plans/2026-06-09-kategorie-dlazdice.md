# Velké dlaždice při zařazování do kategorií — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na ImportPage „Z e-mailu" nahradit malý `<select>` dropdown mřížkou velkých dlaždic kategorií (tap = zařadit), s kompaktní hlavičkou (obchod + tlumená částka + jmenovka majitele karty) a scrollovatelnou oblastí dlaždic.

**Architecture:** Backend doplní do `GET /api/email-inbox` jméno majitele karty (JOIN `cards`→`users` přes `json_extract(parsed_json,'$.card_last4')`). Frontend přepíše blok pending položky v `ImportPage.jsx` na mřížku dlaždic + přidá CSS třídy do `index.css`. Bez nového stavu pro výběr — klik na dlaždici volá existující `approve(item, categoryId)`.

**Tech Stack:** Node.js + Express + better-sqlite3 (`node:test`), React + Vite, vlastní CSS.

---

## File Structure

- `src/routes/emailInbox.js` — `GET /` rozšířit o `card_owner_name` + `card_owner_id`.
- `src/routes/emailInbox.test.js` — **nový** test soubor (route test harness jako household.test.js).
- `client/src/pages/ImportPage.jsx` — přepsat blok `pending.map(...)`, odebrat `selectedCats`, přidat helpery `orderedCats` + `ownerColor`.
- `client/src/index.css` — nové třídy pro dlaždice/hlavičku.

---

## Task 1: Backend — jméno majitele karty v `GET /api/email-inbox`

**Files:**
- Modify: `src/routes/emailInbox.js:11-22`
- Test: `src/routes/emailInbox.test.js` (nový)

- [ ] **Step 1: Napiš failing test**

Vytvoř `src/routes/emailInbox.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const express = require('express');

function setup() {
  const tmp = path.join(os.tmpdir(), `spendex-inbox-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['../db/connection','../db/schema','./emailInbox']) delete require.cache[require.resolve(m)];
  const db = require('../db/connection'); require('../db/schema').initSchema();
  db.prepare("INSERT INTO users (id, email, name) VALUES (1,'owner@x','Owner'),(2,'martin@x','Martin')").run();
  return { db, tmp };
}
function cleanup(db, tmp){ db.close(); for (const s of ['','-wal','-shm']){try{fs.unlinkSync(tmp+s);}catch{/* ok */}} }
function appFor(uid){
  const app = express(); app.use(express.json());
  app.use((req,_res,next)=>{ req.user={id:uid}; req.dataUserId=uid; req.isAuthenticated=()=>true; next(); });
  app.use('/api/email-inbox', require('./emailInbox'));
  return app;
}
async function listen(app){ const s=await new Promise(r=>{const x=app.listen(0,()=>r(x));}); return {server:s, base:`http://127.0.0.1:${s.address().port}`}; }

test('GET / doplní card_owner_name/id pro kartu; null bez karty', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO cards (data_owner_id, last4, assigned_user_id) VALUES (1, '6062', 2)").run();
  // pending položka S kartou
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'pending')")
    .run(JSON.stringify({ description: 'HAMR', amount: -482, card_last4: '6062' }));
  // pending položka BEZ karty (převod)
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'pending')")
    .run(JSON.stringify({ description: 'Převod', amount: -100 }));
  const l = await listen(appFor(1));
  const rows = await (await fetch(`${l.base}/api/email-inbox`)).json();
  l.server.close(); cleanup(db, tmp);
  const withCard = rows.find(r => JSON.parse(r.parsed_json).card_last4 === '6062');
  const noCard = rows.find(r => JSON.parse(r.parsed_json).description === 'Převod');
  assert.equal(withCard.card_owner_name, 'Martin');
  assert.equal(withCard.card_owner_id, 2);
  assert.equal(noCard.card_owner_name, null);
});
```

- [ ] **Step 2: Spusť test — musí selhat**

Run: `node --test src/routes/emailInbox.test.js`
Expected: FAIL (`card_owner_name` undefined → není v SELECTu).

- [ ] **Step 3: Implementuj**

V `src/routes/emailInbox.js` nahraď SQL v `GET /` (ř. 12-20) za:

```js
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
    WHERE i.user_id = ? AND i.status IN ('pending', 'unparsed')
    ORDER BY i.created_at DESC, i.id DESC
  `).all(req.dataUserId);
```

- [ ] **Step 4: Spusť test — musí projít**

Run: `node --test src/routes/emailInbox.test.js`
Expected: PASS.

A celá sada bez regresí:
Run: `node --test 'src/**/*.test.js'`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/emailInbox.js src/routes/emailInbox.test.js
git commit -m "feat(email-inbox): GET doplní jméno majitele karty (card_owner_name)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Frontend — mřížka dlaždic + CSS

**Files:**
- Modify: `client/src/pages/ImportPage.jsx` (komponenta `EmailInbox`, ř. 189-268)
- Modify: `client/src/index.css` (přidat třídy na konec)

- [ ] **Step 1: Přidej CSS třídy**

Na konec `client/src/index.css` přidej:

```css
/* Zařazování z e-mailu — velké dlaždice */
.review-item { margin-bottom: 8px; }
.review-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.review-merch { font-weight: 700; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.review-amt { font-size: 13px; color: var(--text2); font-weight: 600; white-space: nowrap; flex: none; }
.review-sub { color: var(--text2); font-size: 12px; margin-top: 3px; display: flex; align-items: center; gap: 6px; }
.who { display: inline-flex; align-items: center; gap: 5px; background: var(--bg3); border: 1px solid var(--border);
       border-radius: 999px; padding: 2px 8px; color: var(--text); font-weight: 600; }
.who-av { width: 14px; height: 14px; border-radius: 50%; color: #fff; font-size: 9px;
          display: flex; align-items: center; justify-content: center; font-weight: 700; }
.review-tiles { max-height: 300px; overflow-y: auto; -webkit-overflow-scrolling: touch; margin-top: 10px; padding-right: 4px; }
.review-tiles::-webkit-scrollbar { width: 6px; }
.review-tiles::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
.review-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.cat-tile { display: flex; align-items: center; gap: 10px; min-height: 58px; padding: 10px 12px;
            background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius);
            font-size: 14px; font-weight: 600; color: var(--text); text-align: left; cursor: pointer; }
.cat-tile:disabled { opacity: .5; cursor: default; }
.cat-tile.suggested { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(99,102,241,.35) inset; }
.cat-dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }
.cat-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cat-sug { font-size: 10px; color: #a5b4fc; font-weight: 700; margin-left: auto; flex: none; }
.review-actions { display: flex; justify-content: flex-end; margin-top: 10px; }
```

- [ ] **Step 2: Přidej helpery + odeber `selectedCats`**

V `client/src/pages/ImportPage.jsx`:

(a) Nad komponentu `EmailInbox` (před ř. 189 `function EmailInbox()`) přidej čisté helpery:

```js
const AV_COLORS = ['#6366f1', '#a855f7', '#3b82f6', '#f97316', '#14b8a6', '#ec4899'];
function ownerColor(id) { return AV_COLORS[(id || 0) % AV_COLORS.length]; }
function orderedCats(cats, suggestedId) {
  if (!suggestedId) return cats;
  const s = cats.find(c => c.id === suggestedId);
  if (!s) return cats;
  return [s, ...cats.filter(c => c.id !== suggestedId)];
}
```

(b) Odeber řádek se `selectedCats` stavem (ř. 193):

```js
  const [selectedCats, setSelectedCats] = useState({});
```
→ smazat celý tento řádek.

- [ ] **Step 3: Přepiš blok `pending.map(...)`**

Nahraď celý blok `{pending.map(item => { ... })}` (ř. 240-268) za:

```jsx
      {pending.map(item => {
        let tx = {};
        try { tx = item.parsed_json ? JSON.parse(item.parsed_json) : {}; } catch { /* poškozený JSON */ }
        return (
          <div key={item.id} className="card review-item">
            <div className="review-head">
              <div className="review-merch">{tx.description || '—'}</div>
              <div className="review-amt">{formatCurrency(tx.amount)}</div>
            </div>
            <div className="review-sub">
              <span>{tx.date} {tx.tx_time || ''}</span>
              {item.card_owner_name && (
                <span className="who">
                  <span className="who-av" style={{ background: ownerColor(item.card_owner_id) }}>
                    {item.card_owner_name.charAt(0).toUpperCase()}
                  </span>
                  {item.card_owner_name}
                </span>
              )}
            </div>
            <div className="review-tiles">
              <div className="review-grid">
                {orderedCats(cats, item.suggested_category_id).map(c => (
                  <button key={c.id}
                    className={`cat-tile${c.id === item.suggested_category_id ? ' suggested' : ''}`}
                    disabled={busy === item.id}
                    onClick={() => approve(item, c.id)}>
                    <span className="cat-dot" style={{ background: c.color }} />
                    <span className="cat-name">{c.name}</span>
                    {c.id === item.suggested_category_id && <span className="cat-sug">NAVRŽENO</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="review-actions">
              <button className="btn btn-ghost btn-icon" disabled={busy === item.id}
                onClick={() => remove(item)} title="Smazat">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}
```

Pozn.: `Check` icon import (ř. 2) může zůstat — používá se i jinde na stránce; neměň importy, jen ověř, že build nehlásí nepoužitý import (Vite to neblokuje). `formatCurrency`, `cats`, `busy`, `approve`, `remove` už v komponentě existují.

- [ ] **Step 4: Ověř build**

Run: `cd client && npm run build`
Expected: build projde bez chyb (žádná reference na odebraný `selectedCats`/`setSelectedCats`).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ImportPage.jsx client/src/index.css
git commit -m "feat(ui): velké dlaždice při zařazování z e-mailu (tap = zařadit, jmenovka karty, scroll)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Celá sada + build + push na staging

- [ ] **Step 1: Celá testovací sada**

Run: `node --test 'src/**/*.test.js'`
Expected: ALL PASS.

- [ ] **Step 2: Build klienta**

Run: `cd client && npm run build`
Expected: OK.

- [ ] **Step 3: Push na staging**

```bash
git push origin staging
```

Po pushi nahlas číslo verze. Prod až na explicitní pokyn (CLAUDE.md deploy flow).

---

## Self-review (provedeno při psaní)

- **Spec coverage:** kompaktní hlavička obchod+částka (Task 2 Step 3 `.review-head`), částka tlumená `--text2` (CSS `.review-amt`), jmenovka místo čísla karty (Task 1 backend + Task 2 `.who`), skrytí jmenovky bez karty (`{item.card_owner_name && ...}`), mřížka 2 sloupce + scroll (`.review-grid`/`.review-tiles`), navržená první + „NAVRŽENO" (`orderedCats` + `.suggested`/`.cat-sug`), tap = zařadit (`onClick approve(item, c.id)`), smazat zachováno, busy disabled. ✓
- **Placeholdery:** žádné — všechen kód konkrétní. ✓
- **Konzistence názvů:** `card_owner_name`/`card_owner_id` shodné backend (Task 1 SELECT) ↔ frontend (Task 2 čte `item.card_owner_name`/`item.card_owner_id`); `orderedCats`, `ownerColor`, CSS třídy `.review-*`/`.cat-*` konzistentní napříč Task 2. ✓
- **YAGNI:** `orderedCats`/`ownerColor` inline bez vlastního testu (triviální čisté funkce, gate = build). Žádné seskupení po typu ani ikony (mimo rozsah). ✓
