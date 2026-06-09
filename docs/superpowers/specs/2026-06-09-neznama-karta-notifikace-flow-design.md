# Design: Platba neznámou kartou — notifikace domácnosti + dvou-tapový flow

Datum: 2026-06-09
Stav: schváleno k implementaci

## Problém (root cause)

Kartová platba s **neznámou kartou** se podrží jako `email_inbox.status='awaiting_card'`:
- hold **neposílá žádnou push** → uživatel o platbě neví,
- `awaiting_card` se **nezobrazuje v importu** (`GET /api/email-inbox` filtruje jen
  `pending`+`unparsed`) → není ani vidět,
- uvolnění přes `releaseHeldCard` (po přiřazení karty v Nastavení) je taky tiché.

→ platba neznámou kartou je úplně tichá, dokud někdo náhodou nekoukne do Nastavení.

## Cíl

1. **Notifikace všem v domácnosti**, když dorazí platba neznámou kartou.
2. **Dvou-tapový flow v importu**: tap 1 = čí je karta, tap 2 = kategorie (velké dlaždice).

## Řešení

### 1. Notifikace — `emailIngest.js` + `pushNotify.js`

**`emailIngest.js`** — větev `awaiting_card` (ř. ~84-88) doplní `notify` + `broadcast`:

```js
return {
  status: 'awaiting_card', external_id: extId, userId,
  notify: { amount: tx.amount, currency: tx.currency,
            merchant: tx.place || tx.description || null, unknownCard: true, last4: tx.card_last4 },
  broadcast: true,
};
```

**`pushNotify.js`**:
- `formatBody` — varianta pro neznámou kartu:
  ```js
  if (notify.unknownCard) return `💳 ${sum} • ${merchant} — čí karta? Přiřaď v aplikaci`;
  ```
- `notifyForResult` — nová větev pro `awaiting_card` **před** existující logikou:
  ```js
  if (result.status === 'awaiting_card' && result.broadcast) {
    const owner = result.userId;
    const members = db.prepare('SELECT user_id FROM household_members WHERE data_owner_id = ?')
      .all(owner).map(r => r.user_id);
    const targets = [...new Set([owner, ...members])];
    for (const t of targets) {
      await sendToUser(db, t, { title: 'SPENDEX', body: formatBody(result.notify), url: '/import' }, client);
    }
    return;
  }
  ```
  **Bez kontroly `notify_scope`** — neznámá karta = akce nutná, posíláme všem (i komu jsou
  notifikace jinak vypnuté). `sendToUser` stejně no-opne, když člen nemá žádnou subscription.

`emailInbound.js` se nemění (volá `notifyForResult(db, result)` jako dnes; `awaiting_card`
result teď nese `notify`+`broadcast`).

### 2. Import — zobrazit držené platby + picker karty

**`emailInbox.js`** — `GET /` přidat `awaiting_card` do filtru:
```sql
WHERE i.user_id = ? AND i.status IN ('pending', 'unparsed', 'awaiting_card')
```
(JOIN na `cards`/`users` zůstává; u `awaiting_card` je `card_owner_name` null, protože karta
ještě není přiřazená.)

**`ImportPage.jsx`** (`EmailInbox`):
- `load()` navíc načte lidi domácnosti: `fetch('/api/household/cards')` → `{cards, people}` →
  `setPeople(people)`. (Endpoint už existuje, vrací vlastníka + členy.)
- Rozdělit: `const awaiting = items.filter(i => i.status === 'awaiting_card')`, `pending` jako dnes.
- **Awaiting položky vykreslit nahoře** (potřebují akci) s pickerem:
  - Hlavička: merchant + ztlumená částka; sub: datum + `💳 neznámá ••{last4}`.
  - „Čí je tato karta?" + tlačítka pro každého `people` (iniciála + jméno, styl jako `.who`/dlaždice).
  - Tap člena → `PATCH /api/household/cards/{last4}` `{ assigned_user_id }` → `load()`.
    Po reloadu položka přejde na `pending` (uvolněná) → zobrazí se dlaždice kategorií (tap 2).
    Když merchant trefil pravidlo, `releaseHeldCard` ji rovnou zaimportuje (1 tap, zmizí).
- `last4` se čte z `JSON.parse(item.parsed_json).card_last4`.

## Edge cases

- **Solo uživatel**: `awaiting_card` nikdy nevznikne (karta se auto-přiřadí vlastníkovi),
  picker se nezobrazí. Beze změny.
- **Bez subscription**: člen bez push subscription notifikaci nedostane (no-op), ale platbu
  vidí v importu po otevření.
- **Opakovaný e-mail**: dedup vrací `duplicate` (bez notify) → žádný druhý broadcast.
- **Přiřazení karty z importu** = stejný `PATCH /cards/:last4` jako z Nastavení → uvolní
  i případné další držené platby téže karty (konzistentní).

## Testy

- `pushNotify.test.js`: `awaiting_card` + `broadcast` → `sendToUser` zavolán pro vlastníka
  i člena, **i když má scope `off`**; `formatBody` s `unknownCard` vrací text s 💳.
- `emailInbox.test.js`: `GET /` vrací i `awaiting_card` položky.
- `emailIngest.test.js`: existující test „neznámá karta → awaiting_card" rozšířit o kontrolu,
  že result nese `notify.unknownCard` + `broadcast:true`.
- Frontend: ověření přes `npm run build` + vizuálně.

## Mimo rozsah

- Zpětná notifikace při `releaseHeldCard` (pokrývá broadcast při holdu).
- Změna chování pro známé/přiřazené karty (push jen majiteli — beze změny).
