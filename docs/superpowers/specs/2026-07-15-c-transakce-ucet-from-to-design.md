# C – Transakce: sloupec „Účet (z → do)" — design

**Datum:** 2026-07-15
**Balíček:** C (zbytek — Příjmy bez tolerance už hotové)

## Cíl

Přidat do seznamu Transakcí volitelný sloupec, který u každé platby ukáže tok
peněz `zdroj → cíl` (ze kterého účtu na který), s lidskými názvy interních účtů
domácnosti a názvem obchodníka u karetních plateb.

## Motivace

Dnešní sloupec „Číslo účtu" ukazuje jen holé číslo protistrany (+ název, když je
to interní účet). Nedává orientaci směru toku ani vlastní účet transakce.
U karetních plateb (bez čísla protistrany) je prázdný.

## Rozsah

**Čistě frontend.** Transakce už nese `account_id` (náš účet) i
`counterparty_account` (protistrana); směr plyne ze znaménka `amount`.
`/api/accounts` dává id→název i number→název. Backend beze změny.

## Chování

Nový sloupec, klíč `account_flow`, label **„Účet (z → do)"**, **default skrytý**
(zapíná se v nastavení sloupců, stejně jako „Číslo účtu"). Stávající sloupec
„Číslo účtu" zůstává beze změny.

Orientace podle toku peněz:
- **Odchozí** (`amount < 0`): `náš účet → protistrana`
- **Příchozí** (`amount >= 0`): `protistrana → náš účet`

Určení stran:
- **Náš účet** = z `account_id` přes mapu id→název (`/api/accounts`). Když
  `account_id` chybí (nespárováno) → `—`.
- **Protistrana** (v tomto pořadí):
  1. interní účet domácnosti (`counterparty_account` normalizovaný sedí na
     některý náš účet) → **název** účtu,
  2. jinak neprázdné `counterparty_account` → **číslo** (raw),
  3. jinak neprázdné `place` (karetní platba) → **název obchodníka**,
  4. jinak → `—`.

## Architektura

Pure util `client/src/utils/accountFlow.js`:

```
accountFlow(tx, { accountById, accountNameMap }) → { from, to }
```

- `accountById`: `Map<number, string>` (account_id → název), postavená v
  TransactionsPage z `accounts` state.
- `accountNameMap`: existující `Map<normČíslo, název>` z `buildAccountNameMap`
  (na rozpoznání interní protistrany přes `accountNameFor`).
- Vrací `{ from, to }` — dva stringy (názvy / čísla / obchodník / `—`),
  už ve správném pořadí podle směru.

`TransactionsPage.jsx`:
- `ALL_COLS`: nová položka `{ key: 'account_flow', label: 'Účet (z → do)', default: false }`.
- `accountById` = `useMemo` z `accounts` (id→name).
- `renderCell` case `account_flow`: `from` <span> · šipka `→` (muted) · `to` <span>.
- `colsToGrid`: šířka `account_flow` ~ `200px`.

## Testy

`client/src/utils/accountFlow.test.js` (`node --test`, jako ostatní utils):
- odchozí na interní účet → `{from: náš, to: název interního}`
- příchozí z externího čísla → `{from: číslo, to: náš}`
- karetní platba (bez counterparty, s place) → `{from: náš, to: obchodník}`
- `account_id` null → `from`/`to` obsahuje `—` na naší straně
- žádná data protistrany ani place → `—`

## Non-goals

- Žádná změna backendu ani schématu.
- Neměnit stávající sloupec „Číslo účtu".
- Neřešit filtr podle from/to účtu (jen zobrazení).
