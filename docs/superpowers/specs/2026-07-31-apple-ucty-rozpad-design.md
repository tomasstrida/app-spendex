# Rozpad Licencí podle Apple účtu, design

Datum: 2026-07-31
Stav: návrh k implementaci

## 1. Problém

Uživatel má tři Apple ID (`tomas.strida@icloud.com`, `xstrt06@centrum.cz`,
`bisek.martin@icloud.com`) a z každého mu chodí faktury. Po zavedení párování Apple faktur
(balíček D) sice u plateb přibývá název služby, ale ne informace o tom, ze kterého účtu platba
šla. Chybí odpověď na otázku „kolik nás stojí konkrétní Apple ID".

Faktura tu informaci obsahuje — řádek `Apple Account: …` — ale parser ji zahazuje.

**Rozhodnutí uživatele (brainstorming 2026-07-31):**

1. Účel jsou **součty za období**, ne jen informativní údaj u platby.
2. Zobrazení jako **druhý rozpad na kartě roční kategorie** (varianta A), vedle stávajícího
   rozpadu podle subkategorie.
3. Proklik vede do Transakcí přes **plnohodnotný filtr** `apple_account`, ne přes výčet ID.

## 2. Datový model

Nový sloupec v existující tabulce:

```sql
ALTER TABLE apple_receipts ADD COLUMN apple_account TEXT;
CREATE INDEX IF NOT EXISTS idx_apple_receipt_account ON apple_receipts(user_id, apple_account);
```

Hodnota se ukládá **normalizovaně na malá písmena** — Apple ho v mailu píše konzistentně, ale
malá písmena zaručí, že se dva zápisy téhož účtu nerozejdou.

Transakce nový sloupec **nedostávají**. Vazba jde přes `apple_receipts.transaction_id`, takže
jedna pravda o účtu žije na faktuře. Kdyby se údaj zrcadlil i do transakce, musel by se
synchronizovat při každém odpojení a znovupřiřazení faktury.

## 3. Parser

`parseAppleInvoice` v `src/utils/appleInvoiceParser.js` vrátí navíc pole `apple_account`
(string nebo `null`). Vytáhne ho textová kotva `Apple Account:` následovaná e-mailovou adresou —
stejný přístup jako u `Order ID:`, protože CSS třídy jsou generované hashe.

Ve vzorku (`src/utils/__fixtures__/apple-invoice.eml`) je pole ve stejném bloku
`billing-information` jako datum a číslo objednávky.

## 4. Součty

`GET /api/budget-items` vrací nový agregát `category_apple_account_year_spent` ve tvaru
`{ [category_id]: [{ apple_account, spent }] }`, sestavený stejně jako existující
`category_subcategory_year_spent` (`src/routes/budget-items.js:77-95`).

Součet bere transakce roku spojené s fakturou:

```sql
SELECT t.category_id, LOWER(ar.apple_account) AS apple_account,
       COALESCE(SUM(-t.amount), 0) AS spent
FROM transactions t
JOIN apple_receipts ar ON ar.transaction_id = t.id AND ar.user_id = t.user_id
JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
WHERE t.user_id = ? AND c.type = 2
  AND ar.apple_account IS NOT NULL AND ar.status = 'matched'
  AND t.date >= ? AND t.date <= ?
GROUP BY t.category_id, LOWER(ar.apple_account)
ORDER BY spent DESC
```

Omezení `c.type = 2` (roční kategorie) je stejné jako u stávajícího rozpadu podle subkategorie —
stránka Roční budgety jiné kategorie nezobrazuje.

**Řádky „Apple bez faktury" a „mimo Apple".** Rozpad musí sečíst na celek kategorie, jinak
porušuje projektové pravidlo, že zobrazený součet odpovídá datům pod ním. Původní návrh počítal
jediný dopočtený zbytek (`category_year_spent[cat] − Σ spent za účty`), ale review proti reálným
datům ukázalo, že to je zavádějící: kategorie Licence má v roce 2026 23 Apple plateb za 7 115 Kč
a 44 ne-Apple plateb (Adobe, OpenAI…) za 28 795 Kč — jeden řádek „bez faktury ≈ 33 000 Kč" by
uživatel přečetl jako „tolik faktur mi ještě chybí přeposlat", přestože drtivá většina té částky
žádnou Apple fakturu nikdy mít nebude.

Zbytek se proto dělí na dva řádky, každý měří přesně to, co říká:

- **„Apple bez faktury"** — vlastní SQL agregát (`category_apple_unmatched_year_spent` v
  `src/routes/budget-items.js`): Apple platby (identifikace přes sdílenou konstantu
  `APPLE_MERCHANT_SQL` v `src/utils/apple-candidates.js` —
  `UPPER(description) LIKE 'APPLE.COM%' OR UPPER(place) LIKE 'APPLE.COM%'`, prefix ne substring)
  BEZ spárované faktury se známým účtem. Podmínka „bez faktury" je přesně `NOT EXISTS` téhož
  poddotazu, jaký používá filtr `apple_account=none` v `src/routes/transactions.js` — jinak by se
  rozpad a proklik rozešly. Patří sem jak faktury bez vazby na transakci vůbec, tak faktury
  spárované, ale s `apple_account IS NULL` (staré řádky před migrací, nebo faktura, ze které se
  účet nepodařilo rozpoznat). Tohle je ten skutečný ukazatel „kolik faktur ještě zbývá přeposlat".
- **„mimo Apple"** — dopočet `category_year_spent[cat] − Σ spent za účty − „Apple bez faktury"`.
  Zbytkové platby v kategorii, které s Applem vůbec nesouvisí (Adobe, OpenAI…). Nemá odpovídající
  filtr v Transakcích (žádná jednoduchá podmínka „vše kromě Apple" tam není), takže se zobrazí
  jako neklikací text ve stejném stylu jako ostatní řádky rozpadu, ne jako odkaz.

Rozpad se zobrazí jen u kategorií, kde je aspoň jedna spárovaná faktura, aby se nekomplikovaly
karty ostatních ročních kategorií.

## 5. Filtr v Transakcích

Nový URL parametr `apple_account`:

- `apple_account=<e-mail>` → jen transakce, ke kterým existuje spárovaná faktura s tímto účtem,
- `apple_account=none` → transakce **bez** spárované faktury se známým účtem (odpovídá řádku
  „Apple bez faktury"; samotný `apple_account=none` totiž vrací i ne-Apple transakce bez
  spárované faktury, protože EXISTS poddotaz nerozlišuje obchodníka).

Druhý parametr `apple_merchant=1` filtruje transakce **stejným prefix predikátem**
(`APPLE_MERCHANT_SQL`), jaký používá agregát „Apple bez faktury". Proklik z UI kombinuje oba —
`apple_account=none&apple_merchant=1` — aby vrátil přesně Apple platby, ze kterých je součet.
Původní návrh počítal s obecným fulltextem `q=APPLE.COM`, ale ten hledá substring napříč deseti
poli (vč. poznámky) a vrátil i transakce, které agregát nezapočítal (např. popis
`PLATBA KARTOU APPLE.COM/BILL`, kde `APPLE.COM` není na začátku, nebo transakci s „apple.com" jen
v poznámce) — proklik pak ukazoval víc řádků, než kolik sečetl součet nad ním. Opraveno zavedením
`apple_merchant=1` s identickým predikátem jako agregát (viz
`.superpowers/sdd/2026-07-31-apple-ucty-rozpad/parity-fix-report.md`).

V `buildTxWhere` (`src/routes/transactions.js:16`) se přidá jako `EXISTS` / `NOT EXISTS`
poddotaz — bez JOINu, aby se nezměnil počet řádků výsledku ani stránkování:

```sql
AND EXISTS (SELECT 1 FROM apple_receipts ar
            WHERE ar.transaction_id = t.id AND ar.user_id = t.user_id
              AND ar.status = 'matched' AND LOWER(ar.apple_account) = LOWER(?))
```

Filtr platí i pro CSV export, protože sdílí `buildTxWhere`.

**Tři místa, kde se nový parametr musí objevit** (projektová konvence):

1. `src/routes/transactions.js` — `buildTxWhere`,
2. `client/src/pages/TransactionsPage.jsx` — allowlist URL parametrů, aby se filtr při načtení
   stránky nezahodil,
3. předání v prokliku z `AnnualBudgetsPage.jsx`.

Fulltextové vyhledávání se o Apple účet **nerozšiřuje** — to by vyžadovalo poddotaz v každém
hledání, a filtr pokrývá potřebu lépe.

## 6. UI

Na kartě roční kategorie v `client/src/pages/AnnualBudgetsPage.jsx` přibude druhý rozklik pod
stávajícím „rozpad podle subkategorie":

```
▾ rozpad podle Apple účtu
   tomas.strida@icloud.com      3 228 Kč
   bisek.martin@icloud.com      1 076 Kč
   xstrt06@centrum.cz             538 Kč
   Apple bez faktury             272 Kč
   mimo Apple                 28 795 Kč
```

Řádky za jednotlivé účty vedou na
`/transactions?category_id=<id>&apple_account=<účet>&from=<rok>-01-01&to=<rok>-12-31`, řádek
„Apple bez faktury" na totéž s `apple_account=none&apple_merchant=1`. Řádek „mimo Apple" proklik nemá —
zobrazí se jako neklikací text ve stejném vzhledu. Recykluje se existující vzhled
(`report-subcat-*` třídy), jen s vlastním stavem rozkliknutí — oba rozpady musí jít otevřít
nezávisle.

Oba dopočtené řádky se zobrazí i pro zápornou hodnotu (např. čisté refundy převýší útratu) —
skryté jsou jen prakticky nulové (`< 0,005`), aby nesedící součet nezmizel beze stopy.

## 7. Doplnění historie

Faktury uložené před touto změnou mají `apple_account = NULL`, ale jejich `raw_text` je v DB.
Jednorázový skript `scripts/migrate-apple-account.cjs` je přeparsuje a doplní jen prázdné
hodnoty. Dry-run je výchozí, zápis až s `CONFIRM=1` — stejný vzor jako ostatní migrační skripty
v projektu.

## 8. Hraniční případy

- **Faktura bez rozpoznaného účtu** — `apple_account` zůstane `NULL` a transakce spadne do
  řádku „Apple bez faktury". Lepší než vymýšlet zástupnou hodnotu.
- **Odpojená faktura** (`status != 'matched'`) do součtů nevstupuje — proto podmínka na stav.
  Jinak by se částka počítala dvakrát: jednou přes fakturu, jednou v „Apple bez faktury".
- **Přeposlání téže faktury** (`duplicate` větev v `src/services/appleReceipts.js`) doplní
  `apple_account`, pokud je v DB `NULL` a parser ho z právě přišlé faktury zná — jinak by faktury
  uložené před zavedením sloupce zůstaly bez účtu navždy, dokud neproběhne jednorázová migrace, a
  nejpřirozenější reakce uživatele (přeposlat fakturu znovu) by nic nespravila a nic by to
  neřekla. Neprázdná hodnota se nikdy nepřepisuje.
- **Dvě faktury na jedné transakci** nemohou nastat — brání tomu kontrola zavedená v balíčku D.
- **Kategorie bez faktur** rozpad nezobrazí vůbec.
- **Household** — vše přes `req.dataUserId`; faktury i transakce jsou sdílené jako ostatní data.

## 9. Testy

- `src/utils/appleInvoiceParser.test.js` — `apple_account` z fixture; faktura bez toho řádku
  vrátí `null`.
- `src/routes/budget-items.test.js` — součet za dva účty; transakce bez faktury se do účtů
  nezapočte; odpojená faktura se nezapočte; součet účtů + „Apple bez faktury" + „mimo Apple" dá
  celek kategorie.
- `src/routes/transactions.test.js` — filtr podle účtu vrátí jen odpovídající transakce;
  `apple_account=none` vrátí ty bez faktury; filtr je case-insensitive; transakce se spárovanou
  fakturou bez rozpoznaného účtu (`status='matched'`, `apple_account IS NULL`) spadne do
  `apple_account=none`; `apple_merchant=1` vrátí jen prefix-match (ne substring — platba
  `PLATBA KARTOU APPLE.COM/BILL` ani „apple.com" jen v poznámce filtrem neprojdou); kombinace
  `apple_account=none&apple_merchant=1` vrátí přesně tytéž transakce a stejný součet jako agregát
  `category_apple_unmatched_year_spent` z `/api/budget-items` (parita proklik/součet).
- `src/services/appleReceipts.test.js` — přeposlání duplicitní faktury doplní `apple_account`,
  když byl v DB `NULL`; neprázdnou hodnotu nikdy nepřepíše.

## 10. Mimo scope

- Zrcadlení účtu do tabulky `transactions`.
- Rozpad podle účtu na jiných stránkách než Roční budgety.
- Fulltextové vyhledávání podle Apple účtu.
- Přiřazení Apple účtu ke konkrétnímu členu domácnosti (Tom / Martin) — dnes stačí e-mail.
- Rozpad podle účtu u měsíčních kategorií (Apple platby jsou v roční `Y_Licence`).
