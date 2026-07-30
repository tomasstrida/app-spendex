# Balíček D — Párování Apple faktur, design

Datum: 2026-07-30
Stav: návrh k implementaci

## 1. Problém

Všechny Apple platby přijdou z banky jako `APPLE.COM/BILL, CORK` — ~47 transakcí za 16 132 Kč
v kategorii `Y_Licence` má jedinou subkategorii „Apple". Z bankovní transakce nejde poznat, jestli
šlo o YouTube Premium, iCloud, ChatGPT přes App Store nebo jednorázový nákup. Roční rozpad Licencí
tak má největší položku jako neprůhledný agregát.

Apple přitom posílá ke každé platbě fakturu, která obsahuje název služby, částku, číslo objednávky
i použitou kartu. Cílem je tyhle dva zdroje spárovat a doplnit transakcím subkategorii.

**Rozhodnutí uživatele (brainstorming 2026-07-31):**

1. Výsledkem je **automatická subkategorie**, ne jen popisek.
2. Faktury chodí **přeposláním na `inbox@spendex.uk`**; zpracují se jen ty se slovem „invoice",
   ostatní Apple maily se zahodí bez uložení.
3. U faktury s **víc položkami** se subkategorie nemění — jen se do poznámky vloží rozpis.

## 2. Formát faktury (ověřeno na reálném vzorku)

Mail je `multipart/alternative` s HTML částí v quoted-printable. `simpleParser` (už používaný
v `emailInbound.js`) ho dekóduje; plain-text alternativa chybí, takže se pracuje s HTML.

Podstatná data z ukázky:

| Údaj | Hodnota | Kde v HTML |
|---|---|---|
| Odesílatel | `Apple <no_reply@email.apple.com>` | hlavička `From` |
| Předmět | `Your invoice from Apple.` | hlavička `Subject` |
| Datum | `30 June 2026` | `div.billing-information` |
| Order ID | `MQ9BQ86WV5` | text „Order ID:" |
| Položka | `YouTube` / `YouTube Premium (Monthly)` / `269,00 CZK` | `tr.subscription-lockup` |
| Karta | `MasterCard •••• 4225` | `div.payment-information` |
| Celkem | `269,00 CZK` | `div.payment-information` |

**Klíčová vlastnost:** CSS třídy typu `custom-460tp8` jsou generované emotion hashe a mění se mezi
verzemi mailu — parser se na ně vázat nesmí. Stabilní jsou sémantické třídy (`billing-information`,
`subscription-lockup`, `payment-information`) a textové kotvy („Order ID:", „MasterCard •••• ").

Ověření proti reálným datům: faktura odpovídá transakci `2026-06-30, −269 Kč, APPLE.COM/BILL`.

## 3. Vstupní cesta a bezpečnost

Dnes projdou jen maily s `airbank.cz` ve `From` — dvě vrstvy, Worker
(`infra/cloudflare-email-worker/worker.js:12`) a backend (`src/routes/emailInbound.js:44`).
Uživatel přeposílá ručně ze své adresy, takže `From` je `tomas.strida@icloud.com` a whitelist na
`apple.com` by nefungoval.

**Nová pravidla (obě vrstvy):** mail projde, pokud platí dosavadní AirBank podmínka **nebo**
Apple podmínka:

- v hlavičkách nebo těle je `no_reply@email.apple.com`, **a zároveň**
- předmět nebo tělo obsahuje `invoice`, `refund` nebo `credit` (case-insensitive — vzorek faktury
  má v předmětu „Your invoice from Apple." a v nadpisu „Invoice"; refundační doklady Apple používají
  „refund"/„credit note"), **a zároveň**
- v raw MIME je adresa z `EMAIL_ALLOWED_SENDER` (stejná podmínka jako dnes u AirBank).

Apple mail, který žádné z těch slov neobsahuje, se zahodí a **neukládá** — na rozdíl od
nerozpoznaných AirBank notifikací, které jdou do fronty. Důvod: uživatel přeposílá vše od Apple
a marketing by frontu zaplavil.

**Mail, který filtrem projde, ale parser ho nerozpozná, se naopak uloží** se stavem `unparsed`.
Refundační doklad Apple zatím nemáme ve vzorku, takže tohle je způsob, jak jeho formát uvidíme,
až první dorazí — bez toho, aby se ztratil.

**Vědomé riziko:** hlavičku `From` uvnitř přeposlaného mailu lze zfalšovat. Dopad je omezený —
faktura nikdy nezaloží transakci, nezmění částku ani datum. Nejhorší následek je špatná subkategorie
nebo poznámka, obojí ručně opravitelné.

## 4. Datový model

```sql
CREATE TABLE IF NOT EXISTS apple_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_id TEXT,                  -- „MQ9BQ86WV5"; NULL když se nevytáhne
  receipt_date TEXT,              -- YYYY-MM-DD, převedeno z „30 June 2026"
  total_amount REAL,              -- VŽDY kladné, 269.00; směr nese is_refund
  is_refund INTEGER NOT NULL DEFAULT 0,    -- 1 = dobropis / vrácení peněz
  card_last4 TEXT,                -- „4225"
  items_json TEXT,                -- [{ app, description, amount }]
  raw_text TEXT NOT NULL,         -- dekódovaný obsah pro pozdější reparsování
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'matched' | 'ambiguous' | 'unparsed' | 'rejected'
  transaction_id INTEGER,         -- spárovaná transakce
  matched_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_apple_receipt_order ON apple_receipts(user_id, order_id)
  WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_apple_receipt_status ON apple_receipts(user_id, status);
```

Unikátní index na `order_id` zajistí idempotenci: dvakrát přeposlaná faktura nevytvoří dva záznamy.

## 5. Párování

Kandidáti se hledají mezi transakcemi, které:

- patří uživateli (`user_id = dataUserId`),
- mají `description` nebo `place` začínající `APPLE.COM`,
- mají `ABS(amount)` rovné `total_amount` faktury (tolerance 0,5 Kč kvůli zaokrouhlení),
- mají `date` v okně **±3 dny** od `receipt_date`,
- **mají správné znaménko**: `amount < 0` pro fakturu, `amount > 0` pro dobropis (`is_refund = 1`).

Znaménko je součást párovacího klíče záměrně: nákup a jeho pozdější vrácení mají stejnou částku
i podobné datum, takže bez něj by dobropis mohl sednout na původní platbu.

Když `card_last4` faktury i transakce existují a **liší se**, kandidát vypadává. Když u transakce
chybí (platby před v2.0.208), kritérium se ignoruje.

Výsledek:

- **právě jeden kandidát** → `status='matched'`, doplní se subkategorie a poznámka (§6),
- **žádný** → `status='pending'`, faktura čeká (platba může dorazit později),
- **víc kandidátů** → `status='ambiguous'`, čeká na ruční rozhodnutí.

Párování se spouští ve dvou momentech:

1. při uložení faktury,
2. při importu transakce, jejíž `description` začíná `APPLE.COM` — pak se hledá mezi
   `pending` fakturami. Jeden dotaz navíc v `emailIngest.js`.

## 6. Přiřazení subkategorie

Žádný nový číselník. Text položky (`app` + `description`, např. „YouTube YouTube Premium (Monthly)")
projde existujícími textovými pravidly uživatele — `loadUserRules(db, userId)` vrací pole s
`pattern`, `category` a volitelným `subcategory_id`, spravované na stránce Pravidla.

- **Jednopoložková faktura + pravidlo se `subcategory_id` sedí** → transakce dostane tuhle
  subkategorii. Kategorie transakce se **nemění** (patří bance a případným ručním úpravám).
- **Jednopoložková, žádné pravidlo nesedí** → subkategorie beze změny, název položky do poznámky.
- **Vícepoložková** → subkategorie beze změny, do poznámky rozpis všech položek.

Poznámka se **rozšiřuje**, nikdy nepřepisuje: nová informace se připojí za stávající text jen tehdy,
když tam ještě není (stejný postup jako migrace `migrate-email-counterparty-vs.cjs`).

Příklad z reálného vzorku: „YouTube Premium (Monthly)" mezi 13 subkategoriemi Licencí není, takže
transakce zůstane v „Apple" a poznámka dostane název služby. Uživatel si pak buď založí subkategorii
YouTube a pravidlo, nebo to nechá být.

## 7. UI

Na stránce Import v sekci „Z e-mailu" přibude blok **Apple faktury** se seznamem podle stavu:

- **spárováno** — datum, částka, položka, odkaz na transakci,
- **čeká na platbu** (`pending`) — faktura bez odpovídající transakce,
- **nejednoznačné** (`ambiguous`) — nabídne kandidáty k ručnímu výběru.

Akce: ruční výběr transakce u `pending`/`ambiguous`, zahození faktury (`rejected`), a u spárované
odpojení. Zpětné doplnění historie proběhne prostým přeposláním starých faktur — párování je pro
nové i staré stejné.

## 8. Hraniční případy

- **Faktura dorazí dřív než platba** — zůstane `pending`, spáruje se při importu transakce.
- **Refundace (dobropis)** — uloží se stejně jako faktura, s `is_refund = 1` a kladným
  `total_amount`; páruje se na příchozí transakci (`amount > 0`). Subkategorie se přiřazuje stejným
  pravidlem jako u výdaje, takže vrácená částka padne do stejné subkategorie jako původní nákup
  a v rozpadu Licencí se s ním vyruší — kategorie počítají utraceno jako `SUM(-amount)` přes
  všechny transakce, viz chování zavedené v 1.1.151.
- **Refundace bez rozpoznaného formátu** — dokud nemáme vzorek refundačního mailu, parser ho
  nemusí rozklíčovat. Uloží se se stavem `unparsed` a `raw_text`, takže půjde doplnit parser
  a přeparsovat bez nového přeposílání.
- **Dvakrát přeposlaná faktura** — unikátní index na `order_id`; bez `order_id` se duplicita
  pozná podle shody `receipt_date` + `total_amount` + `card_last4`.
- **Faktura bez rozpoznaných položek** — uloží se s prázdným `items_json`, spáruje se podle částky,
  subkategorii nemění.
- **Změna formátu mailu Apple** — parser vrátí null, mail se zahodí a v logu zůstane řádek.
  `raw_text` u uložených faktur umožní pozdější reparsování bez nového přeposílání.
- **Ručně upravená transakce** — párování nikdy nepřepíše kategorii ani částku, jen subkategorii
  a poznámku.
- **Household** — vše přes `req.dataUserId`, faktury jsou sdílené jako ostatní data.

## 9. Testy

- `src/utils/appleInvoiceParser.test.js` — parsování reálného vzorku (uložený fixture): datum,
  Order ID, karta, celková částka, jedna položka; dále faktura bez položek a mail bez „invoice".
- `src/utils/appleMatch.test.js` — čisté párovací funkce: jeden kandidát, žádný, víc kandidátů,
  rozdílná karta vyřadí kandidáta, chybějící karta kritérium ignoruje, okno ±3 dny na hranici,
  **dobropis se nespáruje s odchozí platbou stejné částky a naopak**.
- `src/routes/appleReceipts.test.js` — ownership, ruční přiřazení, zahození, idempotence dle
  `order_id`.
- `src/routes/emailInbound.security.test.js` — Apple mail bez „invoice" se neuloží; mail bez
  `EMAIL_ALLOWED_SENDER` v raw se odmítne; AirBank cesta beze změny.

## 10. Mimo scope

- Rozdělování transakce na položky faktury.
- Automatické zakládání subkategorií pro neznámé služby.
- Párování jiných účtenek než Apple (Google, Microsoft).
- Stahování faktur přes Apple API — neexistuje veřejné rozhraní.
- Změna kategorie transakce (mění se jen subkategorie).
