# Deep-link z notifikace na konkrétní platbu + filtr import sekce pro člena domácnosti

Datum: 2026-06-30

## Cíl

Dvě nezávislé úpravy nad existujícím flow e-mailového importu a push notifikací:

1. **Deep-link z notifikace** — po kliknutí na push notifikaci o platbě se zobrazí
   zařazení právě té konkrétní platby (ne jen obecná stránka importu).
2. **Filtr import sekce pro člena domácnosti** — Martin (household member) uvidí
   v import sekci jen svoje platby, ne všechny transakce domácnosti.

## Kontext (současný stav)

- Push payload nese jen `{ title, body, url: '/import' }` — žádné ID platby.
  Service worker (`client/public/sw.js`) i React bridge (`App.jsx` →
  `SwNavigationBridge`) ale už umí přenést libovolnou URL včetně query stringu.
- Položky review fronty jsou v tabulce `email_inbox` (mají `id`), auto-zařazené
  platby jdou rovnou do `transactions`.
- `email_inbox` je vázána na `user_id = data_owner_id`. Member má
  `req.dataUserId = data_owner_id` → vidí celou frontu domácnosti.
- Rozlišení „čí platba": `parsed_json.card_last4` → `cards.assigned_user_id`.
- `notifyForResult(db, result)` v `src/services/pushNotify.js` sestavuje notifikaci;
  `url` je dnes natvrdo `/import`.

## Feature 1 — Deep-link z notifikace na konkrétní platbu

### Chování podle statusu platby

| Status            | Cíl po kliknutí                                | URL                                      |
|-------------------|------------------------------------------------|------------------------------------------|
| `pending`         | import, scroll + zvýraznění položky ve frontě  | `/import?focus=<inboxId>`                 |
| `awaiting_card`   | import, scroll + zvýraznění                     | `/import?focus=<inboxId>`                 |
| `imported`        | Transakce, skok na období + zvýraznění řádku    | `/transactions?period=<key>&highlight=<txId>` |

### Backend změny

**`src/services/emailIngest.js`**
- `classifyAndStore(...)`:
  - větev `confident` (insert do `transactions`) → do `result` přidat
    `transactionId` (lastInsertRowid) a `txDate` (datum platby pro výpočet období).
  - jinak (insert do `email_inbox` `pending`) → do `result` přidat `inboxId`.
- awaiting_card větev v `ingestEmail` (insert `email_inbox` `awaiting_card`) → přidat
  `inboxId`.

**`src/utils/period.js`**
- Nový helper `periodKeyForDate(billingDay, dateStr)` → vrátí `"YYYY-MM"` periodKey,
  do kterého datum spadá s ohledem na `billing_day`. Pravidlo: den `>= billingDay`
  patří do měsíce data; den `< billingDay` patří do předchozího měsíce (konzistentní
  s `getPeriodDates`).
- Přidat do `module.exports`.
- Unit testy v `src/utils/period.test.js` (billingDay=1 i >1, přelom roku).

**`src/services/pushNotify.js`**
- `notifyForResult` sestaví `url` podle statusu:
  - `awaiting_card` / `pending` → `/import?focus=<inboxId>`
  - `imported` → `/transactions?period=<periodKeyForDate(billingDay, txDate)>&highlight=<transactionId>`
    (billing_day načíst přes `getUserBillingDay(db, target)`)
- Do payloadu přidat `tag` unikátní per platba (např. `spendex-<inboxId>` /
  `spendex-tx-<transactionId>`), aby se víc notifikací nepřekrylo do jedné.
  Fallback `spendex-payment`, když ID chybí.

### Service worker

**`client/public/sw.js`**
- V `push` handleru použít `data.tag` z payloadu místo natvrdo `'spendex-payment'`
  (fallback na `'spendex-payment'`).
- `notificationclick` zůstává — už předává `data.url` přes `postMessage`.

### Frontend změny

**`client/src/pages/ImportPage.jsx`**
- Přečíst `?focus=<id>` přes `useSearchParams`.
- Po načtení fronty: scrollnout na položku `#inbox-<id>` a krátce ji zvýraznit
  (CSS třída s pulzem ~2 s). Položkám v `EmailInbox` přidat `id={`inbox-${item.id}`}`.
- Pokud položka ve frontě není (mezitím zpracována), nic se neděje (no-op).

**`client/src/pages/TransactionsPage.jsx`**
- Přečíst `?highlight=<id>`. Po načtení transakcí scrollnout na řádek a zvýraznit.
- Období řeší existující `?period=` param (už podporováno).

**CSS**
- Sdílená třída pro krátké zvýraznění (pulz), reuse pro import i transakce.

## Feature 2 — Filtr import sekce pro člena domácnosti

### Pravidlo

- **Owner / solo** (`req.user.id === req.dataUserId`): beze změny, vidí vše.
- **Member** (`req.user.id !== req.dataUserId`): vidí jen položky placené **jeho**
  kartou (`cards.assigned_user_id = req.user.id`) **+** položky `awaiting_card`
  (neznámá karta = broadcast). Skryté: položky bez `card_last4` (převody) a karty
  patřící jinému členu.

### Backend změny

**`src/routes/emailInbox.js`**
- `GET /` a `GET /history`: detekovat member přes `req.user.id !== req.dataUserId`.
- Pro member přidat do WHERE:
  ```sql
  AND (cd.assigned_user_id = :currentUser OR i.status = 'awaiting_card')
  ```
  `cd` = existující LEFT JOIN na `cards` přes `parsed_json.card_last4`.
  V `/history` přidat stejný JOIN (dnes tam JOIN na cards není — doplnit).

### Scope

- Filtruje se **jen import sekce** (`email_inbox` fronta + historie).
- Stránka **Transakce** se NEfiltruje — Martin tam vidí i nadále vše; deep-link
  `highlight` z Feature 1 tam jen scrolluje na konkrétní řádek.

## Testy

- `src/utils/period.test.js` — `periodKeyForDate` (billingDay 1 i >1, přelom roku).
- `src/services/emailIngest.test.js` (rozšířit, pokud existuje) — `result` obsahuje
  `inboxId` / `transactionId` + `txDate` pro jednotlivé statusy.
- `src/routes/emailInbox.test.js` (založit, pokud chybí) — member vidí jen svoje
  karetní platby + `awaiting_card`; owner vidí vše; `/history` stejně filtrované.

## Co se NEmění

- Routing notifikací (komu se posílá) — beze změny.
- CSV import flow — beze změny.
- Stránka Transakce a její filtry kromě nového `highlight` paramu.
- Schéma DB — žádné nové tabulky ani sloupce.

## Rizika

- `periodKeyForDate` musí přesně odpovídat hranicím `getPeriodDates`, jinak deep-link
  na transakci skočí na špatné období → pokryto testy.
- Unikátní `tag` notifikací: pokud by ID chybělo, fallback na sdílený tag (staré
  chování) — žádná regrese.
- Scroll/highlight běží až po async načtení dat → ošetřit závislostí na načteném
  seznamu (effect po datech), ne hned po mountu.
