# Sdílený period state napříč stránkami + tlačítko „Aktuální měsíc"

**Datum:** 2026-05-21
**Autor:** Tomas + Claude
**Status:** Schváleno, čeká na implementační plán

## Problém

Stránky `Dashboard`, `Schůzka`, `Měsíční výdaje` (Budgets) a `Transakce` mají vlastní period switcher (←/→ chevrony, label „Listopad 2026"). Aktuálně každá stránka drží `period` jako vlastní `useState` a inicializuje ho z `/api/settings.current_period`. Důsledek: když uživatel přepne na Dashboardu měsíc dozadu, klikne na Měsíční výdaje, stránka znovu naběhne na aktuální měsíc. Uživatel musí překlikávat zpět.

Druhý problém: chybí rychlý reset zpět na aktuální měsíc — uživatel musí klikat šipku několikrát.

## Cíl

1. Vybraný měsíc přežívá přepínání mezi stránkami v rámci jedné session.
2. Vedle period switcheru je tlačítko **„Aktuální měsíc"**, které resetuje zpět; je vždy viditelné, `disabled` když už uživatel je na aktuálním měsíci.

Mimo scope:
- Persistence přes refresh / nový tab (rozhodnuto: ne, jen session memory).
- URL deep-linking nad rámec stávajícího `TransactionsPage` chování.

## Architektura

### `PeriodContext`

Nový soubor `client/src/contexts/PeriodContext.jsx`:

```jsx
export const PeriodContext = createContext(null);

export function PeriodProvider({ children }) {
  const [period, setPeriod] = useState(null);
  const [currentPeriod, setCurrentPeriod] = useState(null);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(s => {
      setCurrentPeriod(s.current_period);
      setPeriod(p => p ?? s.current_period); // init jen poprvé
    });
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

### Mount point

V `App.jsx` obalit `<Routes>` (uvnitř `AuthContext`, ale tak, aby provider mountoval až pro přihlášeného uživatele — viz Otevřená otázka níže).

### Konzumace na stránkách

Čtyři dotčené stránky:
- `client/src/pages/DashboardPage.jsx`
- `client/src/pages/ReportPage.jsx` (Schůzka)
- `client/src/pages/BudgetsPage.jsx` (Měsíční výdaje)
- `client/src/pages/TransactionsPage.jsx`

Změna v každé:
- Odstranit lokální `const [period, setPeriod] = useState(null)` a `const [currentPeriod, setCurrentPeriod] = useState(null)`.
- Nahradit `const { period, setPeriod, currentPeriod, resetToCurrent } = usePeriod();`.
- `useEffect`, který četl `/api/settings` jen kvůli period state, lze odstranit (provider to dělá centrálně). Pokud effect četl ještě něco jiného (např. `billing_day`), to nechat.
- `periodStart`, `periodEnd` zůstávají lokální (přicházejí z per-page API response, jsou závislé na fetchnutém období).

### Reset button — UI

V každé z dotčených stránek, v sekci s period switcherem, přidat hned za chevrony:

```jsx
<button
  className="btn btn-ghost btn-sm"
  onClick={resetToCurrent}
  disabled={period === currentPeriod}
  title={t.period.resetToCurrent}
>
  {t.period.resetToCurrent}
</button>
```

(Přesný markup vyladit podle stávajícího layoutu na každé stránce; třída `btn-sm` jen pokud existuje — jinak `btn btn-ghost`.)

### i18n

Do `client/src/i18n.js` přidat:

```js
period: {
  // ... stávající klíče
  resetToCurrent: 'Aktuální měsíc',
}
```

## TransactionsPage — URL deep-link

`TransactionsPage` dnes čte `searchParams.get('period')` při inicializaci (`useState(searchParams.get('period') || null)`). Tato funkčnost zůstává — slouží pro deep-linky z Dashboardu (kliknutí na kategorii v daném měsíci).

Pravidlo: na mountu `TransactionsPage`, pokud URL má `?period=YYYY-MM`, zavolá se `setPeriod(urlPeriod)` z contextu. Tím deep link vyhraje a od té chvíle se vybraný měsíc propaguje dál do contextu.

Pseudokód:

```jsx
useEffect(() => {
  const urlPeriod = searchParams.get('period');
  if (urlPeriod && urlPeriod !== period) {
    setPeriod(urlPeriod);
  }
}, []); // jen na mountu
```

Ostatní query params (`cats`, `amount_min`, `amount_max`, `from`, `to`) se nemění.

## Otevřená otázka — kde mountovat provider

Dvě varianty:

**A) Obal celé `<Routes>` v `App.jsx`** — provider mountuje vždy, i pro nepřihlášeného uživatele. Fetch `/api/settings` skončí 401 → provider zůstane v `null` stavu. Stránky to neuvidí, protože nepřihlášeného uživatele router stejně přesměruje na `/login`.

**B) Obal jen autentizovanou část** — provider mountuje až po loginu. Čistší, ale vyžaduje vědět, jak je dnes oddělená přihlášená vs. nepřihlášená sekce.

Default: **varianta A**, jednodušší. Pokud `App.jsx` má jasně oddělenou „auth gate", vzít B. Rozhodne se při čtení `App.jsx` v plánu.

## Edge cases

- **Provider ještě nenačetl `/api/settings`:** `period` je `null`, stejně jako dnes. Stránky už mají `if (!period || loading) return <Loader/>` (nebo ekvivalent) — beze změny.
- **Uživatel změní `billing_day` v nastavení:** `currentPeriod` se nepřepočítá automaticky. Akceptovatelné — uživatel udělá F5 po změně settings. (Stejné chování jako dnes.)
- **Deep link na `TransactionsPage` s `?period=` po předchozí navigaci:** URL vyhraje, context se nasetuje na URL hodnotu.
- **`addPeriods(p, 1)` ze stránky, kdy `p` je null:** nestane se, protože switcher rendering je už dnes podmíněný na `period != null`.

## Testovací scénář (ruční)

1. Otevři Dashboard, klikni 2× šipku vlevo → vidíš měsíc -2.
2. Klikni na „Schůzka" v menu → stejný měsíc -2, ne aktuální.
3. Klikni na „Měsíční výdaje" → stejný měsíc -2.
4. Klikni na „Transakce" → stejný měsíc -2.
5. Klikni na „Aktuální měsíc" → reset na current; tlačítko se zdisabluje.
6. Klikni „Dashboard" → aktuální měsíc.
7. F5 → aktuální měsíc (persistence napříč reloady NENÍ v scope).
8. Deep-link `?period=2025-12` na Transakce → měsíc je 2025-12; přepni na Dashboard → 2025-12.

## Co se NEMĚNÍ

- Backend / `/api/...` endpoints.
- `period_start` / `period_end` výpočty na serveru, `billing_day` flow.
- Layout / vzhled stránek mimo přidání jednoho tlačítka.
- Ostatní query parametry na `TransactionsPage`.

## Rizika

Minimální. Mechanická refaktorace stejného patternu na 4 místech. Hlavní riziko je přehlédnout nějakou stránku, která drží period state — explicitně omezeno na výše vyjmenované 4. (Ostatní stránky — Categories, Settings, Import, Duplicates — period switcher nemají.)
