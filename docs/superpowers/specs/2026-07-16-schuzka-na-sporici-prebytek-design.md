# Design: Schůzka — „Na spořicí" jako vypočtený přebytek

**Datum:** 2026-07-16
**Stav:** schváleno uživatelem
**Kontext:** `client/src/pages/ReportPage.jsx` (bilanční sekce), `client/src/utils/meetingBalance.js`.

## Problém

Bilance na Schůzce (z v2.0.203) má „Na spořicí" jako **měřené netto** převodů na spořicí účet (`savings.net`) a končí řádkem „Zbylo na běžném". Uživatel po reálném použití chce jiný model: „Na spořicí" má být **vypočtený přebytek** (příjmy minus výdaje), a skutečné pohyby na spořicím účtu na Schůzce vůbec nebýt — Schůzka má být čistě plánovací.

## Rozhodnutí z brainstormingu

- **„Na spořicí" = přebytek** = Příjmy − Fixní − Dotace na nepravidelné − Měsíční výdaje − Drahé věci (všechny 4 výdajové řádky, včetně dotace na nepravidelné).
- **Skutečné pohyby na spořicím účtu** (dnešní rozpad `savings.transfers` + netto) se ze Schůzky **odstraní úplně**; dohledatelné přes Transakce (filtr na spořicí účet).

## Řešení

### `client/src/utils/meetingBalance.js`

Nahradit `leftoverOnMain` funkcí `surplusToSavings`:

```js
export function surplusToSavings({ totalIncome, totalFixed, variablePoolFunded, totalType1, totalType3 }) {
  return totalIncome - totalFixed - variablePoolFunded - totalType1 - totalType3;
}
```

(`fixedActualTotal` beze změny.)

### `client/src/pages/ReportPage.jsx`

Bilanční sekce (`report-section--bilance`):
- Řádky Příjmy → Fixní → Dotace na nepravidelné → Měsíční výdaje → Drahé věci beze změny.
- **Odstranit** dnešní mínus řádek „Na spořicí" (`savings.net`), blok rozpadu `savings.transfers`, výsledný řádek „Zbylo na běžném" a starý disclaimer.
- **Přidat** výsledný řádek „**Na spořicí**" (`report-bilance-result`) = `surplusToSavings({...})`; kladný standardně, záporný `text-danger`.
- Nový drobný disclaimer: „Na spořicí = přebytek za období (příjmy minus výdaje). Skutečné pohyby na spořicím účtu najdeš v Transakcích."
- `leftover`/`savingsNet` výpočty a nepoužité `savings.transfers` reference odstranit. `savings` z API se v ReportPage přestane používat (backend `stats/overview` beze změny — YAGNI, neškodí).

## Testy

- `client/src/utils/meetingBalance.test.js` — přejmenovat/nahradit test `leftoverOnMain` za `surplusToSavings` (přebytek = příjmy − 4 výdaje, bez savingsNet). `fixedActualTotal` testy beze změny.
- ReportPage: bez unit testů (JSX), ověření build.

## Mimo scope

- Zobrazení pohybů na spořicím účtu jinde (Transakce už umí filtr) — žádná nová UI.
- Backend `savings`/`transfers` v `stats/overview` se nemaže (dormantní, možné budoucí využití).
