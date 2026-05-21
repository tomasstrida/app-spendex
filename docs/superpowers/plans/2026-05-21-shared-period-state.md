# Sdílený period state napříč stránkami – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vybraný měsíc přežívá přepínání mezi stránkami; vedle period switcheru přibude tlačítko „Aktuální měsíc" pro rychlý reset.

**Architecture:** Nový React Context `PeriodContext` mountovaný uvnitř `BrowserRouter` nad `<Routes>` v `App.jsx`. Provider si jednou natáhne `/api/settings`, inicializuje `period = currentPeriod` a drží to v paměti po dobu sessionu. Čtyři dotčené stránky (Dashboard, Schůzka, Měsíční výdaje, Transakce) vymění svůj lokální `useState` pro `period`/`currentPeriod` za context.

**Tech Stack:** React (Vite), React Router, `useContext`. Žádné nové dependence. Žádné FE testy (projekt nemá FE test framework — backend testy v `src/utils/*.test.js` se touto změnou netýkají).

**Spec:** `docs/superpowers/specs/2026-05-21-shared-period-state-design.md`

---

## File structure

**Vytvořit:**
- `client/src/contexts/PeriodContext.jsx` — provider + hook

**Upravit:**
- `client/src/App.jsx` — import a mount provideru
- `client/src/i18n.js` — přidat klíč `period.resetToCurrent`
- `client/src/pages/DashboardPage.jsx`
- `client/src/pages/ReportPage.jsx`
- `client/src/pages/BudgetsPage.jsx`
- `client/src/pages/TransactionsPage.jsx`

---

## Task 1: Vytvořit PeriodContext

**Files:**
- Create: `client/src/contexts/PeriodContext.jsx`

- [ ] **Step 1: Ověř, že adresář `client/src/contexts/` neexistuje a vytvoř ho**

```bash
ls client/src/contexts 2>/dev/null || mkdir client/src/contexts
```

- [ ] **Step 2: Vytvoř `PeriodContext.jsx`**

```jsx
import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const PeriodContext = createContext(null);

export function PeriodProvider({ children }) {
  const [period, setPeriod] = useState(null);
  const [currentPeriod, setCurrentPeriod] = useState(null);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        if (!s) return;
        setCurrentPeriod(s.current_period);
        // Inicializuj jen pokud ještě nebylo nastaveno (deep link na TransactionsPage
        // mohl už setPeriod zavolat dřív)
        setPeriod(p => p ?? s.current_period);
      })
      .catch(() => { /* nepřihlášený uživatel – ignoruj */ });
  }, []);

  const resetToCurrent = useCallback(() => {
    if (currentPeriod) setPeriod(currentPeriod);
  }, [currentPeriod]);

  return (
    <PeriodContext.Provider value={{ period, setPeriod, currentPeriod, resetToCurrent }}>
      {children}
    </PeriodContext.Provider>
  );
}

export function usePeriod() {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error('usePeriod must be inside PeriodProvider');
  return ctx;
}
```

- [ ] **Step 3: Spusť build pro kontrolu syntaxe**

Run: `cd client && npm run build`
Expected: build projde bez chyb (`vite build` skončí success).

- [ ] **Step 4: Commit**

```bash
git add client/src/contexts/PeriodContext.jsx
git commit -m "feat: PeriodContext – sdílený period state napříč stránkami"
```

---

## Task 2: Mount PeriodProvider v App.jsx

**Files:**
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Přidej import**

V `client/src/App.jsx` přidej za stávající importy (např. po řádku 14):

```jsx
import { PeriodProvider } from './contexts/PeriodContext';
```

- [ ] **Step 2: Obal `<Routes>` providerem**

V `client/src/App.jsx` v `export default function App()` (řádky ~52-73) změň návratový JSX z:

```jsx
<AuthProvider>
  <BrowserRouter>
    <Routes>
      ...
    </Routes>
  </BrowserRouter>
</AuthProvider>
```

na:

```jsx
<AuthProvider>
  <BrowserRouter>
    <PeriodProvider>
      <Routes>
        ...
      </Routes>
    </PeriodProvider>
  </BrowserRouter>
</AuthProvider>
```

(Obsah `<Routes>` se nemění — všechny existující `<Route>` zůstávají.)

- [ ] **Step 3: Spusť build**

Run: `cd client && npm run build`
Expected: build projde.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat: mount PeriodProvider v App.jsx"
```

---

## Task 3: Přidat i18n klíč

**Files:**
- Modify: `client/src/i18n.js`

- [ ] **Step 1: Přidej sekci `period` do `cs` objektu**

V `client/src/i18n.js` najdi blok končící (řádek ~48):

```js
  common: {
    logout: 'Odhlásit se',
    loading: 'Načítání…',
    error: 'Chyba načítání.',
    currency: 'Kč',
  },
```

Hned za uzavírací `},` `common` bloku (před `months: [...]`) přidej:

```js
  period: {
    resetToCurrent: 'Aktuální měsíc',
  },
```

- [ ] **Step 2: Build**

Run: `cd client && npm run build`
Expected: build projde.

- [ ] **Step 3: Commit**

```bash
git add client/src/i18n.js
git commit -m "feat: i18n – klíč period.resetToCurrent"
```

---

## Task 4: Refactor DashboardPage – context + tlačítko

**Files:**
- Modify: `client/src/pages/DashboardPage.jsx`

- [ ] **Step 1: Přidej import `usePeriod`**

V `client/src/pages/DashboardPage.jsx` na řádek 1 přidej import `usePeriod`. Pokud řádek 1 zní:

```jsx
import { useState, useEffect } from 'react';
```

nech ho jak je a pod něj přidej:

```jsx
import { usePeriod } from '../contexts/PeriodContext';
```

- [ ] **Step 2: Vyhoď lokální period state a fetch /api/settings**

V `client/src/pages/DashboardPage.jsx`, v `export default function DashboardPage()`, najdi řádky 180-196:

```jsx
  const [period, setPeriod] = useState(null);
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [currentPeriod, setCurrentPeriod] = useState(null);
  const [data, setData] = useState(null);
  const [budgets, setBudgets] = useState(null);
  const [categories, setCategories] = useState([]);
  const [budgetItems, setBudgetItems] = useState([]);
  const [funds, setFunds] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(s => {
      setPeriod(s.current_period);
      setCurrentPeriod(s.current_period);
    });
  }, []);
```

a nahraď je:

```jsx
  const { period, setPeriod, currentPeriod, resetToCurrent } = usePeriod();
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [data, setData] = useState(null);
  const [budgets, setBudgets] = useState(null);
  const [categories, setCategories] = useState([]);
  const [budgetItems, setBudgetItems] = useState([]);
  const [funds, setFunds] = useState([]);
  const [loading, setLoading] = useState(true);
```

(Tedy: pryč jsou `useState` pro `period` a `currentPeriod`, pryč je `useEffect` na fetch `/api/settings`. Zbytek useEffectu pro period změnu zůstává.)

- [ ] **Step 3: Přidej tlačítko „Aktuální měsíc" do period switcheru**

V `client/src/pages/DashboardPage.jsx` najdi blok (řádky 228-240):

```jsx
        {period && (
          <div className="month-nav">
            <button className="btn btn-ghost btn-icon" onClick={() => setPeriod(p => addPeriods(p, -1))}>
              <ChevronLeft size={18} />
            </button>
            <span className="month-label">{formatPeriod(periodStart, periodEnd)}</span>
            <button className="btn btn-ghost btn-icon"
              onClick={() => setPeriod(p => addPeriods(p, 1))}
              disabled={period >= currentPeriod}>
              <ChevronRight size={18} />
            </button>
          </div>
        )}
```

a nahraď:

```jsx
        {period && (
          <div className="month-nav">
            <button className="btn btn-ghost btn-icon" onClick={() => setPeriod(p => addPeriods(p, -1))}>
              <ChevronLeft size={18} />
            </button>
            <span className="month-label">{formatPeriod(periodStart, periodEnd)}</span>
            <button className="btn btn-ghost btn-icon"
              onClick={() => setPeriod(p => addPeriods(p, 1))}
              disabled={period >= currentPeriod}>
              <ChevronRight size={18} />
            </button>
            <button
              className="btn btn-ghost"
              onClick={resetToCurrent}
              disabled={period === currentPeriod}
              title={t.period.resetToCurrent}
            >
              {t.period.resetToCurrent}
            </button>
          </div>
        )}
```

- [ ] **Step 4: Build**

Run: `cd client && npm run build`
Expected: build projde.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/DashboardPage.jsx
git commit -m "feat: Dashboard – period z contextu + tlačítko Aktuální měsíc"
```

---

## Task 5: Refactor ReportPage – context + tlačítko

**Files:**
- Modify: `client/src/pages/ReportPage.jsx`

- [ ] **Step 1: Import `usePeriod`**

V `client/src/pages/ReportPage.jsx` na řádek 1 (po existujícím `import { useState, useEffect } from 'react';`) přidej:

```jsx
import { usePeriod } from '../contexts/PeriodContext';
```

- [ ] **Step 2: Nahraď lokální period state a fetch /api/settings**

V `client/src/pages/ReportPage.jsx` najdi řádky 189-208:

```jsx
  const [period, setPeriod] = useState(null);
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [currentPeriod, setCurrentPeriod] = useState(null);
  const [incomeSources, setIncomeSources] = useState([]);
  const [fixedExpenses, setFixedExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);       // Typ 1
  const [stats, setStats] = useState(null);          // total_spent + by_category
  const [loading, setLoading] = useState(true);
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [editIncome, setEditIncome] = useState(null);
  const [showFixedForm, setShowFixedForm] = useState(false);
  const [editFixed, setEditFixed] = useState(null);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(s => {
      setPeriod(s.current_period);
      setCurrentPeriod(s.current_period);
    });
  }, []);
```

a nahraď:

```jsx
  const { period, setPeriod, currentPeriod, resetToCurrent } = usePeriod();
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [incomeSources, setIncomeSources] = useState([]);
  const [fixedExpenses, setFixedExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);       // Typ 1
  const [stats, setStats] = useState(null);          // total_spent + by_category
  const [loading, setLoading] = useState(true);
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [editIncome, setEditIncome] = useState(null);
  const [showFixedForm, setShowFixedForm] = useState(false);
  const [editFixed, setEditFixed] = useState(null);
```

- [ ] **Step 3: Přidej tlačítko do period switcheru**

V `client/src/pages/ReportPage.jsx` najdi blok (řádky 280-292):

```jsx
        {period && (
          <div className="month-nav">
            <button className="btn btn-ghost btn-icon" onClick={() => setPeriod(p => addPeriods(p, -1))}>
              <ChevronLeft size={18} />
            </button>
            <span className="month-label">{formatPeriod(periodStart, periodEnd)}</span>
            <button className="btn btn-ghost btn-icon"
              onClick={() => setPeriod(p => addPeriods(p, 1))}
              disabled={period >= currentPeriod}>
              <ChevronRight size={18} />
            </button>
          </div>
        )}
```

a nahraď:

```jsx
        {period && (
          <div className="month-nav">
            <button className="btn btn-ghost btn-icon" onClick={() => setPeriod(p => addPeriods(p, -1))}>
              <ChevronLeft size={18} />
            </button>
            <span className="month-label">{formatPeriod(periodStart, periodEnd)}</span>
            <button className="btn btn-ghost btn-icon"
              onClick={() => setPeriod(p => addPeriods(p, 1))}
              disabled={period >= currentPeriod}>
              <ChevronRight size={18} />
            </button>
            <button
              className="btn btn-ghost"
              onClick={resetToCurrent}
              disabled={period === currentPeriod}
              title={t.period.resetToCurrent}
            >
              {t.period.resetToCurrent}
            </button>
          </div>
        )}
```

- [ ] **Step 4: Build**

Run: `cd client && npm run build`
Expected: build projde.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ReportPage.jsx
git commit -m "feat: Schůzka – period z contextu + tlačítko Aktuální měsíc"
```

---

## Task 6: Refactor BudgetsPage – context + tlačítko

**Files:**
- Modify: `client/src/pages/BudgetsPage.jsx`

- [ ] **Step 1: Import `usePeriod`**

V `client/src/pages/BudgetsPage.jsx` přidej za řádek 1:

```jsx
import { usePeriod } from '../contexts/PeriodContext';
```

- [ ] **Step 2: Nahraď lokální period state + fetch /api/settings**

V `client/src/pages/BudgetsPage.jsx` v `export default function BudgetsPage()` najdi řádky 497-518:

```jsx
  const navigate = useNavigate();
  const [period, setPeriod] = useState(null);
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [currentPeriod, setCurrentPeriod] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [annualYear, setAnnualYear] = useState(new Date().getFullYear());

  useEffect(() => {
    Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/categories').then(r => r.json()),
    ]).then(([s, cats]) => {
      setPeriod(s.current_period);
      setCurrentPeriod(s.current_period);
      setCategories(cats);
    });
  }, []);
```

a nahraď:

```jsx
  const navigate = useNavigate();
  const { period, setPeriod, currentPeriod, resetToCurrent } = usePeriod();
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [annualYear, setAnnualYear] = useState(new Date().getFullYear());

  useEffect(() => {
    fetch('/api/categories').then(r => r.json()).then(setCategories);
  }, []);
```

(Z původního `Promise.all` zůstal jen fetch kategorií. Period si načte provider.)

- [ ] **Step 3: Přidej tlačítko do period switcheru**

V `client/src/pages/BudgetsPage.jsx` najdi blok (řádky 552-565):

```jsx
          {period && (
            <div className="month-nav">
              <button className="btn btn-ghost btn-icon"
                onClick={() => { setPeriod(p => addPeriods(p, -1)); setShowForm(false); setEditItem(null); }}>
                <ChevronLeft size={18} />
              </button>
              <span className="month-label">{periodLabel}</span>
              <button className="btn btn-ghost btn-icon"
                onClick={() => { setPeriod(p => addPeriods(p, 1)); setShowForm(false); setEditItem(null); }}
                disabled={period >= currentPeriod}>
                <ChevronRight size={18} />
              </button>
            </div>
          )}
```

a nahraď:

```jsx
          {period && (
            <div className="month-nav">
              <button className="btn btn-ghost btn-icon"
                onClick={() => { setPeriod(p => addPeriods(p, -1)); setShowForm(false); setEditItem(null); }}>
                <ChevronLeft size={18} />
              </button>
              <span className="month-label">{periodLabel}</span>
              <button className="btn btn-ghost btn-icon"
                onClick={() => { setPeriod(p => addPeriods(p, 1)); setShowForm(false); setEditItem(null); }}
                disabled={period >= currentPeriod}>
                <ChevronRight size={18} />
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => { resetToCurrent(); setShowForm(false); setEditItem(null); }}
                disabled={period === currentPeriod}
                title={t.period.resetToCurrent}
              >
                {t.period.resetToCurrent}
              </button>
            </div>
          )}
```

(Pozn.: zachovávám konzistenci s existujícími tlačítky — také zavírají form/edit při změně období.)

- [ ] **Step 4: Build**

Run: `cd client && npm run build`
Expected: build projde.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/BudgetsPage.jsx
git commit -m "feat: Měsíční výdaje – period z contextu + tlačítko Aktuální měsíc"
```

---

## Task 7: Refactor TransactionsPage – context + URL deep-link + tlačítko

**Files:**
- Modify: `client/src/pages/TransactionsPage.jsx`

- [ ] **Step 1: Import `usePeriod`**

V `client/src/pages/TransactionsPage.jsx` přidej za řádek 1:

```jsx
import { usePeriod } from '../contexts/PeriodContext';
```

- [ ] **Step 2: Nahraď lokální period state, ponech ostatní URL params**

V `client/src/pages/TransactionsPage.jsx` najdi řádky 38-44:

```jsx
  const [searchParams] = useSearchParams();
  const urlFrom = searchParams.get('from');
  const urlTo = searchParams.get('to');
  const [period, setPeriod] = useState(searchParams.get('period') || null);
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [currentPeriod, setCurrentPeriod] = useState(null);
```

a nahraď:

```jsx
  const [searchParams] = useSearchParams();
  const urlFrom = searchParams.get('from');
  const urlTo = searchParams.get('to');
  const urlPeriod = searchParams.get('period');
  const { period, setPeriod, currentPeriod, resetToCurrent } = usePeriod();
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
```

- [ ] **Step 3: Uprav úvodní useEffect — deep link wins, fetch /api/settings beze změny pro periodStart/End/customFrom/To**

V `client/src/pages/TransactionsPage.jsx` najdi řádky 68-81:

```jsx
  useEffect(() => {
    Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/categories').then(r => r.json()),
    ]).then(([s, cats]) => {
      setCurrentPeriod(s.current_period);
      setPeriod(p => p || s.current_period);
      setPeriodStart(s.period_start);
      setPeriodEnd(s.period_end);
      if (!urlFrom) setCustomFrom(s.period_start);
      if (!urlTo) setCustomTo(s.period_end);
      setCategories(cats);
    });
  }, []);
```

a nahraď:

```jsx
  useEffect(() => {
    // URL deep-link má přednost před contextem
    if (urlPeriod) setPeriod(urlPeriod);

    Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/categories').then(r => r.json()),
    ]).then(([s, cats]) => {
      setPeriodStart(s.period_start);
      setPeriodEnd(s.period_end);
      if (!urlFrom) setCustomFrom(s.period_start);
      if (!urlTo) setCustomTo(s.period_end);
      setCategories(cats);
    });
  }, []);
```

(Pozn.: `currentPeriod` už nesetujeme — řeší provider. `setPeriod(p => p || s.current_period)` taky padá — provider to udělá. Pokud URL má `period`, zavoláme `setPeriod(urlPeriod)` před fetchem.)

- [ ] **Step 4: Přidej tlačítko do period switcheru**

V `client/src/pages/TransactionsPage.jsx` najdi blok (řádky 263-277):

```jsx
          {!customMode && period && (
            <div className="month-nav">
              <button className="btn btn-ghost btn-icon" onClick={() => setPeriod(p => addPeriods(p, -1))}>
                <ChevronLeft size={18} />
              </button>
              <span className="month-label">{formatPeriod(periodStart, periodEnd)}</span>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => setPeriod(p => addPeriods(p, 1))}
                disabled={period >= currentPeriod}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
```

a nahraď:

```jsx
          {!customMode && period && (
            <div className="month-nav">
              <button className="btn btn-ghost btn-icon" onClick={() => setPeriod(p => addPeriods(p, -1))}>
                <ChevronLeft size={18} />
              </button>
              <span className="month-label">{formatPeriod(periodStart, periodEnd)}</span>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => setPeriod(p => addPeriods(p, 1))}
                disabled={period >= currentPeriod}
              >
                <ChevronRight size={18} />
              </button>
              <button
                className="btn btn-ghost"
                onClick={resetToCurrent}
                disabled={period === currentPeriod}
                title={t.period.resetToCurrent}
              >
                {t.period.resetToCurrent}
              </button>
            </div>
          )}
```

- [ ] **Step 5: Ověř, že `t` je v importu**

Run: `grep -n "from '../i18n" client/src/pages/TransactionsPage.jsx`
Expected: řádek s importem `t` (a případně dalších helperů) z `'../i18n'`. Pokud `t` chybí v importech, doplň ho. Když je tam jen `formatPeriod` apod., uprav řádek na `import { t, formatPeriod, addPeriods } from '../i18n';` (zachovej původní jména už importovaná, přidej `t`).

- [ ] **Step 6: Build**

Run: `cd client && npm run build`
Expected: build projde.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/TransactionsPage.jsx
git commit -m "feat: Transakce – period z contextu (URL deep-link wins) + tlačítko Aktuální měsíc"
```

---

## Task 8: Ruční ověření + push na staging

**Files:** —

- [ ] **Step 1: Lokálně spusť dev server**

Run: `npm run dev` (z root adresáře). Frontend dev běží přes Vite, backend Express servíruje `/api/*`. Pokud projekt vyžaduje samostatné spuštění, použij dle CLAUDE.md (`feedback_local_dev.md` v memory).

- [ ] **Step 2: Projdi scénář v prohlížeči**

1. Otevři `/` (Dashboard). Klikni 2× šipku vlevo → Měsíční label = aktuální měsíc -2. Tlačítko „Aktuální měsíc" je aktivní (ne disabled).
2. V menu klikni „Schůzka" → měsíc drží na -2 (ne aktuální).
3. Klikni „Měsíční výdaje" → měsíc drží na -2.
4. Klikni „Transakce" → měsíc drží na -2.
5. Klikni tlačítko „Aktuální měsíc" → label se přepne na aktuální měsíc, tlačítko se disabluje.
6. Klikni „Dashboard" → aktuální měsíc.
7. Stiskni F5 → aktuální měsíc (persistence napříč refreshem NENÍ v scope, je to OK).
8. Otevři přímo `/transactions?period=2025-12` (deep link). Měsíc je 2025-12. Přepni na Dashboard → 2025-12.
9. Ověř, že na `/categories`, `/settings`, `/import`, `/duplicates` (stránky bez period switcheru) nic nepadá.

Pokud cokoliv selže, vrať se ke kroku, kde problém vznikl, oprav, nový commit.

- [ ] **Step 3: Push na staging**

```bash
git push origin staging
```

Railway nasadí staging.

- [ ] **Step 4: Po úspěšném buildu na Railway hlas uživateli číslo verze**

Z poslední commit zprávy získej version bump (pre-commit hook v repu automaticky bumpuje `package.json` `version`). Z `package.json` přečti `"version"`.

---

## Self-review notes

- **Spec coverage:** Provider (Task 1+2), čtyři stránky (Tasks 4-7), tlačítko (každý task), i18n (Task 3), URL deep-link na TransactionsPage (Task 7), session-only persistence (Task 1 — žádné localStorage), manuální scénář (Task 8). Pokryto.
- **Placeholder check:** Žádné TBD/TODO. Veškerý kód je v plánu konkrétně.
- **Type consistency:** Context exportuje `{ period, setPeriod, currentPeriod, resetToCurrent }` — všechny tasky používají stejné názvy.
- **Risk:** Pokud `t` není importované v některém ze 4 page souborů, build by selhal — Task 7 step 5 to explicitně ověřuje pro TransactionsPage. Pro ostatní 3 stránky `t` už importované je (používá se `t.dashboard.title`, `t.common.loading` apod.) — viz stávající kód.
