# Schůzka — blok „Kam šly peníze za měsíc"

**Datum:** 2026-07-17
**Stav:** schváleno (brainstorming), k implementaci

## Cíl

Uživatel chce na Schůzce vidět **kompletní přehled všech výdajů** a proč na spořicím
účtu nezůstalo tolik, kolik by podle přebytku mělo. Nový samostatný blok, který
**nemění** stávající bilanci ani její přebytek.

## Kontext a klíčová zjištění (z průzkumu dat, ne z domněnek)

- Přebytek na Schůzce (příjmy − fixní − dotace − měsíční typ1 − drahé typ3) **neodpovídá**
  tomu, co reálně přibude na spořicím (net převodů). V květnu: přebytek +16 972 vs net −2 000.
- Příčiny mezery (proto **nejde** haléřový reconciliation a blok ho neslibuje):
  1. **Klasifikace výdajů se v appce rozchází** — „Měsíční výdaje" berou z rozpočtů
     (`budgets.category_type`), který se u části kategorií liší od `categories.type`
     ve statistikách. Proto blok stojí **nezávisle na typech kategorií**.
  2. **Fixní platby se párují napříč účty** podle popisu → překryv s výdaji z účtů.
  3. **Peníze se přelévají** přes fondy (Nepravidelné, Rezerva), OSVČ a tranzitní Hlavní
     → i po započtení všech výdajů zbyde zbytek jdoucí na zůstatek běžného účtu.
- **Role účtů zůstávají** (průzkum: hluboce zapuštěné v stats/budgets/transactions/income —
  nelze zrušit). Ve featuře se uživateli nezobrazují; slouží jen „pod kapotou" k odlišení
  výdajových účtů (`role='spending'`) od OSVČ/tranzitu.

## Blok „Kam šly peníze za měsíc" (na Schůzce, za bilancí)

```
Kam šly peníze za měsíc
  Příjmy                                   + <totalIncome>     [proklik: příchozí]
  Výdaje z výdajových účtů                 − <outflow.total>
      <kategorie 1>                        − <sum>   [proklik: kategorie, spending_only]
      <kategorie 2>                        − <sum>
      … všechny kategorie sestupně …
      Nezařazené                           − <sum>   (pokud > 0)
  ─────────────────────────────────────────
  Zůstalo (mělo jít na spořicí)            = <income − outflow>
  Skutečně na spořicí (net)                <savings.net>
  Rozdíl → zůstalo na běžném / přelévání   <mělo − net>
```

Pod blokem vysvětlivka: *„Výdaje jsou všechny reálné platby z výdajových účtů (bez převodů
mezi vlastními účty). Rozdíl na posledním řádku není chyba — jsou to peníze, které zůstaly
na běžném účtu nebo se přelily mezi účty (fondy, OSVČ)."*

## Definice výpočtu (klíčové pro robustnost)

**Výdaje z výdajových účtů** = za období, z transakcí:
- `role='spending'` účet (přes `EXISTS accounts a … a.role='spending'`; zahrnuje i `account_id IS NULL`
  konzistentně se stávajícím `SPENDING_FILTER`),
- **mimo interní převody** — vyloučit transakce, jejichž `counterparty_account` je jedno
  z vlastních čísel účtů (normalizace jako v `utils/income.js`; toto vyřadí vklady na spořicí,
  dotace do fondů, přesuny mezi účty),
- agregace `SUM(-amount)` **po kategoriích** (konzistentní s „utraceno" jinde v appce — refundy
  stejnou kategorií se odečtou), včetně „Nezařazené" pro `category_id IS NULL`,
- **bez ohledu na typ kategorie** (typ 1/2/3/4 se nerozlišuje — cílem je úplnost, ne rozpočtová
  klasifikace).

**Příjmy** = aliasované příjmy (`income.sources` s `id != null`, `actual`) — stejně jako bilance.

**Net na spořicí** = `savings.net` z `stats/overview` (beze změny; net z převodů, ne změna zůstatku).

## Backend

Rozšířit `GET /api/stats/overview` o nový klíč:

```
outflow: {
  total: <Σ SUM(-amount)>,
  by_category: [{ category_id, name, color, sum }]  // sestupně dle sum, nezařazené jako name=null
}
```

Výpočet ve `src/routes/stats.js`: načíst relevantní transakce a spočítat s vyloučením interních
převodů (normalizace counterparty vůči `accounts.account_number`). Pomocná normalizace se
sdílí/duplikuje z `utils/income.js` (jedno místo pravdy, přidat helper do utils, pokud se hodí).

## Frontend

`client/src/pages/ReportPage.jsx` — nová sekce za bilancí:
- Řádek Příjmy (proklik `direction=in`), řádek Výdaje celkem, pod ním seznam kategorií
  (proklik `/transactions?category_id=X&period=Y&spending_only=1`), řádky Zůstalo / Skutečně
  na spořicí / Rozdíl. Reuse tříd `report-bilance-row`, `report-section`, `report-subtotal`.
- Data z už načteného `stats` (rozšíří se o `outflow`) + `incomeSources` (už načteno).

## Rozklik

„Souhrn" = řádek kategorie s částkou; „rozklik" = proklik do Transakcí filtrovaných na kategorii
+ období + `spending_only` (zavedený vzor Schůzky). Bez inline expandu (jednodušší, konzistentní).

## Mimo rozsah (YAGNI)

- Žádná změna stávající bilance ani přebytku.
- Žádné sjednocování klasifikace měsíční/roční (samostatný větší projekt).
- Žádná změna rolí účtů.
- Žádný pokus o haléřovou shodu přebytek = spořicí.

## Testy

- Backend: nový výpočet `outflow` — vyloučení interních převodů, agregace po kategoriích,
  nezařazené, jen `role='spending'`. Testy v `src/routes/stats.test.js`.
- Frontend: součet/rozdíl v bloku (pokud se vytáhne do helperu — pak unit test).

## Verze

Auto-bump patch (pre-commit hook).
