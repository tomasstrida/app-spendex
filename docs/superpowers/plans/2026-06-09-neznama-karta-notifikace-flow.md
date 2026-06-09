# Platba neznámou kartou — notifikace + dvou-tapový flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Platba neznámou kartou pošle push všem v domácnosti a v importu se zobrazí s pickerem „čí karta?" (tap 1) → po přiřazení karty se uvolní do dlaždic kategorií (tap 2).

**Architecture:** `awaiting_card` result z `emailIngest` nese `notify`+`broadcast`; `pushNotify.notifyForResult` u `awaiting_card` fan-outuje na všechny členy domácnosti (bez ohledu na scope). `GET /api/email-inbox` zobrazí i `awaiting_card`. `ImportPage` vykreslí držené platby s pickerem členů → tap volá existující `PATCH /api/household/cards/:last4` → reload → dlaždice.

**Tech Stack:** Node.js + Express + better-sqlite3 (`node:test`), React + Vite, vlastní CSS.

---

## File Structure

- `src/services/emailIngest.js` — `awaiting_card` return doplní `notify`+`broadcast`.
- `src/services/pushNotify.js` — `formatBody` varianta neznámé karty + `notifyForResult` broadcast.
- `src/services/emailIngest.test.js` — upravit assertci stávajícího awaiting_card testu.
- `src/services/pushNotify.test.js` — nové testy (broadcast + formatBody).
- `src/routes/emailInbox.js` — `GET /` filtr přidá `awaiting_card`.
- `src/routes/emailInbox.test.js` — test, že GET vrací awaiting_card.
- `client/src/pages/ImportPage.jsx` — picker karty u držených plateb + fetch lidí.
- `client/src/index.css` — 2 nové třídy (`.review-cardpick`, `.review-cardpick-q`).

---

## Task 1: Notifikace domácnosti při neznámé kartě

**Files:**
- Modify: `src/services/emailIngest.js` (awaiting_card return, ~ř. 84-88)
- Modify: `src/services/pushNotify.js` (`formatBody`, `notifyForResult`)
- Modify: `src/services/emailIngest.test.js` (assertce stávajícího testu)
- Test: `src/services/pushNotify.test.js`

- [ ] **Step 1: Uprav stávající awaiting_card test + přidej push testy**

V `src/services/emailIngest.test.js` najdi test `'neznámá karta v domácnosti se členem → awaiting_card, ...'`.
Nahraď v něm řádek `assert.equal(r.notify, undefined);` za:

```js
  assert.equal(r.broadcast, true);
  assert.equal(r.notify.unknownCard, true);
  assert.equal(r.notify.last4, '6062');
```

V `src/services/pushNotify.test.js` přidej (drž se stávajících helperů `freshDb`/`cleanup` v souboru):

```js
test('awaiting_card → broadcast všem v domácnosti i se scope off', async () => {
  const { db, tmp } = freshDb();
  db.prepare("INSERT INTO users (id, email) VALUES (1,'tom@x'),(2,'martin@x')").run();
  db.prepare("INSERT INTO household_members (data_owner_id, user_id) VALUES (1, 2)").run();
  db.prepare("INSERT INTO settings (user_id, billing_day, notify_scope) VALUES (1,1,'off'),(2,1,'off')").run();
  db.prepare("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (1,'e1','p','a'),(2,'e2','p','a')").run();
  const sent = [];
  const client = { sendNotification: async (sub) => { sent.push(sub.endpoint); return { statusCode: 201 }; } };
  const { notifyForResult } = require('./pushNotify');
  await notifyForResult(db, {
    status: 'awaiting_card', userId: 1, broadcast: true,
    notify: { amount: -482, currency: 'CZK', merchant: 'HAMR', unknownCard: true, last4: '6062' },
  }, client);
  cleanup(db, tmp);
  assert.deepEqual(sent.sort(), ['e1', 'e2']);
});

test('formatBody: neznámá karta → 💳 text', () => {
  const { formatBody } = require('./pushNotify');
  const body = formatBody({ amount: -482, currency: 'CZK', merchant: 'HAMR', unknownCard: true });
  assert.match(body, /💳/);
  assert.match(body, /HAMR/);
});
```

- [ ] **Step 2: Spusť testy — musí selhat**

Run: `node --test src/services/pushNotify.test.js src/services/emailIngest.test.js`
Expected: FAIL (broadcast neimplementován, awaiting_card result zatím bez notify).

- [ ] **Step 3: Implementuj**

V `src/services/emailIngest.js` nahraď awaiting_card větev (return jen se status/external_id/userId) za:

```js
    if (card.assigned_user_id == null) {
      // Neznámá / nepřiřazená karta → drž transakci + upozorni celou domácnost
      db.prepare(`INSERT INTO email_inbox (user_id, received_at, raw_text, parsed_json, external_id, suggested_category_id, status)
                  VALUES (?, datetime('now'), ?, ?, ?, NULL, 'awaiting_card')`)
        .run(userId, text || '', JSON.stringify({ ...tx, account_id: account ? account.id : null }), extId || null);
      return {
        status: 'awaiting_card', external_id: extId, userId,
        notify: { amount: tx.amount, currency: tx.currency,
                  merchant: tx.place || tx.description || null, unknownCard: true, last4: tx.card_last4 },
        broadcast: true,
      };
    }
```

V `src/services/pushNotify.js` uprav `formatBody` (přidej větev neznámé karty na začátek po výpočtu `merchant`):

```js
function formatBody(notify) {
  const amount = Math.abs(Number(notify.amount) || 0);
  const sum = `${amount.toLocaleString('cs-CZ')} ${notify.currency || 'CZK'}`;
  const merchant = notify.merchant || 'Platba';
  if (notify.unknownCard) return `💳 ${sum} • ${merchant} — čí karta? Přiřaď v aplikaci`;
  if (notify.categoryName) return `✅ ${sum} • ${merchant} → ${notify.categoryName}`;
  return `⚠️ ${sum} • ${merchant} — potřebuje kategorii`;
}
```

A přidej broadcast větev na začátek `notifyForResult` (hned po `if (!result || !result.notify) return;`):

```js
async function notifyForResult(db, result, client) {
  if (!result || !result.notify) return;
  if (result.status === 'awaiting_card' && result.broadcast) {
    const owner = result.userId;
    if (!owner) return;
    const members = db.prepare('SELECT user_id FROM household_members WHERE data_owner_id = ?')
      .all(owner).map(r => r.user_id);
    const targets = [...new Set([owner, ...members])];
    for (const t of targets) {
      await sendToUser(db, t, { title: 'SPENDEX', body: formatBody(result.notify), url: '/import' }, client);
    }
    return;
  }
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

- [ ] **Step 4: Spusť testy — musí projít**

Run: `node --test src/services/pushNotify.test.js src/services/emailIngest.test.js`
Expected: ALL PASS.

Celá sada:
Run: `node --test 'src/**/*.test.js'`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/emailIngest.js src/services/pushNotify.js src/services/emailIngest.test.js src/services/pushNotify.test.js
git commit -m "feat(push): platba neznámou kartou → broadcast notifikace celé domácnosti

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `GET /api/email-inbox` zobrazí i `awaiting_card`

**Files:**
- Modify: `src/routes/emailInbox.js` (`GET /` WHERE)
- Test: `src/routes/emailInbox.test.js`

- [ ] **Step 1: Napiš failing test**

Přidej do `src/routes/emailInbox.test.js`:

```js
test('GET / vrací i awaiting_card položky', async () => {
  const { db, tmp } = setup();
  db.prepare("INSERT INTO email_inbox (user_id, parsed_json, status) VALUES (1, ?, 'awaiting_card')")
    .run(JSON.stringify({ description: 'HAMR', amount: -482, card_last4: '6062' }));
  const l = await listen(appFor(1));
  const rows = await (await fetch(`${l.base}/api/email-inbox`)).json();
  l.server.close(); cleanup(db, tmp);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'awaiting_card');
});
```

- [ ] **Step 2: Spusť test — musí selhat**

Run: `node --test src/routes/emailInbox.test.js`
Expected: FAIL (awaiting_card není ve filtru → 0 řádků).

- [ ] **Step 3: Implementuj**

V `src/routes/emailInbox.js` v `GET /` uprav řádek WHERE:

```sql
    WHERE i.user_id = ? AND i.status IN ('pending', 'unparsed', 'awaiting_card')
```

- [ ] **Step 4: Spusť test — musí projít**

Run: `node --test src/routes/emailInbox.test.js`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/emailInbox.js src/routes/emailInbox.test.js
git commit -m "feat(email-inbox): GET vrací i držené platby (awaiting_card)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Import — picker „čí karta?" u držených plateb

**Files:**
- Modify: `client/src/pages/ImportPage.jsx` (`EmailInbox`)
- Modify: `client/src/index.css` (2 třídy)

- [ ] **Step 1: Přidej CSS**

Na konec `client/src/index.css`:

```css
.review-cardpick { margin-top: 10px; }
.review-cardpick-q { font-size: 12px; color: var(--text2); text-transform: uppercase; letter-spacing: .04em; font-weight: 600; margin-bottom: 8px; }
```

- [ ] **Step 2: Stav `people` + fetch + handler**

V `client/src/pages/ImportPage.jsx`, v komponentě `EmailInbox`:

(a) Přidej stav (vedle `const [cats, setCats] = useState([]);`):

```js
  const [people, setPeople] = useState([]);
```

(b) Rozšiř `load()` o načtení lidí domácnosti:

```js
  const load = useCallback(async () => {
    const [ri, rc, rp] = await Promise.all([
      fetch('/api/email-inbox'),
      fetch('/api/categories'),
      fetch('/api/household/cards'),
    ]);
    if (ri.ok) setItems(await ri.json());
    if (rc.ok) setCats(await rc.json());
    if (rp.ok) { const j = await rp.json(); setPeople(j.people || []); }
  }, []);
```

(c) Přidej handler přiřazení karty (vedle `approve`/`remove`):

```js
  async function assignCard(item, userId, last4) {
    setBusy(item.id);
    try {
      const r = await fetch(`/api/household/cards/${last4}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_user_id: userId }),
      });
      if (r.ok) await load();
    } finally { setBusy(null); }
  }
```

- [ ] **Step 3: Rozděl položky + vykresli awaiting blok**

Najdi `const pending = items.filter(i => i.status === 'pending');` a přidej nad něj:

```js
  const awaiting = items.filter(i => i.status === 'awaiting_card');
```

Pak v JSX, hned za nadpisem sekce (`</h2>`) a PŘED `{pending.map(...)}`, vlož awaiting blok:

```jsx
      {awaiting.map(item => {
        let tx = {};
        try { tx = item.parsed_json ? JSON.parse(item.parsed_json) : {}; } catch { /* poškozený JSON */ }
        const last4 = tx.card_last4;
        return (
          <div key={item.id} className="card review-item">
            <div className="review-head">
              <div className="review-merch">{tx.description || '—'}</div>
              <div className="review-amt">{formatCurrency(tx.amount)}</div>
            </div>
            <div className="review-sub">
              <span>{tx.date} {tx.tx_time || ''}</span>
              <span className="who">💳 neznámá ••{last4}</span>
            </div>
            <div className="review-cardpick">
              <div className="review-cardpick-q">Čí je tato karta?</div>
              <div className="review-grid">
                {people.map(p => (
                  <button key={p.user_id} className="cat-tile" disabled={busy === item.id}
                    onClick={() => assignCard(item, p.user_id, last4)}>
                    <span className="who-av" style={{ background: ownerColor(p.user_id) }}>
                      {(p.name || p.email || '?').charAt(0).toUpperCase()}
                    </span>
                    <span className="cat-name">{p.name || p.email}</span>
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

(`ownerColor`, `formatCurrency`, `busy`, `remove` už v souboru existují z předchozí featury.)

- [ ] **Step 4: Ověř build**

Run: `cd client && npm run build`
Expected: build projde bez chyb.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ImportPage.jsx client/src/index.css
git commit -m "feat(ui): držené platby v importu s pickerem majitele karty (tap 1 → dlaždice)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Celá sada + build + push na staging

- [ ] **Step 1:** Run: `node --test 'src/**/*.test.js'` → ALL PASS.
- [ ] **Step 2:** Run: `cd client && npm run build` → OK.
- [ ] **Step 3:** `git push origin staging` → nahlas verzi. Prod až na pokyn.

---

## Self-review (provedeno při psaní)

- **Spec coverage:** notifikace všem (Task 1 broadcast), bez scope (žádná `notify_scope` kontrola v broadcast větvi), text 💳 (`formatBody`), deep-link `/import` (Task 1), awaiting_card v GET (Task 2), picker karty + reuse PATCH /cards + reload→dlaždice (Task 3). ✓
- **Rozbití stávajícího testu ošetřeno:** Task 1 Step 1 mění `assert.equal(r.notify, undefined)` na kontrolu broadcast/unknownCard. ✓
- **Placeholdery:** žádné — všechen kód konkrétní. ✓
- **Konzistence názvů:** `broadcast`, `notify.unknownCard`, `notify.last4`, `assignCard`, `people`, `awaiting`, status `awaiting_card`, PATCH `/api/household/cards/:last4` shodné backend↔frontend. ✓
- **YAGNI:** reuse existujícího PATCH /cards (žádný nový endpoint), reuse `.review-grid`/`.cat-tile`/`.who-av`/`ownerColor`. ✓
