# Fáze A — kategorie přebíjí účet ve výpočtech výdajů

**Datum:** 2026-07-18
**Stav:** schváleno (navazuje na fázi B „Revize zařazení"), k implementaci

## Cíl

Výdaj se **skutečnou kategorií** (typ 1/2/3, kromě „Mimo systém"/„Pravidelné platby")
se má počítat jako výdaj domácnosti **i když je zaúčtovaný na účtu `role='ignored'`**
(Spořicí, zz-Hromadné akce, Tom-AirBank, Hlavní, Dane-doplatek). Dnes ho
`SPENDING_FILTER` (role='spending') ze všech výpočtů vyřadí a „zmizí".

## Rozsah rozhodnutí (z diskuse)

- **income (OSVČ) zůstává tvrdě mimo** — nikdy se nepočítá (má 481k v „reálných"
  kategoriích = business).
- **`Mimo systém` a `Pravidelné platby`** se nikdy nezapočítají (vědomě mimo / fixní).
- Účet `role='spending'` a `account_id IS NULL` se počítají jako dosud.
- Interní převody: reálné interní převody mají kategorii `Převody interní` (typ 4)
  nebo `Mimo systém` → oba jsou fragmentem vyloučeny, takže není nutná zvláštní
  counterparty kontrola.

## Řešení: jeden sdílený SQL fragment

Dnes je „filtr výdajů" duplikovaný na 3 místech (stats.js, budgets.js, transactions.js)
jako varianty `role='spending'`. Vytáhnu ho do **jednoho sdíleného fragmentu**
`src/utils/spending-filter.js`:

```
(
  t.account_id IS NULL
  OR EXISTS (accounts sfa: sfa.id = t.account_id AND sfa.role = 'spending')
  OR (
    EXISTS (accounts sfa2: sfa2.id = t.account_id AND sfa2.role = 'ignored')
    AND EXISTS (categories sfc: sfc.id = t.category_id
                AND sfc.type IN (1,2,3) AND sfc.name NOT IN ('Mimo systém','Pravidelné platby'))
  )
)
```

- Alias tabulky transakcí musí být `t`. Vlastní aliasy `sfa/sfa2/sfc` nekolidují.
- Export: `SPENDING_WHERE` (bez úvodního `AND`) + helper `andSpending()` = `' AND ' + SPENDING_WHERE`.

## Místa k úpravě

- `src/routes/stats.js`: `SPENDING_FILTER` const + 2 inline kopie (byCategory, trend)
  + expensive_items → všechny na sdílený fragment. (accounting type=4 zůstává BEZ filtru.)
- `src/routes/budgets.js`: inline `role='spending'` → sdílený fragment.
- `src/routes/transactions.js`: `spending_only=1` větev v `buildTxWhere` → sdílený fragment
  (aby proklik ze Schůzky seděl s čísly).

## Důsledky / na co upozornit uživatele

- Dokud nejsou data vyčištěná přes Revizi, započítají se i **špatně zařazené** položky
  (např. „Tomáš Střída – převod do RB" v „Drahé věci"). Revize a fáze A koexistují:
  A počítá, Revize ukazuje ke kontrole; přeřazení na „Mimo systém" ho z obojího odstraní.
- Čísla výdajů/rozpočtů/Schůzky se **zvýší** o výdaje z ignorovaných účtů s reálnou
  kategorií. To je záměr.

## Testy

- `src/utils/spending-filter.test.js` nebo rozšířit `stats.test.js`:
  - drahá věc (typ 3) na `ignored` účtu → se počítá (by_category, total).
  - `Mimo systém`/`Pravidelné platby` na ignored účtu → NEpočítá.
  - income účet s reálnou kategorií → NEpočítá.
  - spending účet i `account_id IS NULL` → počítá (beze změny).
- `budgets.test.js`: čerpání zahrne drahou/typ1 z ignored účtu (dle typu).
- `transactions.test.js`: `spending_only=1` vrátí i tx z ignored účtu s reálnou kategorií.

## Verze

Auto-bump patch.
