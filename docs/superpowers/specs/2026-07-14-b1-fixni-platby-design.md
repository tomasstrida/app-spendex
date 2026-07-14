# B-1 Fixní platby – rozšíření + samostatná správa

**Datum:** 2026-07-14
**Stav:** Design – čeká na schválení uživatelem
**Zdroj:** Spendex backlog 13.7.2026, položka „Fixní platby – nová skupina kategorií"
**Balíček:** B (přepracování modelu kategorií), dílčí featura B-1

## Kontext

Fixní platby jsou dnes samostatný subsystém (tabulka `fixed_expenses`), bez
vazby na kategorie. Spravují se **jen inline na Schůzce** (`ReportPage.jsx`),
párují se textovým `match_pattern` proti `description` odchozích transakcí, status
se počítá s globální symetrickou tolerancí 5 % (`paymentStatus` v
`src/utils/recurring.js`).

Backlog chce z fixních plateb „skupinu kategorií" s vlastnostmi **název,
rozmezí částky, frekvence**. Po brainstormingu (volba „oddělené subsystémy"):
fixní platby **zůstávají vlastní tabulkou**, jen se rozšíří a dostanou vlastní
stránku správy. Žádná vazba na `categories`, žádná hierarchie.

## Rozhodnutí z brainstormingu

- **Frekvence** = volný počet měsíců (`frequency_months`, 1 = měsíční, 3 =
  kvartál, 12 = ročně).
- **Rozmezí částky** = ponechat `amount` jako plánovanou (pro bilanci/součty na
  Schůzce) + přidat `amount_min`/`amount_max` = akceptované rozmezí pro status.
  Status ok když skutečná ∈ [min, max]. Migrace existujících: min/max =
  amount ± 5 %.
- **Správa** = nová samostatná stránka „Fixní platby" v sekci Konfigurace
  (plný formulář). Schůzka už **jen zobrazuje** status ✅/⚠️/❌, needituje.

## Rozsah

### 1. Schema (`src/db/schema.js`)

Migrace na konec `initSchema()` (try/catch, jako stávající ALTER příklady):

```sql
ALTER TABLE fixed_expenses ADD COLUMN amount_min REAL;
ALTER TABLE fixed_expenses ADD COLUMN amount_max REAL;
ALTER TABLE fixed_expenses ADD COLUMN frequency_months INTEGER DEFAULT 1;
```

Data-migrace (idempotentní, jen kde chybí): existujícím řádkům dopočítat rozmezí
z dnešní tolerance 5 %:

```sql
UPDATE fixed_expenses
SET amount_min = ROUND(amount * 0.95, 2),
    amount_max = ROUND(amount * 1.05, 2)
WHERE amount_min IS NULL AND amount IS NOT NULL;
```

`frequency_months` má DEFAULT 1 → existující dostanou měsíční.

### 2. Status s rozmezím + frekvenčním oknem (`src/utils/recurring.js`, `src/utils/fixed-expenses.js`)

**`paymentStatus` přepsat na rozmezí.** Dnešní signatura
`paymentStatus(expected, actual, txCount)` s procentní tolerancí →
nová `paymentStatus(min, max, actual, txCount)`:

```js
function paymentStatus(min, max, actual, txCount) {
  if (!txCount || txCount === 0) return 'missing';
  if (min == null || max == null) return null;      // rozmezí nedefinováno
  return (actual >= min && actual <= max) ? 'ok' : 'mismatch';
}
```

`MATCH_TOLERANCE_PCT` konstanta zůstává (používá ji `incomeStatus` a
data-migrace výše). `incomeStatus` beze změny.

**Frekvenční okno v `fixedExpensesForPeriod`.** Dnes se matchující transakce
sčítají v aktuálním období. Nově se sčítají v **okně posledních
`frequency_months` období** končícím aktuálním obdobím:

- `frequency_months = 1` → okno = aktuální období (beze změny chování pro dnešní
  měsíční platby).
- `frequency_months = N > 1` → okno začíná o (N−1) období dříve. Rolling window:
  kvartální platba je „ok", dokud v posledních 3 obdobích dorazila platba
  v rozmezí; jinak „missing" (ještě/už nedorazila).

Start okna se odvodí z `getPeriodDates(billingDay, addPeriods(period, -(N-1)))`
(použít stávající `addPeriods`/`period.js`). `actual = SUM(ABS(amount))`
matchujících tx v okně, `status = paymentStatus(row.amount_min, row.amount_max,
actual, tx_count)`.

Account-based fixní výdaje (účty `role='fixed'`, řádky s `id=NULL`) zůstávají
beze změny.

### 3. Route (`src/routes/fixed-expenses.js`)

`POST` a `PATCH` rozšířit o `amount_min`, `amount_max`, `frequency_months`:
- validace: pokud jsou min i max zadané, `min <= max` (jinak 400).
- `frequency_months`: kladné celé číslo ≥ 1 (default 1).
- `amount` (plán) zůstává povinné v POST (bilance ho potřebuje).
- ownership beze změny (`user_id`/`dataUserId`).

### 4. Nová stránka správy (`client/src/pages/FixedExpensesPage.jsx`)

- Route `/fixed-expenses`, odkaz v levém menu v sekci **Konfigurace** (vedle
  Kategorie/Pravidla; sekce má `margin-top:auto` odspodu).
- CRUD seznam + formulář s poli: **Název**, **Plánovaná částka** (`amount`),
  **Min** (`amount_min`), **Max** (`amount_max`), **Frekvence (měsíce)**
  (`frequency_months`), **Pattern transakce** (`match_pattern`, volitelný),
  **Poznámka** (`note`), pořadí (`sort_order`).
- Volá stávající `/api/fixed-expenses` (bez `period` → holé položky pro správu).
- Match existujícím vzhledovým konvencím (RulesPage/CategoriesPage vzor).

### 5. Schůzka (`client/src/pages/ReportPage.jsx`)

- **Odstranit** inline `FixedExpenseForm` (řádky ~32–76) a tlačítko „Přidat" +
  edit/delete akce ze sekce Fixní platby (~551–620). Správa se přesouvá na novou
  stránku.
- Sekce Fixní platby zůstane **read-only**: status ikona ✅/⚠️/❌, název, u
  `mismatch` skutečná vs očekávané **rozmezí** (místo dnešní jedné částky),
  u `missing` „chybí". Souhrn počtů + řádek „Fixní platby celkem" (= Σ `amount`)
  beze změny.

## Datová konfigurace (mimo mechanismus – potvrdit při implementaci)

Backlog uvádí 7 plateb: **Nájem Stodola, Záloha PRE, Nájem rezerva, Splátka
auta RAV4, Splátka AirBank, Splátka Buřinka 1, Splátka Buřinka 2**. Dnešní prod
má 5 jiných (vč. T-Mobile, Nordic internet, Nájem Stodůlky).

Migrace **nemaže ani neseeduje** – jen přidá sloupce a dopočítá min/max
existujícím. Úpravu seznamu (přejmenování Stodůlky→Stodola, přidání Buřinka/
AirBank/Nájem rezerva, rozhodnutí o T-Mobile/Nordic) provede uživatel ručně na
nové stránce po nasazení. **Otevřená otázka k potvrzení:** zůstávají T-Mobile a
Nordic jako fixní platby, nebo se přesouvají jinam?

## Testy

- `src/utils/recurring.test.js` (nebo obdoba): nový `paymentStatus(min, max,
  actual, txCount)` – ok uvnitř rozmezí, mismatch pod/nad, missing bez tx, null
  bez rozmezí. Hraniční: actual = min i = max → ok.
- `src/utils/fixed-expenses.test.js`: frekvenční okno – `frequency_months=1`
  hledá v aktuálním období; `=3` najde platbu z −2 období jako ok; bez platby
  v okně → missing.
- Route test: POST/PATCH přijme nová pole; validace min>max → 400.
- Schema test: po migraci má `fixed_expenses` sloupce `amount_min`, `amount_max`,
  `frequency_months`; existující řádek má dopočítané min/max.

## Non-goals (mimo B-1)

- Vazba fixních plateb na `categories` (zůstávají oddělené).
- Licence subkategorie (B-2), Účetní/Převody (B-3), Drahé věci (odloženo).
- Automatické zakládání/seed nového seznamu 7 plateb do prod.

## Nasazení

Commit + push do `staging` (Railway staging), po vizuální kontrole na pokyn
merge `staging` → `main` (prod). Hlásit číslo verze.
