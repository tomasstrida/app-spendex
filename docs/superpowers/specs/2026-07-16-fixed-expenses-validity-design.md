# Okno platnosti fixních plateb (valid_from / valid_to)

**Datum:** 2026-07-16
**Stav:** schváleno uživatelem (design), čeká na implementační plán

## Problém

Tabulka `fixed_expenses` je bezčasová — řádek platí pro všechna období. Při změně
poskytovatele (zrušen NORDIC internet, nově T-Mobile) neexistuje dobrá cesta:

- smazání řádku zpětně vymaže platbu z historických období (Schůzka),
- ponechání řádku způsobí trvalý falešný alert ⚠️ „platba nedorazila",
- přepsání řádku na nového poskytovatele zfalšuje historii (staré období by
  ukazovalo název i částku nástupce).

Požadavek uživatele: **historie musí sedět přesně** — NORDIC v květnu,
T-Mobile od srpna, včetně tehdejších očekávaných částek a statusů.

## Řešení

Každý řádek `fixed_expenses` dostane volitelné okno platnosti vyjádřené
v periodKey (`"YYYY-MM"`). Výměna poskytovatele = uzavření starého řádku
(`valid_to`) + založení nového řádku (`valid_from`). Stejný mechanismus pokryje
i zdražení (ukončit starý řádek, založit nový s novou částkou).

Zvažované alternativy: (B) smazat + přidat bez změny schématu — zamítnuto,
lže historie; (C) řetězení náhrad `replaced_by_id` + tlačítko „Nahradit" —
zamítnuto jako YAGNI, okno platnosti pokryje totéž bez další vazby.
UX rozhodnutí uživatele: jen pole „Platí od/do" ve formuláři, žádné tlačítko
„Nahradit", ukončené řádky zůstávají viditelné (ztlumené).

## 1. Datový model

Migrace na konec `initSchema()` v `src/db/schema.js` (standardní `ALTER TABLE`
v try/catch bloku):

- `valid_from TEXT` — periodKey `"YYYY-MM"`; `NULL` = platí odjakživa
- `valid_to TEXT` — periodKey `"YYYY-MM"` (včetně); `NULL` = platí navždy

Porovnání period je čistě stringové (`"2026-07" <= "2026-08"` platí
lexikograficky). Existující řádky zůstávají `NULL/NULL` → chování beze změny.

## 2. Backend logika (`src/utils/fixed-expenses.js`)

`fixedExpensesForPeriod(db, userId, period)`:

- **S `period`:** manuální řádky se filtrují podmínkou
  `(valid_from IS NULL OR valid_from <= period) AND (valid_to IS NULL OR valid_to >= period)`.
- **Bez `period`** (editační seznam na FixedExpensesPage): vrací **všechny**
  řádky včetně ukončených — jinak by ukončený řádek nešel zpětně upravit.
- **Dedup account-řádků:** množiny `patterns` a `cpTargetSet` (vynechávání
  transakcí z účtů role='fixed', které odpovídají ručnímu matcheru) se staví
  **jen z řádků platných v daném období**. Ukončený matcher nesmí schovávat
  platby, které už k žádnému manuálnímu řádku nepatří.
- **Frekvence > 1:** rolling okno matchování (`freq-1` měsíců zpět) se nemění.
  Filtr platnosti se aplikuje na zobrazované období, ne na okno matchování.

## 3. API (`src/routes/fixed-expenses.js`)

POST i PATCH přijmou volitelná pole `valid_from` / `valid_to`:

- formát: `null` nebo string odpovídající `^\d{4}-\d{2}$`, jinak 400,
- pokud jsou vyplněná obě, musí platit `valid_from <= valid_to`, jinak 400,
- PATCH zachovává stávající sémantiku „nezaslané pole = beze změny"
  (`!== undefined` vzor jako u ostatních polí).

Žádný nový endpoint.

## 4. UI (`client/src/pages/FixedExpensesPage.jsx`)

- Formulář (přidání i editace): 2 volitelná pole „Platí od" / „Platí do"
  (`<input type="month">`).
- Seznam: řádky s `valid_to` < aktuální období vizuálně ztlumené se štítkem
  „ukončeno 7/2026"; řádky s `valid_from` > aktuální období štítek „od 8/2026".
  „Aktuální období" = aktuální kalendářní měsíc spočtený na klientu
  (`YYYY-MM` z dnešního data) — jde o kosmetický štítek, billing day se
  nezohledňuje (stránka volá API bez `period`, statusy plateb se zde nezobrazují).
- Schůzka/Report (`ReportPage.jsx`) žádnou změnu nepotřebuje — filtrování
  proběhne na backendu přes `period`.

## 5. Testy

Rozšíření `src/utils/fixed-expenses.test.js`:

- řádek s `valid_to` v minulosti se v novějším období nevrací, ve starším ano,
- řádek s `valid_from` v budoucnu se v dřívějším období nevrací,
- `NULL/NULL` řádky beze změny chování,
- dedup account-řádků nebere matchery ukončených/nezačatých řádků,
- volání bez `period` vrací i ukončené řádky.

Route testy (`src/routes/fixed-expenses.test.js`): validace formátu
a `valid_from <= valid_to` na POST/PATCH.

## Postup uživatele po nasazení

1. NORDIC → editace → „Platí do" = poslední období, kdy se reálně platil
   (např. 2026-07).
2. Nový řádek „Internet T-Mobile" → „Platí od" = 2026-08, číslo účtu příjemce
   do `match_counterparty_account` (ne do textového patternu).
