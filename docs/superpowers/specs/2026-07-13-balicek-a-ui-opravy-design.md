# Balíček A – Drobné UI opravy

**Datum:** 2026-07-13
**Stav:** Design schválen, čeká na implementační plán
**Zdroj:** Spendex backlog 13.7.2026 (položky 1, 2, 3)

## Kontext

První ze dvou balíčků nové verze (A = drobné UI opravy, B = přepracování modelu
kategorií). Balíček A je nezávislý na B, obsahuje tři samostatné frontendové
změny bez zásahu do schématu DB. Lze nasadit samostatně.

## Rozsah

Tři nezávislé změny. Každá se dá implementovat a otestovat izolovaně.

### A1 – Měsíce jako čísla místo zkratek

**Problém:** `formatPeriod` používá třípísmenné české zkratky (`led, úno, bře…`),
které jsou nejednoznačné. Backlog: „Nepoužívat zkratky měsíců, používej čísla."

**Změna:** `client/src/i18n.js`
- `formatPeriod(start, end)` (řádky 118–132) přestane sahat na `cs.monthsShort`
  a použije číslo měsíce (`getMonth() + 1`).
- Výstupní formát: `"19. 4. – 18. 5. 2026"`. Když je shodný rok, rok se uvede
  jen jednou na konci (zachovat stávající větvení `sYear === eYear`).
  Formát pro různé roky: `"19. 12. 2025 – 18. 1. 2026"`.
- Pole `cs.monthsShort` (řádek 105) se po přepsání **odstraní** — grep potvrdil,
  že jediné použití je ve `formatPeriod` (i18n.js:124–125).

**Rozsah dopadu:** `formatPeriod` je sdílená funkce použitá na 5 stránkách
(Dashboard, Settings, Report, Transactions, Budgets) — změna se propíše
konzistentně všude.

**Beze změny:** plné názvy `cs.months` (`Leden, Únor…`) — používají se ve výběru
a nadpisech období, kde nejsou nejednoznačné.

### A2 – Barvy přečerpání: kombinovaná logika

**Problém:** dnešní `budgetFillColor` vrací **červenou při jakémkoli přečerpání**
(`spent > amount`). Backlog žádá práh: přečerpání do 10 % oranžové, nad 10 %
červené. Zároveň chceme **zachovat** projekční oranžovou („hrozí přečerpání"),
kterou uživatel schválně zavedl (v2.0.113).

**Změna:** `client/src/utils/budgetColor.js` — `budgetFillColor` přepsat na:

```js
export function budgetFillColor({ spent, amount, daysPassed, totalDays }) {
  if (!(amount > 0)) return BUDGET_GREEN;              // bez rozpočtu nic nehrozí
  if (spent > amount) {                                 // přečerpáno
    return (spent - amount) / amount > 0.10 ? BUDGET_RED : BUDGET_ORANGE;
  }
  const spentPct = (spent / amount) * 100;
  const dayPct = totalDays > 0 ? Math.min((daysPassed / totalDays) * 100, 100) : 0;
  if (spentPct > dayPct) return BUDGET_ORANGE;          // hrozí přečerpání (projekce)
  return BUDGET_GREEN;
}
```

Sémantika:
- `amount ≤ 0` → 🟢 zelená (a žádné dělení nulou)
- `spent > amount` a přečerpání **≤ 10 %** → 🟠 oranžová
- `spent > amount` a přečerpání **> 10 %** → 🔴 červená
- `spent ≤ amount`, ale tempo (`spentPct`) překračuje uplynulé dny (`dayPct`)
  → 🟠 oranžová (hrozí)
- jinak → 🟢 zelená

**Hranice:** práh 10 % je striktní `> 0.10` — přečerpání přesně o 10 % je ještě
oranžové, teprve nad 10 % červené.

**Rozsah dopadu:** util sdílí `Thermometer` (Dashboard) i `YearThermometer`
(roční budgety) → nová logika platí pro měsíční i roční teploměry (konzistence).
Aktualizovat i doc-komentář na začátku souboru (řádky 1–7).

**Beze změny:** textové ikony statusu na Schůzce (`ReportPage.budgetStatus`,
práh 110 %) — už dnes odpovídají „nad 10 % = over".

### A3 – Součet Drahých věcí za období

**Problém:** sekce „Drahé věci" v Měsíčních rozpočtech je jen seznam jednotlivých
nákupů bez součtu.

**Změna:** `client/src/pages/DashboardPage.jsx` (sekce Drahé věci, řádky 225–278)
- Pod seznam `data.expensive_items` přidat řádek **„Celkem za období"** = suma
  částek nákupů v aktuálním období (`expensive_items` už je filtrovaný na období
  ve `stats.js:120–129`).
- Formátovat přes `formatCurrency`. Čistě frontendová agregace, žádný nový
  endpoint.

**Volba potvrzena:** součet **za období** (ne kumulativně za rok) — konzistentní
se zbytkem Měsíčních rozpočtů. Roční pohled přijde v balíčku B.

## Testy

- `client/src/utils/budgetColor.test.js` rozšířit o hraniční případy A2:
  - přečerpání přesně 10 % → oranžová
  - přečerpání nad 10 % → červená
  - přečerpání pod 10 % → oranžová
  - projekční oranžová (spentPct > dayPct, spent ≤ amount) → oranžová (regrese)
  - v normě → zelená (regrese)
- `formatPeriod` (A1): přidat test do `client/src/utils/` nebo `i18n` test, pokud
  harness existuje — ověřit shodný rok i přechod roku. Pokud test pro i18n dosud
  není, založit `client/src/i18n.test.js` (běží přes `node --test`).
- A3 je vizuální agregace bez utility funkce — ověřit ručně v běžící appce
  (`/verify`), případně extrahovat součet do čisté funkce a otestovat.

## Non-goals (mimo balíček A)

- Jakákoli změna schématu DB.
- Přesun Drahých věcí z kategorií na roční budget (to je balíček B — sekce
  „Drahé věci" v Dashboardu se zdrojově nemění, jen dostane součet).
- Skupiny/subkategorie, Fixní platby, příjmy bez tolerance, Apple párování.

## Nasazení

Po odsouhlasení implementace: commit + push do `staging` (Railway staging deploy),
poté na pokyn merge do `main` (prod). Hlásit číslo verze.
