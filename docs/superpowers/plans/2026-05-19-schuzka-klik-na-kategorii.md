# Schůzka: klik na kategorii → filtr transakcí — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Řádky kategorie v sekci „Měsíční výdaje" na Schůzce udělat klikatelné — proklik na `/transactions` předfiltrovaný na danou kategorii a aktuálně zobrazené období.

**Architecture:** Frontend-only. `TransactionsPage` už čte `?category_id=&period=` z URL. Stačí v `ReportPage.jsx` obalit řádek `report-budget-row` v sekci „Měsíční výdaje" `Link`em.

**Tech Stack:** React + Vite + react-router-dom. Žádné automatické FE testy → ověření `npm run build` + grep.

**Spec:** `docs/superpowers/specs/2026-05-19-schuzka-klik-na-kategorii-design.md`

**Konvence:** po tasku commit + push do `staging`; Husky auto-bump VERSION/package.json očekávaný.

---

### Task 1: Klikatelné řádky „Měsíční výdaje" v ReportPage

**Files:**
- Modify: `client/src/pages/ReportPage.jsx`

- [ ] **Step 1: Přidat import `Link`**

V `client/src/pages/ReportPage.jsx` je první řádek:
```js
import { useState, useEffect } from 'react';
```
Přidej hned pod něj (nebo k ostatním importům nahoře) NOVÝ řádek:
```js
import { Link } from 'react-router-dom';
```
(Ověř, že `react-router-dom` je v projektu používán — je: `client/src/App.jsx`, `Sidebar.jsx`, `TransactionsPage.jsx` ho importují.)

- [ ] **Step 2: Obalit řádek Měsíční výdaje `Link`em**

Najdi v sekci `{/* ── MĚSÍČNÍ VÝDAJE (Typ 1) ── */}` blok mapování `budgets.map(b => { ... })`. Aktuálně vypadá takto:

```jsx
              <div className="report-budget-list">
                {budgets.map(b => {
                  const st = budgetStatus(b.spent, b.amount);
                  return (
                    <div key={b.category_id} className="report-budget-row">
                      <span className="report-budget-dot" style={{ background: b.category_color || '#6366f1' }} />
                      <span className="report-budget-name">{b.category_name}</span>
                      <span className={`report-budget-spent ${STATUS[st].cls}`}>{formatCurrency(b.spent)}</span>
                      <span className="text-muted report-budget-limit">/ {formatCurrency(b.amount)}</span>
                      <span className="report-budget-status">{STATUS[st].icon}</span>
                    </div>
                  );
                })}
              </div>
```

Nahraď CELÝ tento blok (od `<div className="report-budget-list">` po jeho odpovídající `</div>`) tímto:

```jsx
              <div className="report-budget-list">
                {budgets.map(b => {
                  const st = budgetStatus(b.spent, b.amount);
                  const inner = (
                    <>
                      <span className="report-budget-dot" style={{ background: b.category_color || '#6366f1' }} />
                      <span className="report-budget-name">{b.category_name}</span>
                      <span className={`report-budget-spent ${STATUS[st].cls}`}>{formatCurrency(b.spent)}</span>
                      <span className="text-muted report-budget-limit">/ {formatCurrency(b.amount)}</span>
                      <span className="report-budget-status">{STATUS[st].icon}</span>
                    </>
                  );
                  if (b.category_id == null) {
                    return (
                      <div key={b.category_id} className="report-budget-row">{inner}</div>
                    );
                  }
                  const to = `/transactions?category_id=${b.category_id}` + (period ? `&period=${period}` : '');
                  return (
                    <Link
                      key={b.category_id}
                      to={to}
                      className="report-budget-row"
                      style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                    >
                      {inner}
                    </Link>
                  );
                })}
              </div>
```

Pozn.: `period` je stávající stav komponenty `ReportPage` (právě zobrazené období Schůzky, formát `YYYY-MM`), používaný jinde v komponentě (např. navigace měsíců). Žádná jiná sekce („Roční/sezónní", „Drahé věci", „Příjmy", „Fixní platby", graf, spoření, bilance) se NEMĚNÍ.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Vite build úspěšný, 0 chyb. Žádná nevyřešená reference `Link`.

- [ ] **Step 4: Grep sanity**

Run: `grep -n "from 'react-router-dom'\|/transactions?category_id=\|report-budget-row" client/src/pages/ReportPage.jsx`
Expected: import `Link` z `react-router-dom` přítomen; `to` URL `/transactions?category_id=` v sekci Měsíční výdaje; `report-budget-row` se používá v `Link` i ve fallback `div`. Ostatní sekce s `report-budget-row` (Roční/sezónní, Drahé věci, Spoření) zůstávají jako `<div>` — ověř, že jiné výskyty `report-budget-row` nebyly obaleny `Link`em (jen blok Měsíční výdaje).

- [ ] **Step 5: Commit + push**

```bash
git add client/src/pages/ReportPage.jsx
git commit -m "feat: Schůzka – klik na kategorii v Měsíční výdaje → filtr transakcí"
git push origin staging
```
Husky auto-bumps VERSION/package.json — expected.

---

### Task 2: Integrační ověření

**Files:** žádné.

- [ ] **Step 1: Build + testy + smoke**

Run:
```bash
npm run build && node --test src/utils/duplicates.test.js src/utils/income.test.js src/utils/fixed-expenses.test.js src/utils/externalId.test.js src/utils/recurring.test.js src/db/schema.test.js scripts/seed/seed.test.js
```
Expected: úspěšný Vite build + všechny testy PASS, 0 fail (žádný backend dotčen → regrese musí být zelená beze změny).

- [ ] **Step 2: Shrnout uživateli (kontrolní seznam pro staging)**

1. Schůzka → sekce „Měsíční výdaje" → kurzor je „pointer", klik na řádek kategorie přejde na stránku Transakce.
2. Transakce jsou předfiltrované na tu kategorii a na **stejné období**, jaké bylo zobrazené na Schůzce (přepni měsíc na Schůzce a ověř, že proklik nese to období).
3. Sekce „Roční/sezónní", „Drahé věci", „Příjmy", „Fixní platby", graf, „Spoření", „Bilance" — beze změny (neklikatelné).

> Prod merge až na explicitní pokyn (projektový deploy-flow).

---

## Self-review

- **Spec coverage:** klikatelné jen „Měsíční výdaje" → Task 1 Step 2 (jen blok `budgets.map`, ostatní sekce nedotčeny). Cíl URL `/transactions?category_id=<id>&period=<period>` → Step 2 (`to` string, period podmíněně). Fallback při chybějícím `category_id` → Step 2 (`if (b.category_id == null) → <div>`). Vizuál/affordance → Step 2 (`className="report-budget-row"` + `cursor:pointer`, color inherit). Žádná změna TransactionsPage/backendu (YAGNI) → dodrženo. Vše pokryto.
- **Placeholder scan:** žádné TBD; kompletní kód v jediném kroku; ověřovací příkazy konkrétní.
- **Type/název konzistence:** `Link` z `react-router-dom`; `to` cesta odpovídá tomu, co `TransactionsPage` čte (`useSearchParams().get('category_id')` → `filterCats` Set; `get('period')` → stav `period`). `b.category_id`/`b.category_color`/`b.category_name`/`b.spent`/`b.amount` jsou stejné property jako v původním (nezměněném) řádku. `period` je existující stav `ReportPage`.
