# Design: Opravdový měsíční součet na Schůzce + skutečné fixní platby

**Datum:** 2026-07-16
**Stav:** schváleno uživatelem (brainstorming), čeká na plán
**Kontext:** Sekce „Měsíční schůzka" (`client/src/pages/ReportPage.jsx`), fixní platby (`src/utils/fixed-expenses.js`, `src/routes/fixed-expenses.js`, `client/src/pages/FixedExpensesPage.jsx`).

## Problém

Tři provázané nedostatky na Schůzce:

1. **Fixní platby se sčítají z plánu, ne ze skutečnosti.** `ReportPage.jsx` počítá `totalFixed` jako součet *plánovaných* částek (`f.amount`). Platba, která ještě nepřišla (status ❌), se do součtu započítá plnou plánovanou částkou; platba proběhlá v jiné výši se počítá plánem, ne realitou. Součet tak neodpovídá tomu, co reálně odteklo.

2. **Fixní platbu lze párovat jen přes text v popisu** (`match_pattern`, `description LIKE`). Popis banka může měnit; spolehlivější je párovat přes číslo účtu příjemce — u příjmů (`income_sources.match_counterparty_account`) to už funguje s prioritou nad textem.

3. **Bilance na Schůzce nesedí aritmeticky.** Sekce končí řádkem „Skutečně naspořeno" = *měřené netto* převodů na spořicí, s disclaimerem „Výsledek je měřené netto převodů, ne aritmetický rozdíl rozpadu výše". Rozpad příjmů/výdajů tedy vědomě neuzavírá do součtu.

## Cíl

Schůzka ukáže **opravdový měsíční součet, který aritmeticky sedí**: příjmy minus všechny odtoky (včetně přesunů do jiných kapes) = zůstatek, přičemž **všechny řádky jsou skutečné** (měřené z transakcí), ne plánované.

## Rozhodnutí z brainstormingu

- **Cíl bilance:** aritmetická bilance — rozpad musí sedět, součet řádků = výsledek (nahrazuje „měřené netto naspořeno").
- **Interní převody** (dotace Hlavní→Nepravidelné, převody na spořicí) **zůstanou jako mínus řádky**; výsledek = „kolik zbylo na běžném po všech pohybech", ne čistý příjem−výdaj.
- **Fixní bez matcheru:** nepovolit. Každá fixní platba musí mít text-pattern **nebo** číslo účtu příjemce, jinak ji nelze změřit.

## Řešení

Přístup: **rozšířit stávající „income-style" matcher model i na fixní platby** — zkopírovat vzor `match_counterparty_account` s prioritou nad textem.

### A. Matcher fixní platby přes číslo účtu příjemce

**Data:** nový sloupec `fixed_expenses.match_counterparty_account TEXT` (migrace `ALTER TABLE` na konci `initSchema()`, jako u ostatních).

**Párování** (`src/utils/fixed-expenses.js`, `fixedExpensesForPeriod`): pro každou manuální platbu se najdou odchozí transakce (`amount < 0`) v okně období (rolling `frequency_months`) primárně přes **číslo účtu příjemce** (`counterparty_account LIKE ? || '%'`), a když číslo účtu není zadané, přes **text v popisu** (`description LIKE '%' || ? || '%'`) jako dnes. Číslo účtu má přednost.

**Formulář** (`FixedExpensesPage`): přidat pole „Číslo účtu příjemce" vedle „Pattern v popisu". Hint ve stylu příjmů (spolehlivější než popis, má přednost).

**Validace** (`src/routes/fixed-expenses.js`, POST i PATCH): aspoň jeden z `match_pattern` / `match_counterparty_account` musí být zadán, jinak `400 { error: 'Zadej text v popisu nebo číslo účtu příjemce.' }`. Platí i pro PATCH (nelze uložit záznam do stavu bez matcheru).

**Exclude-list pro account-řádky** (`excludeSql` v `fixedExpensesForPeriod`) dnes vynechává account transakce matchující ruční `match_pattern`, aby se nepočítaly dvakrát. Rozšířit i o `match_counterparty_account` (vynechat account tx, jejichž `counterparty_account` odpovídá ručnímu číslu účtu).

### B. Fixní platby — jen proběhlé, ve skutečné částce

**Backend:** `fixedExpensesForPeriod` vrátí u každé manuální platby `actual` (suma napárovaných tx), `tx_count`, `status`. Dnes to dostávají jen platby s `match_pattern`; nově všechny (každá má matcher). `status` z `paymentStatus(amount_min, amount_max, actual, tx_count)` beze změny.

**Součet** (`ReportPage.jsx`): `totalFixed` se změní z plánu na skutečnost jen proběhlých:

```js
// dnes: const totalFixed = fixedExpenses.reduce((s, f) => s + f.amount, 0);   // plán
const totalFixed = fixedExpenses.reduce((s, f) => {
  if (f.source === 'account') return s + f.amount;      // account-řádek už nese skutečnost
  return s + (f.tx_count > 0 ? f.actual : 0);           // manuální: jen proběhlé, skutečná částka
}, 0);
```

- Platba se stavem ❌ (nepřišla, `tx_count === 0`) → řádek se zobrazí, do součtu nevstoupí.
- Platba proběhlá v jiné výši (⚠️ mismatch) → do součtu **skutečnou** částkou.
- Řádek platby zobrazí skutečnou částku (u proběhlých); plánované rozmezí zůstává v textu stavu (⚠️ „… čekáno min–max").

Změna se projeví na obou místech, kde `totalFixed` vstupuje: řádek „Fixní platby" v bilanci i podřádek „Fixní platby celkem".

### C. Aritmetická bilance

Bilance sekce (`ReportPage.jsx`, `report-section--bilance`) se překlopí na uzavřený součet. Pořadí řádků (všechny skutečné):

```
Příjmy celkem              + totalIncome
− Fixní platby             (totalFixed ze sekce B)
− Dotace na nepravidelné   (variable_pool_funded)
− Měsíční výdaje           (totalType1)
− Drahé věci               (totalType3)
− Na spořicí               (savings.net)
─────────────────────────
= Zbylo na běžném          (aritmetický součet)
```

Změny oproti dnešku:
- Dnešní výsledný řádek „**Skutečně naspořeno**" (`savings.net`) se překlopí na **mínus řádek „Na spořicí"** (kladné net = peníze odešly na spořicí = mínus z běžného; záporné net = návrat ze spořicího = plus).
- Přidá se nový výsledný řádek „**Zbylo na běžném**" = `totalIncome − totalFixed − variablePoolFunded − totalType1 − totalType3 − savings.net`. Záporný → červeně (`text-danger`), kladný → beze změny/plus.
- **Nahradí se disclaimer:** dnešní text „Výsledek je měřené netto převodů, ne aritmetický rozdíl rozpadu výše" se odstraní a nahradí novým drobným textem (viz Známé omezení níže) — nově rozpad aritmetický rozdíl **je**, ale výsledek je cash-flow za období, ne bankovní zůstatek.
- Detailní rozpad převodů na spořicí (`savings.transfers`) zůstává, přesune se pod řádek „Na spořicí".
- Řádky „Dotace na nepravidelné", „Měsíční výdaje", „Drahé věci" se zobrazují za stejných podmínek jako dnes (guard na >0), jen v novém pořadí. Klik-through odkazy na Transakce zůstávají.

**Známé omezení (nový drobný disclaimer pod bilancí):** „Zbylo na běžném" je aproximace cash-flow za období, ne přesný zůstatek jednoho bankovního účtu — mixuje toky napříč účty (příjmy na Hlavní, měsíční výdaje i z účtu Nepravidelné, který zároveň dostává „dotaci"). U reálného nastavení je překryv malý (z Nepravidelné jdou hlavně roční výdaje Typ 2, mimo měsíční bilanci), ale číslo je „přebytek/schodek toku za období", ne bankovní zůstatek na haléř. Tento text nahradí dnešní disclaimer.

## Dotčené soubory

- `src/db/schema.js` — migrace `ALTER TABLE fixed_expenses ADD COLUMN match_counterparty_account TEXT`.
- `src/utils/fixed-expenses.js` — párování přes counterparty_account (priorita) + text fallback; `actual`/`tx_count`/`status` pro všechny; rozšíření `excludeSql`.
- `src/routes/fixed-expenses.js` — příjem/uložení `match_counterparty_account`; validace „aspoň jeden matcher" v POST i PATCH.
- `client/src/pages/FixedExpensesPage.jsx` — pole „Číslo účtu příjemce" + klientská validace.
- `client/src/pages/ReportPage.jsx` — `totalFixed` na skutečnost; přeskládání a uzavření bilance; nový řádek „Zbylo na běžném"; přesun spoření na mínus řádek; nový disclaimer.
- i18n texty dle potřeby (`report_*` / labely bilance).

## Testy

- **`src/utils/fixed-expenses.test.js`** (nový nebo rozšíření): párování přes counterparty_account má přednost před patternem; platba bez tx → `tx_count 0`, `status 'missing'`; mismatch částka → skutečný `actual`; account-řádek se nezdvojí s ruční platbou přes číslo účtu (exclude).
- **`src/routes/fixed-expenses.test.js`**: POST/PATCH bez obou matcherů → 400; s counterparty → uloží; priorita.
- **Client util** (pokud výpočet `totalFixed` / „zbylo na běžném" vytáhnu do čisté funkce, např. `client/src/utils/meetingBalance.js`): jen proběhlé se skutečnou částkou; aritmetický součet bilance. Preferovat vytažení do testovatelné pure funkce před inline redukcí v JSX.

## Mimo scope

- Alerty typu „fixní platba nepřišla" (push) — jen vizuální status na Schůzce.
- Přepočet historických období / migrace dat (jen nový výpočet, data se nemění).
- Přesné účetní saldo per bankovní účet (uživatel vědomě zvolil aproximaci „zbylo na běžném").
