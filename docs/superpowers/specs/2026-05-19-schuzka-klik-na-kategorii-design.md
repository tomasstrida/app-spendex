# Schůzka: klik na kategorii v „Měsíční výdaje" → filtr transakcí

**Datum:** 2026-05-19
**Soubor:** `client/src/pages/ReportPage.jsx`
**Kontext:** Drobné UX propojení. `TransactionsPage` už čte URL parametry `?category_id=<id>&period=<YYYY-MM>` (`useSearchParams`: `period` → stav období, `category_id` → `filterCats` Set). Stačí udělat řádky sekce „Měsíční výdaje" klikatelné a navigovat tam s aktuálně zobrazeným obdobím Schůzky.

## Problém

Na Schůzce v sekci „Měsíční výdaje" uživatel vidí utracené částky per kategorie, ale nemá jak se rychle dostat na seznam konkrétních transakcí té kategorie za dané období.

## Cíl

Klik na řádek kategorie v sekci **„Měsíční výdaje"** přejde na `/transactions?category_id=<b.category_id>&period=<aktuální period Schůzky>` → TransactionsPage se otevře předfiltrovaný na tu kategorii a období.

## Rozhodnutí (potvrzeno uživatelem)

- Platí **jen pro sekci „Měsíční výdaje" (Typ 1, `budgets`)**. „Roční/sezónní" a „Drahé věci" zůstávají needitovatelné (mimo rozsah).

## Návrh

V `ReportPage.jsx`:
- Import `Link` z `react-router-dom`.
- V sekci „Měsíční výdaje" (mapování `budgets.map(b => ...)`) obalit řádek `report-budget-row` komponentou `Link` s `to={`/transactions?category_id=${b.category_id}&period=${period}`}`. `period` je stávající stav komponenty (právě zobrazené období Schůzky); pokud by byl null (nemělo by nastat, budgets se renderují až po načtení), parametr `period` vynechat.
- `Link` dostane `className="report-budget-row"` (převezme stávající layout) + inline styl `{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }`, aby vypadal a fungoval jako dosavadní řádek, jen klikatelný. Vnitřní `<span>`y beze změny. `key` zůstává `b.category_id` na `Link`.
- Žádná jiná sekce/řádek se nemění.

> Pozn.: `Link` je `<a>` — funguje i middle-click / otevřít v nové kartě, je přístupný. `report-budget-row` je flex kontejner; `Link` s touž třídou layout zachová.

## Mimo rozsah (YAGNI)

- Žádná změna „Roční/sezónní" ani „Drahé věci".
- Žádná změna `TransactionsPage` (URL parametry už podporuje).
- Žádný nový hover/CSS stav nad rámec `cursor: pointer` (neměnit `App.css`).
- Žádné předávání dalších filtrů (amount apod.).

## Testy

Žádné automatické FE testy v projektu. Ověření: `npm run build` (0 chyb) + grep, že `Link` s `to=/transactions?category_id=...&period=...` je v sekci Měsíční výdaje a ostatní sekce nedotčené. Manuální kontrola na staging: klik na kategorii v Měsíční výdaje otevře Transakce filtrované na tu kategorii a stejné období.

## Dopad / rizika

- Čistě FE, aditivní; `TransactionsPage` kontrakt už existuje (žádná backend změna).
- `filterCats` na TransactionsPage se z `category_id` inicializuje jako Set s jedním prvkem (řetězec id) — `b.category_id` číslo se v URL serializuje na string, což odpovídá očekávání cílové stránky.
- Riziko minimální: pokud `b.category_id` chybí (nemělo by — Typ 1 budget má kategorii), odkaz by mířil na `category_id=undefined`; ošetřit tím, že `Link` se použije jen když `b.category_id != null`, jinak ponechat původní `div` (bezpečný fallback).
