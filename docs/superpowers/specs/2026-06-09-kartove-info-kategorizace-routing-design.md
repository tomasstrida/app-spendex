# Design: Kartové info v e-mailu → kategorizace + routing notifikací podle karty

Datum: 2026-06-09
Stav: schváleno k implementaci

## Cíl

AirBank notifikační e-maily o **platbě kartou** obsahují dvě informace, které dnes
zahazujeme:

1. **Místo platby** (merchant) — silný signál pro určení kategorie.
2. **Číslo karty** (maskované, poslední 4 číslice) — identifikuje, kdo platil.

Featura má dvě provázané části:

- **A) Parsing + kategorizace** — vytáhnout místo (a kartu, datum, typ) a pustit
  místo do kategorizačních pravidel. Zlepší zařazení i pro jednoho uživatele.
- **B) Routing notifikací podle karty** — push jen tomu, kdo platil (vlastník karty),
  v rámci sdílené domácnosti (Tom + Martin sdílí Společný účet, každý má svou kartu).

## Vzorek e-mailu (kartová platba)

```
zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 482,00 CZK. ...

Platba kartou (nezaúčtováno) v HAMR - BRANIK,RESTAURA, PRAHA 4, 000
Částka: 482,00 CZK
Karta: 516844******6062
Datum provedení: 08.06.2026
Kód transakce: 26918903543
```

Rozdíly oproti převodu, který parser umí dnes:
- řádek `Platba kartou (...) v <MÍSTO>` (u převodu je tu `Odchozí úhrada na účet ...`)
- `Karta: <maskované číslo>`
- datum pod labelem `Datum provedení` (převod má `Datum zaúčtování`)
- žádný protiúčet

## A) Parsing — `src/utils/emailParser.js`

Rozšířit `parseEmailNotification` o kartové platby. Hlavička (`se snížil/zvýšil o
částku ...`), `Kód transakce`, zdrojový účet a čas fungují beze změny.

Nově:
- **place**: `/Platba kartou(?:\s*\([^)]*\))?\s+v\s+(.+)/i` → skupina 1.
  Ořezat koncový terminálový kód `, 000` (regex `/,\s*\d{1,3}\s*$/`).
  Řádkový match (bez `/s`), takže `.+` nepřeteče na další řádek.
- **card_last4**: `/Karta:\s*([\d*]+)/i` → vzít poslední 4 číslice (`6062`).
  Pokud řádek chybí (převod) → `null`.
- **tx_type**: při shodě „Platba kartou" nastavit `tx_type = 'Platba kartou'`.
- **datum**: do fallback řetězce přidat `Datum provedení` vedle `Datum zaúčtování`.

Návratová struktura: `place` se reálně plní, přibude `card_last4`.
Při převodu zůstává `place = null`, `card_last4 = null` → chování beze změny.

## B1) Kategorizace — `src/utils/apply-rules.js`

Do `hay` (vrstva L3 textová pravidla) přidat `place`:

```js
const hay = `${tx.description || ''} ${tx.note || ''} ${tx.place || ''}`.toLowerCase();
```

Tím merchant vstoupí do textových pravidel a kartové platby se přestanou propadat
do fallbacku. Platí i pro CSV import (kde `place` už dnes existuje). **Karta sama
kategorii neurčuje** — slabý signál; rozhodující je místo.

## B2) Mapování karet — nová tabulka `cards`

```sql
CREATE TABLE IF NOT EXISTS cards (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  data_owner_id    INTEGER NOT NULL,
  last4            TEXT NOT NULL,
  assigned_user_id INTEGER,            -- NULL = nepřiřazená
  label            TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (data_owner_id)    REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(data_owner_id, last4)
);
```

- `data_owner_id` = vlastník household dat (Tom). Karty patří do jeho domácnosti.
- `assigned_user_id` = člen domácnosti (vlastník nebo člen), kterému karta patří.
- **Auto-discovery**: když ingest narazí na `last4`, který v `cards` (pro daného
  data ownera) není, vloží řádek s `assigned_user_id = NULL` (`INSERT OR IGNORE`).
- FK `ON DELETE SET NULL` — když člen odejde z domácnosti, jeho karty zůstanou jako
  nepřiřazené.

## B3) Routing + držení transakce — `src/services/emailIngest.js`

Refactor: post-parse logiku (párování účtu, dedup, kategorizace, insert/fronta)
vytáhnout do sdílené funkce `classifyAndStore(db, userId, tx, opts)`, kterou volá
jak `ingestEmail`, tak endpoint přiřazení karty (při uvolnění zadržených plateb).

Tok pro **platbu kartou** (`tx.card_last4 != null`):

1. Dohledat kartu: `SELECT assigned_user_id FROM cards WHERE data_owner_id=? AND last4=?`.
2. Pokud karta **neexistuje** → `INSERT OR IGNORE` jako nepřiřazená.
3. Pokud karta **chybí nebo `assigned_user_id IS NULL`** (neznámá / nepřiřazená):
   - **Transakce se NEzaloží**, i kdyby kategorizace byla jistá.
   - Uložit do `email_inbox` se stavem **`awaiting_card`** (parsed_json vč. `card_last4`
     a `account_id`).
   - **Žádná push notifikace.** Karta se objeví v Nastavení k přiřazení.
4. Pokud je karta **přiřazená** → `notifyUserId = assigned_user_id`:
   - běžný tok: jisté → `transactions`; nejisté → `email_inbox` `pending`.
   - push jde **vlastníkovi karty** (Tom nebo Martin).

Tok pro **převod / platbu bez karty** (`card_last4 == null`): beze změny.
`notifyUserId` = data owner (fallback).

`result` dostane nové pole `notifyUserId` (oddělené od `userId` = data owner).
Transakce se **vždy ukládá pod data ownera** — household datový model se nemění,
mění se jen cíl pushe.

### Uvolnění zadržených plateb (při přiřazení karty)

Endpoint `PATCH /api/household/cards/:last4` (přiřazení/změna):
1. `UPDATE cards SET assigned_user_id=?, label=? WHERE data_owner_id=? AND last4=?`.
2. Najít `email_inbox` řádky `status='awaiting_card'` daného data ownera, kde
   `parsed_json.card_last4 = last4`.
3. Pro každý zavolat `classifyAndStore` (karta už je známá) → jisté: import do
   `transactions` + označit řádek `imported`; nejisté: přepnout na `pending`.
4. **Žádná zpětná push** — platba je stará; gate je správné zařazení, ne opožděné
   upozornění.

## C) Notifikace — `src/services/pushNotify.js`

`notifyForResult` použije `result.notifyUserId` (fallback na `result.userId`).
`notify_scope` se čte pro **cílového** uživatele. Existující logika scope
(off / pending_only / all) beze změny. Tělo zprávy už dnes ukazuje
`notify.merchant = place || description`, takže místo se v notifikaci objeví
automaticky, jakmile se `place` plní.

## D) UI — Nastavení → sekce Domácnost

Pod stávající seznam členů přidat blok **Karty**:
- Seznam karet: `•••• last4`, popisek (editovatelný), dropdown „přiřadit členovi"
  (vlastník + členové domácnosti).
- **Nepřiřazené karty zvýrazněné nahoře** + počet zadržených plateb („3 platby
  čekají na přiřazení").
- Po přiřazení se zadržené platby uvolní (viz B3) a zmizí z čekající fronty.

Endpointy v `src/routes/household.js`:
- `GET /api/household/cards` → seznam karet + počet `awaiting_card` na kartu.
- `PATCH /api/household/cards/:last4` → přiřadit/přejmenovat + uvolnit zadržené.

Autorizace: karty spravuje **kterýkoli člen domácnosti** (vlastník i člen) —
přiřazení i přejmenování. Karty patří do dat vlastníka (`data_owner_id`), takže
endpoint nejdřív přes `roleOf(req.user.id)` zjistí `ownerId` domácnosti volajícího
a operuje nad kartami toho `data_owner_id`. Tím člen (Martin) přiřadí svou kartu sám.

i18n: nové klíče `cards_title`, `cards_unassigned`, `cards_assign`,
`cards_waiting_count` apod. do `client/src/i18n.js`.

## Edge cases

- **Solo uživatel** (prázdná `cards`): kartová platba s neznámou kartou se podle
  pravidla výše zadrží jako `awaiting_card`. → Aby to single-uživatele neblokovalo,
  **auto-přiřadit kartu data ownerovi, pokud domácnost nemá žádné členy** (role
  `solo`). Pak se chová jako dnes (vše Tomovi, auto-import). Držení nastává jen
  v reálné sdílené domácnosti, kde má smysl rozlišovat.
- **Autorizační e-mail („nezaúčtováno") vs. pozdější CSV**: dedup přes `external_id`
  (`Kód transakce`) jako dnes. Riziko: pokud se kód autorizace ≠ kód zaúčtování →
  duplicita. Existující chování e-mail importu; řešit jen pokud reálně nastane.
- **Člen odejde z domácnosti**: jeho karty `assigned_user_id → NULL` (FK), příští
  platby se zadrží do nového přiřazení.

## Testy

- `emailParser.test.js`: kartový vzorek → `place` (ořezaný), `card_last4=6062`,
  `tx_type='Platba kartou'`, datum z `Datum provedení`, `direction='Odchozí'`.
  Převod dál → `place=null`, `card_last4=null`.
- `apply-rules.test.js`: pravidlo matchne podle `place`, i když `description` prázdné.
- `emailIngest.test.js`:
  - neznámá karta → `awaiting_card`, žádný insert do `transactions`, karta
    auto-vložená jako nepřiřazená, `notifyUserId` nenastaven (žádná push).
  - přiřazená karta člena → `notifyUserId = člen`, jisté → import.
  - solo (bez členů) → karta auto-přiřazená data ownerovi → import + notify Tom.
- `household.test.js`: `PATCH /cards/:last4` přiřadí kartu a uvolní `awaiting_card`
  platby (jisté → `transactions`, nejisté → `pending`). Autorizace member vs owner.

## Mimo rozsah

- Nativní karta→kategorie pravidla (karta neurčuje kategorii).
- Zpětné push notifikace u uvolněných plateb.
- Per-card budgety / reporting podle karty.
