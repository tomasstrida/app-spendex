# Schůzka: hover efekt na klikatelných řádcích Měsíční výdaje

**Datum:** 2026-05-19
**Soubor:** `client/src/App.css`
**Kontext:** Follow-up k „klik na kategorii" (v1.1.94). Klikatelné řádky Měsíčních výdajů nemají hover affordance — vizuálně se neliší od neklikatelných řádků jiných sekcí, jen kurzor signalizuje klikatelnost. Uživatel si vyžádal dříve navržený jemný hover.

## Cíl

Jemné zvýraznění řádku při najetí myší, **jen na klikatelných řádcích** sekce „Měsíční výdaje". Konzistentní se zavedeným vzorem `.tx-row:hover` (background `var(--bg2)`, zaoblení).

## Návrh

Pouze CSS, žádná JSX změna. Klikatelné řádky jsou jediné `<a>` s třídou `report-budget-row` (ostatní sekce — Roční/sezónní, Drahé věci, Spoření — jsou `<div>`). Selektor `a.report-budget-row` tedy zasáhne přesně jen je.

Do `client/src/App.css` přidat (poblíž existujících `.report-budget-row` pravidel, ~ř. 413):

```css
a.report-budget-row { transition: background 0.12s; }
a.report-budget-row:hover { background: var(--bg2); border-radius: 6px; }
```

- Žádný padding/negativní margin (žádné riziko posunu layoutu / nezarovnání vůči ostatním sekcím).
- `var(--bg2)` + `border-radius` = stejný jazyk jako `.tx-row:hover` (řádek dříve v App.css). `transition` jemnost.

## Mimo rozsah (YAGNI)

- Žádná změna neklikatelných sekcí (div řádky bez hoveru — záměr).
- Žádný JSX zásah do `ReportPage.jsx`.
- Žádné focus/active stavy nad rámec hoveru (anchor má nativní focus z prohlížeče).

## Testy

Žádné FE testy. Ověření: `npm run build` (0 chyb) + grep, že selektor `a.report-budget-row:hover` je v App.css. Manuální: na Schůzce řádek Měsíčních výdajů při najetí myší zesvětlí pozadí; řádky Roční/sezónní/Drahé věci/Spoření hover NEMAJÍ.

## Dopad / rizika

- Čistě kosmetické, scopováno selektorem na `<a>` → nulové riziko zásahu do neklikatelných sekcí.
- Žádná změna chování ani backendu.
