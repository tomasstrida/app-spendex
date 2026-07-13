# Balíček A – Drobné UI opravy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tři nezávislé frontendové UI opravy Spendexu — měsíce jako čísla, prahové barvy přečerpání a součet Drahých věcí za období.

**Architecture:** Čistě frontendové změny bez zásahu do schématu DB nebo backendu. Dvě změny v čistých util funkcích (`i18n.formatPeriod`, `budgetColor.budgetFillColor`) kryté unit testy přes `node --test`, jedna vizuální agregace v `DashboardPage` s extrahovanou testovatelnou čistou funkcí.

**Tech Stack:** React + Vite (ESM, `client/` má `"type": "module"`), testy `node --test` bez frameworku (`node:test` + `node:assert/strict`).

## Global Constraints

- Jazyk UI: čeština (`i18n.js`). Žádný `any` v TS (zde JS, neaplikuje se).
- Testy se spouští přímo: `node --test <cesta k .test.js>`. Není npm test skript.
- Práh přečerpání: striktně `> 0.10` (přesně 10 % je ještě oranžové, nad 10 % červené).
- Commity + push do větve `staging` (ne `main`). Verzi bumpuje husky hook automaticky — needitovat `VERSION`/`package.json` ručně.
- Refund konvence projektu: utraceno = `SUM(-amount)` (kladné `amount` = příliv/refund se odečte).

---

### Task 1: A2 – Barvy přečerpání (kombinovaná logika)

**Files:**
- Modify: `client/src/utils/budgetColor.js` (celý soubor, 22 řádků)
- Test: `client/src/utils/budgetColor.test.js` (rozšířit stávajících 7 testů)

**Interfaces:**
- Consumes: nic (samostatná util).
- Produces: `budgetFillColor({ spent, amount, daysPassed, totalDays }) → BUDGET_GREEN | BUDGET_ORANGE | BUDGET_RED`. Signatura i exportované konstanty beze změny — mění se jen vnitřní prahová logika. Konzumenti `Thermometer` (DashboardPage) a `YearThermometer` se needitují.

- [ ] **Step 1: Přidat failing testy pro 10% práh**

Do `client/src/utils/budgetColor.test.js` přidej za stávající testy:

```js
test('přečerpáno přesně o 10 % → oranžová (hranice je > 0.10)', () => {
  assert.equal(budgetFillColor({ spent: 110, amount: 100, daysPassed: 30, totalDays: 30 }), BUDGET_ORANGE);
});

test('přečerpáno pod 10 % → oranžová', () => {
  assert.equal(budgetFillColor({ spent: 105, amount: 100, daysPassed: 30, totalDays: 30 }), BUDGET_ORANGE);
});

test('přečerpáno nad 10 % → červená', () => {
  assert.equal(budgetFillColor({ spent: 111, amount: 100, daysPassed: 30, totalDays: 30 }), BUDGET_RED);
});
```

- [ ] **Step 2: Spustit testy, ověřit selhání**

Run: `node --test client/src/utils/budgetColor.test.js`
Expected: FAIL — stávající logika vrací pro `spent: 110` i `spent: 105` červenou (`spent > amount → RED`), nové testy čekají oranžovou.

- [ ] **Step 3: Přepsat `budgetFillColor`**

V `client/src/utils/budgetColor.js` nahraď funkci (řádky 12–22) a aktualizuj doc-komentář nahoře (řádky 1–7):

```js
// Semafor pro rtuť teploměrů budgetů (Typ 1 měsíční i Typ 2 roční).
// Centralizovaná barevná logika — jediné místo, kde žijí prahy.
//
//   zelená   = v normě (v rámci budgetu i tempa)
//   oranžová = hrozí přečerpání (tempo utrácení přesáhne budget) NEBO
//              přečerpáno do 10 %
//   červená  = přečerpáno o víc než 10 %
export const BUDGET_GREEN = '#22c55e';  // --success
export const BUDGET_ORANGE = '#f97316';
export const BUDGET_RED = '#ef4444';    // --danger

export function budgetFillColor({ spent, amount, daysPassed, totalDays }) {
  // Bez rozpočtu nic nehrozí → neutrální zelená (a žádné dělení nulou).
  if (!(amount > 0)) return BUDGET_GREEN;
  // Přečerpáno: do 10 % oranžová, nad 10 % červená.
  if (spent > amount) {
    return (spent - amount) / amount > 0.10 ? BUDGET_RED : BUDGET_ORANGE;
  }
  const spentPct = (spent / amount) * 100;
  const dayPct = totalDays > 0 ? Math.min((daysPassed / totalDays) * 100, 100) : 0;
  // Utrácím rychleji, než plyne období → tempo přesáhne budget do konce.
  if (spentPct > dayPct) return BUDGET_ORANGE;
  return BUDGET_GREEN;
}
```

- [ ] **Step 4: Spustit testy, ověřit průchod**

Run: `node --test client/src/utils/budgetColor.test.js`
Expected: PASS — všech 10 testů (7 původních regresních + 3 nové).

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/budgetColor.js client/src/utils/budgetColor.test.js
git commit -m "feat(budget): barva přečerpání do 10 % oranžová, nad 10 % červená"
```

---

### Task 2: A1 – Měsíce jako čísla ve `formatPeriod`

**Files:**
- Modify: `client/src/i18n.js:105` (odstranit `monthsShort`), `:118-132` (`formatPeriod`)
- Test: `client/src/i18n.test.js` (nový soubor)

**Interfaces:**
- Consumes: nic.
- Produces: `formatPeriod(start, end) → string`. Stejná signatura, mění se jen výstupní formát ze zkratek na čísla. Volá se z 5 stránek (Dashboard, Settings, Report, Transactions, Budgets) — žádnou needitujeme, propíše se skrz.

- [ ] **Step 1: Napsat failing test**

Vytvoř `client/src/i18n.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPeriod } from './i18n.js';

test('období ve stejném roce → čísla měsíců, rok jednou', () => {
  assert.equal(formatPeriod('2026-04-19', '2026-05-18'), '19. 4. – 18. 5. 2026');
});

test('období přes přelom roku → rok u obou konců', () => {
  assert.equal(formatPeriod('2025-12-19', '2026-01-18'), '19. 12. 2025 – 18. 1. 2026');
});

test('prázdný vstup → prázdný řetězec', () => {
  assert.equal(formatPeriod('', '2026-05-18'), '');
  assert.equal(formatPeriod('2026-04-19', null), '');
});
```

- [ ] **Step 2: Spustit test, ověřit selhání**

Run: `node --test client/src/i18n.test.js`
Expected: FAIL — stávající `formatPeriod` vrací `"19. dub – 18. kvě 2026"`, test čeká `"19. 4. – 18. 5. 2026"`.

- [ ] **Step 3: Přepsat `formatPeriod` a odstranit `monthsShort`**

V `client/src/i18n.js` smaž řádek 105 (`monthsShort: [...]`) a nahraď `formatPeriod` (řádky 118–132):

```js
export function formatPeriod(start, end) {
  if (!start || !end) return '';
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const sDay = s.getDate();
  const eDay = e.getDate();
  const sMonth = s.getMonth() + 1;
  const eMonth = e.getMonth() + 1;
  const sYear = s.getFullYear();
  const eYear = e.getFullYear();
  if (sYear === eYear) {
    return `${sDay}. ${sMonth}. – ${eDay}. ${eMonth}. ${sYear}`;
  }
  return `${sDay}. ${sMonth}. ${sYear} – ${eDay}. ${eMonth}. ${eYear}`;
}
```

Pozn.: číslo měsíce dostává tečku (`4.`), aby formát seděl s dennodenní konvencí `den. měsíc.` (např. `19. 4.`).

- [ ] **Step 4: Spustit test, ověřit průchod**

Run: `node --test client/src/i18n.test.js`
Expected: PASS — 3 testy.

- [ ] **Step 5: Commit**

```bash
git add client/src/i18n.js client/src/i18n.test.js
git commit -m "feat(i18n): období zobrazuje měsíce čísly místo zkratek"
```

---

### Task 3: A3 – Součet Drahých věcí za období

**Files:**
- Create: `client/src/utils/expensiveTotal.js`
- Test: `client/src/utils/expensiveTotal.test.js`
- Modify: `client/src/pages/DashboardPage.jsx` (sekce Drahé věci, kolem řádků 234–276)

**Interfaces:**
- Consumes: `expensiveItems` — pole položek s číselným polem `amount` (výdaj je záporný, refund kladný; stejné jako `data.expensive_items` z `/api/stats/overview`).
- Produces: `sumExpensiveTotal(items) → number` — čistá utraceno hodnota `Σ(-amount)` (kladné číslo pro běžný výdaj). Použije se v `DashboardPage` jako `formatCurrency(sumExpensiveTotal(expensiveItems))`.

- [ ] **Step 1: Napsat failing test čisté funkce**

Vytvoř `client/src/utils/expensiveTotal.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumExpensiveTotal } from './expensiveTotal.js';

test('sečte výdaje jako kladné utraceno', () => {
  assert.equal(sumExpensiveTotal([{ amount: -1200 }, { amount: -800 }]), 2000);
});

test('refund (kladný amount) se odečte', () => {
  assert.equal(sumExpensiveTotal([{ amount: -1200 }, { amount: 500 }]), 700);
});

test('prázdné pole → 0', () => {
  assert.equal(sumExpensiveTotal([]), 0);
});
```

- [ ] **Step 2: Spustit test, ověřit selhání**

Run: `node --test client/src/utils/expensiveTotal.test.js`
Expected: FAIL — `Cannot find module './expensiveTotal.js'`.

- [ ] **Step 3: Vytvořit čistou funkci**

Vytvoř `client/src/utils/expensiveTotal.js`:

```js
// Čisté utraceno za Drahé věci v období: Σ(-amount).
// Výdaj má záporný amount → přičte se kladně; refund (kladný) se odečte.
export function sumExpensiveTotal(items) {
  return (items || []).reduce((sum, it) => sum - it.amount, 0);
}
```

- [ ] **Step 4: Spustit test, ověřit průchod**

Run: `node --test client/src/utils/expensiveTotal.test.js`
Expected: PASS — 3 testy.

- [ ] **Step 5: Zobrazit součet v DashboardPage**

V `client/src/pages/DashboardPage.jsx`:

1. Přidej import k ostatním utilům nahoře souboru:

```js
import { sumExpensiveTotal } from '../utils/expensiveTotal.js';
```

2. Uvnitř `.report-budget-list` divu, hned za `{expensiveItems.map(...)}` (po řádku 274, před uzavřením `</div>` na řádku 275) přidej řádek se součtem:

```jsx
                  <div className="report-budget-row" style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6, fontWeight: 600 }}>
                    <span className="report-budget-name">Celkem za období</span>
                    <span className="report-budget-spent">{formatCurrency(sumExpensiveTotal(expensiveItems))}</span>
                  </div>
```

Pozn.: `formatCurrency` už je v souboru importovaný (používá se na řádku 248). Řádek se zobrazí jen ve větvi, kde `expensiveItems.length > 0` (uvnitř existujícího `else`), takže prázdný stav zůstane beze součtu.

- [ ] **Step 6: Ověřit build a vizuálně**

Run: `cd client && npm run build`
Expected: build projde bez chyb.

Pak spustit appku a zkontrolovat sekci Drahé věci v Měsíčních rozpočtech — pod seznamem je řádek „Celkem za období" s korektním součtem. Ověř přes `/verify` (drive Měsíční rozpočty na období s drahými věcmi).

- [ ] **Step 7: Commit**

```bash
git add client/src/utils/expensiveTotal.js client/src/utils/expensiveTotal.test.js client/src/pages/DashboardPage.jsx
git commit -m "feat(dashboard): součet Drahých věcí za období v Měsíčních rozpočtech"
```

---

## Závěrečné kroky

- [ ] **Spustit celou client util test sadu**

Run: `node --test client/src/utils/*.test.js client/src/i18n.test.js`
Expected: všechny testy PASS (budgetColor 10, expensiveTotal 3, i18n 3, + stávající accountName/celebrate/stepPeriod).

- [ ] **Push do staging**

```bash
git push origin staging
```

Railway nasadí staging. Nahlásit uživateli číslo verze (husky bumpne automaticky).

## Self-Review

**Spec coverage:**
- A1 (měsíce čísly) → Task 2 ✓
- A2 (barvy do/nad 10 %, zachovat projekční oranžovou) → Task 1 ✓
- A3 (součet Drahých věcí za období) → Task 3 ✓
- Testy budgetColor hranice + formatPeriod → Task 1 Step 1, Task 2 Step 1 ✓
- Non-goals (žádná změna schématu, žádný přesun Drahých věcí) → dodrženo, Task 3 mění jen zobrazení ✓

**Placeholder scan:** žádné TBD/TODO; každý krok má konkrétní kód a příkaz s očekávaným výstupem.

**Type consistency:** `budgetFillColor` signatura beze změny; `formatPeriod` signatura beze změny; `sumExpensiveTotal(items)` definován v Task 3 Step 3 a použit v Step 5 se shodným názvem.
