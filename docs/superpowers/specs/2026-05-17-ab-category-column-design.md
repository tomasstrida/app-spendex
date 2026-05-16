# Sloupec původní AirBank kategorie + zobrazení v transakcích

**Datum:** 2026-05-17
**Stav:** návrh ke schválení

## Kontext

Uživatel chce u transakcí vidět **původní AirBank kategorii** (kvůli kontrole, jak
proběhla automatická kategorizace přes 3vrstvá pravidla). Druhý požadavek (skrývání
sloupců v tabulce transakcí) je **už hotový** — `TransactionsPage.jsx` má kompletní
column picker (`ALL_COLS`, ikona Columns3, localStorage `spendex_tx_cols`, vždy
viditelné Datum/Popis/Částka). Rozsah se proto zužuje jen na perzistenci a zobrazení
AirBank kategorie.

`ab_category` se dnes parsuje (`src/utils/csvParser.js`) a používá pro kategorizaci
(`apply-rules`, `airbank_category_mappings`), ale **neukládá** se na transakci.

## Cíl

Uložit původní AirBank kategorii ke každé importované transakci a zobrazit ji jako
sloupec „AirBank kat." v tabulce transakcí (viditelný defaultně, skrývatelný přes
existující picker).

## 1. Backend

### 1.1 Migrace schématu
`src/db/schema.js`, do pole `migrations` (try/catch jako ostatní `ALTER`):
```
ALTER TABLE transactions ADD COLUMN ab_category TEXT
```
Idempotentní (selže-li „duplicate column", catch ji spolkne). Sloupec nullable.

### 1.2 Persistence v import cestách
Obě cesty, které vkládají transakce, musí `ab_category` ukládat (jinak příští import
sloupec nenaplní):

- **`scripts/rebuild.cjs`** — do `INSERT OR IGNORE INTO transactions (...)` přidat
  sloupec `ab_category` a hodnotu `t.ab_category || null`.
- **`src/routes/import.js`** — do jeho `INSERT ... INTO transactions` (kolem řádku 72)
  přidat `ab_category` a hodnotu `t.ab_category || null`.

### 1.3 API
`GET /api/transactions` používá `SELECT t.*` → `ab_category` se vrátí automaticky.
Žádná změna routy.

### 1.4 Backfill stávajících dat
Nový `scripts/backfill-ab-category.cjs` (nedestruktivní, jen UPDATE):
- Env: `DB_PATH` (povinné), `CSV_DIR` (povinné), `CONFIRM` ('1' = commit; jinak
  dry-run + ROLLBACK).
- Pro každý CSV soubor (auto-detekce dle čísla účtu v názvu, regex `/airbank_(\d+)/`,
  stejně jako rebuild) parse přes `parseAirBankCSV`.
- Sestavit klíč `external_id` = `${t.external_id}-${accountNumber}` (shodně s
  `rebuild.cjs`), hodnotu `t.ab_category`.
- `UPDATE transactions SET ab_category = ? WHERE user_id = 1 AND external_id = ? AND
  ab_category IS NULL` pro každý záznam s ne-null external_id.
- Transakčně (BEGIN/COMMIT nebo ROLLBACK), report: počet doplněných řádků, počet
  CSV záznamů bez external_id (nelze spárovat), počet CSV řádků celkem.
- Dry-run je default; `CONFIRM=1` → COMMIT. Bez VACUUM zálohy (nedestruktivní UPDATE
  jen prázdného sloupce), ale skript transakci při chybě rollbackuje.

## 2. Frontend (`client/src/pages/TransactionsPage.jsx`)

- **`ALL_COLS`**: vložit `{ key: 'ab_category', label: 'AirBank kat.', default: true }`
  bezprostředně **za** položku `category_name` (logické porovnání Kategorie ↔ AirBank).
- **Render buňky**: nový `case 'ab_category'` v render switchi → prostý text
  `tx.ab_category || '—'`, tlumený styl (reference, ne primární data). Šířka ~130px
  (konzistentní s ostatními textovými sloupci, viz `dataCols` mapování šířek).
- **localStorage**: `LS_KEY` změnit z `'spendex_tx_cols'` na `'spendex_tx_cols_v2'`.
  Resetuje uloženou volbu sloupců na defaulty (akceptovaný tradeoff — jediný uživatel,
  jednodušší než merge logika).

## 3. Testy a rollout

### Testy
- Migrace: idempotentní `ALTER` v try/catch.
- Backfill: dry-run na konzistentní kopii prod DB lokálně — ověřit počty
  (doplněno ≈ 1012, bez shody = 0 nebo malé, total = 1012); pak prod dry-run; pak
  `CONFIRM=1`.
- Frontend: manuální ověření v prohlížeči (dev server `npm run dev:client` + backend)
  — sloupec „AirBank kat." se zobrazí, picker ho skryje/zobrazí, hodnoty odpovídají
  importu, porovnání vůči „Kategorie" dává smysl.

### Pořadí nasazení
1. **Migrace na prod** přes `railway ssh` (sloupec musí existovat před backfillem).
2. **Commit kódu na `staging`** (schema.js, rebuild.cjs, import.js, ALL_COLS, render,
   LS_KEY, backfill skript).
3. **Backfill prod dat**: bundle skriptu + CSV na prod, dry-run → `CONFIRM=1`.
4. **Deploy frontendu na prod** (`staging`→`main`) na výslovný pokyn „push do prod" —
   sloupec se v UI zobrazí až po deployi buildu.

## 4. Rizika

- Nízká. Nedestruktivní backfill (UPDATE jen prázdného sloupce), idempotentní
  migrace, sloupec nullable.
- Řádky s null `external_id` v CSV nelze spárovat při backfillu — dle předchozího
  zjištění AirBank CSV ref. číslo vždy má (0 takových případů v prod), report to
  ohlásí, kdyby nastalo.
- Bump `LS_KEY` resetuje uživatelskou volbu sloupců na defaulty — akceptováno.

## 5. Mimo rozsah

- Skrývání sloupců (už implementováno).
- Editace AirBank kategorie z UI / přemapování (samostatný follow-up: admin UI
  pravidel, viz spec rebuildu §8).
