# Fallback obchodního místa u transakcí bez `place`

Datum: 2026-08-02

## Problém

Sloupec „Obchodní místo" (`transactions.place`) plní parsery jen u kartových plateb
a korekcí karetní blokace. U QR plateb, převodů, inkas a poplatků zůstává prázdný,
i když z transakce víme, komu peníze šly.

Referenční případ (prod, id 6077):

```
date:                 2026-07-25
amount:               -230
description:          "káva na vodě ve stánku"        ← Zpráva pro plátce
note:                 "káva na vodě ve stánku - platba QR převodem"
place:                NULL
counterparty_account: "201220675/0600"
```

Rozsah v prod DB (2 178 transakcí):

| stav | počet |
|---|---|
| `place` prázdné | 846 |
| z toho s protiúčtem | 759 |
| … z toho interní účet (známe název) | 464 |
| … z toho externí účet (jen číslo) | 295 |
| bez protiúčtu (inkaso, poplatky) | 87 |

## Rozhodnutí: zobrazovací fallback, ne zápis do dat

`place` není jen prezentační pole. Vstupuje do:

- `src/utils/apply-rules.js` — haystack textových pravidel je `description + note + place`
- `src/utils/fixed-expenses.js` — matcher fixní platby hledá pattern v `description/note/place`
- `src/utils/apple-candidates.js` — detekce Apple plateb přes `place LIKE 'APPLE.COM%'`

Naplnění `place` číslem účtu by rozšířilo to, co tyto matchery vidí → riziko falešných
shod textových pravidel a dvojího započtení fixní platby (ta se matchuje účtem i patternem).
Proto se **DB nemění**; odvozená hodnota vzniká až při zobrazení.

Zamítnuté alternativy:

- **Zápis do `place` při importu + retro migrace 759 transakcí** — riziko výše, navíc nutný dry-run na prod.
- **Nový sloupec `place_display`** — stejný efekt jako zobrazovací fallback, ale za cenu dalšího sloupce ve schématu a plnění na dvou místech.

## Logika odvození

```
placeDisplay(tx, accountNameMap):
  1. tx.place neprázdné                    → tx.place
  2. counterparty_account = interní účet   → "1679014138/3030 · Hlavní"
  3. counterparty_account externí          → "201220675/0600"
  4. jinak                                 → null
```

Formát „číslo · název" je shodný s tím, co už používá sloupec protistrany
(`client/src/utils/accountName.js`).

Porovnání čísel účtů = kompletní `[předčíslí-]číslo/kódbanky`, ořezávají se jen mezery
(`normalizeAccountNumber`) — konvence projektu, identita účtu je celé číslo.

Referenční případ vyjde jako `201220675/0600` (externí účet stánku).

## Implementace

### Klient — tabulka Transakce

- `client/src/utils/accountName.js`: přidat `placeDisplay(tx, nameMap)`.
- `client/src/pages/TransactionsPage.jsx`, `case 'place'` (~ř. 1164): místo `tx.place || '—'`
  volat `placeDisplay`. `accountNameMap` je na stránce už k dispozici (ř. 68).
- Odvozená hodnota se renderuje ztlumeně třídou `.text-muted` (= `var(--text2)`, existující
  konvence projektu — pozor, proměnná `--text-muted` použitá v `App.css:461` nikde definovaná
  není), skutečné obchodní místo od banky normálně. Bez ikon a tooltipů.

### Server — CSV export

- Nový `src/utils/place-display.js` (CJS ekvivalent klientského utilu).
- `src/routes/transactions.js`, export (~ř. 199): načíst mapu účtů jedním dotazem
  `SELECT account_number, name FROM accounts WHERE user_id = ?` a spočítat hodnotu v JS.
  **Ne** druhým JOINem na `accounts.account_number` — při duplicitním čísle účtu by
  rozmnožil řádky exportu.

### Testy

Unit testy pro obě implementace (klient `node --test client/src/utils/*.test.js`,
backend `node --test 'src/**/*.test.js'`) na čtyřech větvích: vyplněné `place`,
interní protiúčet, externí protiúčet, bez protiúčtu. Logika žije ve dvou souborech
(ESM vs. CJS), testy hlídají, aby se nerozjela.

## Co se vědomě nemění

- DB, parsery, kategorizační pravidla, matcher fixních plateb, Apple detekce, dedup.
- Fulltextové hledání v Transakcích prohledává dál jen uložený `place` — hledání „Hlavní"
  tyto transakce přes obchodní místo nenajde. Interní účty jsou dohledatelné filtrem
  na protistranu; zásah do dat kvůli tomu není opodstatněný.
- 87 transakcí bez protiúčtu zůstane s „—"; fallback na `description` by jen duplikoval
  sloupec Popis.
- Ostatní místa, kde je `place` použit jako fallback popisu (ImportPage, ReviewPage),
  zůstávají beze změny — tam `description` prakticky vždy existuje.
