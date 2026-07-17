# Spořicí účet — stránka skutečných převodů za období

**Datum:** 2026-07-17
**Stav:** schváleno, k implementaci

## Cíl

Nová stránka „Spořicí účet" (`/savings`) zobrazí, kolik jsme za zvolené období
**skutečně** převedli na spořicí účet, a vedle toho **plánovaný přebytek** ze
Schůzky pro rychlé porovnání. Skutečné číslo by mělo poměrně přesně odpovídat
plánu — stránka to porovnání dělá explicitně.

## Rozhodnutí (z brainstormingu)

1. **Jádro** = skutečné převody za období (net = vklady − výběry).
2. **Metrika** hlavního čísla = **net**; pod ním malým písmem vklady a výběry zvlášť.
3. **Porovnání** — malý řádek plán (Schůzka) vs. skutečnost + rozdíl.
4. **Umístění** — položka „Spořicí účet" v hlavním menu (sekce Přehledy), za Schůzkou.

## Datové zdroje (beze změny backendu)

Backend `GET /api/stats/overview?period=YYYY-MM` už vrací:

```
savings: { deposits, withdrawals, net, transfers[] }
```

- `net` = hlavní číslo („převedeno na spořicí").
- `transfers[]` = seznam pohybů (id, date, description, amount, counterparty_account, note, is_regular).
- Identifikace spořicího účtu: `counterparty_account LIKE '1679014082/3030'` (`recurring.savingsAccount`).

Plánovaný přebytek se skládá stejně jako na Schůzce z: `income`, `fixed-expenses`,
`budgets` (typ 1), `stats/overview.by_category` (typ 3) a `stats/overview.variable_pool_funded`.
**Fund-status (typ 3 měsíční příspěvek) není potřeba** — surplus pracuje se
skutečně utracenými drahými věcmi, ne s plánovaným příspěvkem.

## Přístup A — sdílený helper (zvolený)

Výpočet přebytku dnes žije inline v `ReportPage.jsx`. Vytáhnu ho do
`client/src/utils/meetingBalance.js` jako čistou funkci:

```js
computeMeetingSurplus({ incomeSources, fixedExpenses, budgetsType1, byCategory, variablePoolFunded })
  → { totalIncome, totalFixed, totalType1, totalType3, variablePoolFunded, surplus }
```

- `surplus` počítá přes stávající `surplusToSavings(...)` — beze změny vzorce.
- `ReportPage` se refaktoruje, aby `surplus` bral z helperu (jediná pravda).
- `SavingsPage` volá tentýž helper → plán vždy sedí na Schůzku.
- Pokryto unit testem v `meetingBalance.test.js`.

Zamítnuté alternativy: nový backend endpoint (duplikace surplus logiky na backend =
dvě pravdy), dopočet do `stats/overview` (velký cross-route refaktor).

## Layout stránky

Přepínač období nahoře (stejný vzor jako Schůzka: `usePeriod` + `addPeriods` + ◀ ▶).

- **Horní karta „Převedeno na spořicí"**
  - velké číslo = `net`, obarvené: net ≥ 0 zelená, net < 0 červená (nedávalo se);
  - malým písmem `vklady {deposits} · výběry {withdrawals}`;
  - oddělovač;
  - řádek `Plán (Schůzka): {surplus}` a `Rozdíl: {net − surplus}` (rozdíl obarven neutrálně/červeně dle znaménka).
- **Seznam „Převody v období"** = `savings.transfers`, každý řádek proklikatelný
  do `/transactions?period=…`, značka „pravidelný" u `is_regular`.
- **Prázdný stav** — „V tomto období žádné převody na spořicí účet."

Znovupoužití existujících tříd (`card`, `report-bilance-row`, `report-subtotal`) +
minimální inline styly. Žádné nové CSS soubory.

## Mimo rozsah (YAGNI)

- Žádný kumulativní zůstatek spořicího účtu.
- Žádný trend přes období.
- Žádná editace — jen čtení za zvolené období.

## Verze

Nová featura → minor bump `package.json` na `3.1.0`.

## Testy

- `meetingBalance.test.js`: `computeMeetingSurplus` — přebytek z realistických vstupů,
  filtr aliasovaných příjmů (`id != null`), typ 3 jen `spent > 0`.
- Ověření, že refaktor `ReportPage` nezměnil zobrazený „Na spořicí" (vizuální kontrola + existující testy zelené).
