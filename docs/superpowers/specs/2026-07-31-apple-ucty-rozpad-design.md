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

**Řádek „bez faktury".** Rozpad musí sečíst na celek kategorie, jinak porušuje projektové
pravidlo, že zobrazený součet odpovídá datům pod ním. Většina Apple plateb fakturu zatím nemá,
takže se dopočítá zbytek: `category_year_spent[cat] − Σ spent za účty` a zobrazí se jako
poslední řádek `apple_account: null`. Zároveň slouží jako ukazatel, kolik faktur ještě zbývá
přeposlat — jak jich bude přibývat, bude klesat.

Rozpad se zobrazí jen u kategorií, kde je aspoň jedna spárovaná faktura, aby se nekomplikovaly
karty ostatních ročních kategorií.

## 5. Filtr v Transakcích

Nový URL parametr `apple_account`:

- `apple_account=<e-mail>` → jen transakce, ke kterým existuje spárovaná faktura s tímto účtem,
- `apple_account=none` → transakce **bez** spárované faktury (odpovídá řádku „bez faktury").

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
   bez faktury                 11 290 Kč
```

Řádky vedou na `/transactions?category_id=<id>&apple_account=<účet>&from=<rok>-01-01&to=<rok>-12-31`,
řádek „bez faktury" na totéž s `apple_account=none`. Recykluje se existující vzhled
(`report-subcat-*` třídy), jen s vlastním stavem rozkliknutí — oba rozpady musí jít otevřít
nezávisle.

## 7. Doplnění historie

Faktury uložené před touto změnou mají `apple_account = NULL`, ale jejich `raw_text` je v DB.
Jednorázový skript `scripts/migrate-apple-account.cjs` je přeparsuje a doplní jen prázdné
hodnoty. Dry-run je výchozí, zápis až s `CONFIRM=1` — stejný vzor jako ostatní migrační skripty
v projektu.

## 8. Hraniční případy

- **Faktura bez rozpoznaného účtu** — `apple_account` zůstane `NULL` a transakce spadne do
  řádku „bez faktury". Lepší než vymýšlet zástupnou hodnotu.
- **Odpojená faktura** (`status != 'matched'`) do součtů nevstupuje — proto podmínka na stav.
  Jinak by se částka počítala dvakrát: jednou přes fakturu, jednou v „bez faktury".
- **Dvě faktury na jedné transakci** nemohou nastat — brání tomu kontrola zavedená v balíčku D.
- **Kategorie bez faktur** rozpad nezobrazí vůbec.
- **Household** — vše přes `req.dataUserId`; faktury i transakce jsou sdílené jako ostatní data.

## 9. Testy

- `src/utils/appleInvoiceParser.test.js` — `apple_account` z fixture; faktura bez toho řádku
  vrátí `null`.
- `src/routes/budget-items.test.js` — součet za dva účty; transakce bez faktury se do účtů
  nezapočte; odpojená faktura se nezapočte; součet účtů + „bez faktury" dá celek kategorie.
- `src/routes/transactions.test.js` — filtr podle účtu vrátí jen odpovídající transakce;
  `apple_account=none` vrátí ty bez faktury; filtr je case-insensitive.

## 10. Mimo scope

- Zrcadlení účtu do tabulky `transactions`.
- Rozpad podle účtu na jiných stránkách než Roční budgety.
- Fulltextové vyhledávání podle Apple účtu.
- Přiřazení Apple účtu ke konkrétnímu členu domácnosti (Tom / Martin) — dnes stačí e-mail.
- Rozpad podle účtu u měsíčních kategorií (Apple platby jsou v roční `Y_Licence`).
