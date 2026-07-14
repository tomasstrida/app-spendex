# Příjmy bez tolerance — přesný rozdíl proti plánu

**Datum:** 2026-07-15
**Stav:** Design – schváleno uživatelem
**Zdroj:** Spendex backlog 13.7.2026: „Schůzka – Příjmy bez tolerance – ukazovat přesný rozdíl proti očekávání"

## Kontext

Sekce Příjmy na Schůzce (`ReportPage.jsx`) dnes hodnotí každý příjmový zdroj přes
`incomeStatus(expected, actual, txCount)` (`src/utils/recurring.js:27`) s **5%
tolerancí**: `ok` když `actual ≥ expected × 0,95`, jinak `mismatch`. Důsledek —
zdroj do 5 % pod plánem se zobrazí jako ✅ bez jakékoli informace o schodku.

Konkrétní podnět: Tom má plán 140 000, reálně přišlo 133 400 (−6 600, tj. −4,71 %).
Protože 133 400 ≥ 133 000 (práh), status je `ok` a schodek −6 600 se nikde
neukáže. Uživatel chce **vždy vidět přesný rozdíl proti plánu**, bez tolerance.

## Rozhodnutí z brainstormingu

1. **Sémantika statusu:** „Vždy přesný rozdíl, bez alarmu." Zdroj, který přišel,
   zůstává ✅; VŽDY se vedle ukáže přesný rozdíl proti plánu (`−6 600` schodek /
   `+5 000` přebytek). Žádný ⚠️ jen kvůli výši schodku — signál nese barva čísla,
   ne alarmová ikona. (Uživatel vědomě odmítl „jakýkoli schodek = mismatch" i
   „práh schodku".)
2. **Souhrn celkem:** řádek „Příjmy celkem" dostane vedle součtu skutečnosti i
   celkový rozdíl proti součtu plánů.

## Rozsah

### 1. Backend — zjednodušení `incomeStatus` (`src/utils/recurring.js`)

`incomeStatus(expected, actual, txCount)` ztrácí toleranci:

```js
function incomeStatus(expected, actual, txCount) {
  if (!(expected > 0)) return null;      // není plán → bez statusu
  if (!txCount || txCount === 0) return 'missing';
  return 'ok';                            // přišlo cokoli → ok (rozdíl řeší UI)
}
```

- Status `mismatch` pro příjmy **zaniká** (nikde jinde se pro příjmy nepoužívá).
- `actual` parametr zůstává v signatuře kvůli zpětné kompatibilitě volajících
  (`src/utils/income.js:134,152`), ale logika ho už nečte.
- **Konstanta `MATCH_TOLERANCE_PCT`** (`recurring.js:3`, export ř. 43) se stává
  nepoužitou (jediný konzument byl `incomeStatus`; fixní platby `paymentStatus`
  ji nečtou — ověřeno grepem). Odstranit: definici, export i test
  „MATCH_TOLERANCE_PCT je 5" (`recurring.test.js:45`). Před odstraněním ověřit
  grepem `MATCH_TOLERANCE_PCT` napříč `src/` i `client/`, že už ji nic nečte.
- Rozdíl (`actual − planned_amount`) se **nepočítá v backendu** — řádek zdroje už
  nese `planned_amount` i `actual`, rozdíl odvodí frontend.

### 2. Frontend — zobrazení rozdílu (`client/src/pages/ReportPage.jsx`)

**Řádek příjmového zdroje** (`aliasedSources.map`, ~ř. 391–427):

- Blok `row.status === 'mismatch'` (~ř. 407–412) se **odstraní** (mismatch už
  nevzniká).
- Pro zdroj se `status === 'ok'` a `planned_amount > 0` se **vždy** zobrazí
  rozdíl `diff = row.actual − row.planned_amount`:
  - `diff < 0` → červeně (třída `text-danger`) „−6 600 Kč"
  - `diff > 0` → zeleně (třída `text-success`) „+5 000 Kč"
  - `diff === 0` (po zaokrouhlení) → nic
  - formát: `(diff > 0 ? '+' : '−') + formatCurrency(Math.abs(diff))`
  - ⚠️ POZOR na barevnou konvenci: u PŘÍJMŮ je schodek (`diff < 0`) červený a
    přebytek (`diff > 0`) zelený. To je **opačně** než souhrn „rozdíl oproti
    plánu" u VÝDAJŮ (`ReportPage.jsx:642`, `diff > 0 ? 'text-danger' :
    'text-success'`), kde přečerpání = červená. Nekopírovat konvenci z ř. 642 —
    pro příjmy je invertovaná.
- Ikona řádku zůstává ✅ (`FIXED_STATUS['ok'].icon`) — beze změny; ⚠️ se
  nepřidává.
- `status === 'missing'` → „nepřišlo" zůstává beze změny.

**Souhrn statusů** (~ř. 430–439): řádek `⚠️ {c('mismatch')} nižší částka` se
odstraní (mismatch = 0 vždy). Zůstane `✅ X přišlo` a `❌ X nepřišlo`.

**Řádek „Příjmy celkem"** (~ř. 486–489): vedle součtu skutečnosti (`totalIncome`)
se zobrazí celkový rozdíl proti součtu plánů:

- `totalPlanned = Σ planned_amount` přes `aliasedSources` (jen zdroje s plánem
  se do rozdílu počítají; zdroj bez plánu do `totalPlanned` nepřispívá).
- `totalDiff = totalIncome − totalPlanned`.
- Zobrazení stejnou barevnou logikou jako řádky (červený schodek / zelený
  přebytek / nic při 0). Součet skutečnosti zůstává vidět vždy.

### 3. Testy

- **`recurring.test.js`:** přepsat tolerance testy podle nové sémantiky:
  - `incomeStatus(140000, 0, 0)` → `missing`
  - `incomeStatus(140000, 140000, 1)` → `ok`
  - `incomeStatus(140000, 190000, 1)` → `ok`
  - `incomeStatus(140000, 132999, 1)` → **`ok`** (dřív `mismatch`)
  - `incomeStatus(140000, 50000, 1)` → `ok`
  - `incomeStatus(0, 100, 1)` → `null`
  - odstranit test „MATCH_TOLERANCE_PCT je 5" a jeho import.
- **`income.test.js`:** pokud existuje test očekávající pro příjem status
  `mismatch`, přepsat na `ok` (aliasovaný zdroj pod plánem = `ok`).

## Non-goals

- Žádný práh ani alarm podle výše schodku (vědomě, dle volby „bez alarmu").
- Beze změny: auto-detekce příjmů, striktní whitelist aliasovaných zdrojů,
  fixní platby (`paymentStatus` má vlastní min/max logiku, nedotčena).
- Žádná změna výpočtu `totalIncome` (součet skutečnosti aliasovaných zdrojů).

## Nasazení

Commit + push do `staging`. Po vizuální kontrole na pokyn merge `staging` →
`main`. Hlásit verzi.
