## Superpowers

At the start of every conversation, invoke the `superpowers:using-superpowers` skill.

# Spendex – kontext pro Claude Code

Spendex je osobní finanční aplikace pro domácnost dvou partnerů (Tom + Martin).
Podrobná produktová specifikace je v `docs/spendex-spec.md` – čti ji vždy, když řešíš business logiku, typy budgetů nebo alertovací pravidla.

## Stack

**Backend:** Node.js + Express, SQLite přes `better-sqlite3`, session auth (`express-session` + `passport`), Google OAuth. Spouští se jako jeden proces (`src/index.js`).

**Frontend:** React + Vite, React Router, Lucide ikony, vlastní CSS (žádný Tailwind ani UI framework). Build se generuje do `client/dist/` a backend ho servíruje jako statiku.

**Deploy:** Railway (`railway.toml`, `nixpacks.toml`). DB soubory `data.db` + `sessions.db` jsou na Railway volume.

## Adresářová struktura

```
src/
  index.js           – Express app, statika, session
  db/
    connection.js    – better-sqlite3 singleton
    schema.js        – CREATE TABLE + migrace (přidávej sem)
  routes/            – každý soubor = jeden router, mountovaný na /api/<název>
  middleware/
    auth.js          – requireAuth middleware
  services/          – passport setup, email
  utils/
    period.js        – logika období (billing day, periodKey "YYYY-MM")
    csvParser.js     – parsování bankovních výpisů
client/src/
  App.jsx            – routing, AuthContext
  pages/             – stránky (jedna komponenta = jedna stránka)
  components/        – sdílené komponenty (Layout, Sidebar)
  i18n.js            – texty UI + pomocné funkce (t, formatCurrency, formatPeriod)
```

## Workflow

Po každé změně kódu commituj a pushni do větve `staging` (ne `main`). Railway automaticky nasadí staging prostředí.

Pokud uživatel řekne „push do prod" nebo „nasaď do produkce":
1. `git checkout main`
2. `git merge staging`
3. `git push origin main`
4. `git checkout staging`

Railway automaticky nasadí produkci. Po dokončení potvrď uživateli, že produkce je aktuální.

## Klíčové architektonické konvence

**Období (period):** Měsíc není vždy 1.–poslední. Uživatel má `billing_day` (výchozí 1). Vždy používej `getPeriodDates(billingDay, periodKey)` z `utils/period.js` – nikdy nepočítej datum ručně. PeriodKey je string `"YYYY-MM"`.

**Budgety:** Tabulka `budgets` má dva typy záznamů:
- `month = 'default'` → výchozí budget platný pro všechna období bez přepsání
- `month = 'YYYY-MM'` → přepsání pro konkrétní období
Vždy načítej přes `COALESCE(override, default)` – viz `routes/budgets.js`.

**Kategorizace transakcí:** Dvě vrstvené pravidla:
1. `airbank_category_mappings` – mapování AirBank kategorií na Spendex kategorie
2. `category_rules` – textové patterny na description transakce

**Auth:** Session-based. `req.user` je dostupný po `requireAuth` middleware. Nikdy neukládej citlivá data do JWT.

**DB migrace:** Přidávají se na konec `schema.js` do `initSchema()` ve `try/catch` bloku (viz stávající příklady `ALTER TABLE`). Žádný migrační framework.

## Co je aktuálně hotové

- [x] Auth (local + Google OAuth, email verify, reset hesla)
- [x] Správa kategorií (CRUD, barva, ikona)
- [x] Budgety – měsíční, default + period overrides, scope='all'/'from'
- [x] Dashboard – progress bary budget vs. utraceno
- [x] Transakce – seznam, filtrování, ruční editace kategorie
- [x] Import – CSV parser + AirBank API (OAuth tokeny v `airbank_tokens`)
- [x] Nastavení – billing_day
- [x] Automatická kategorizace – category_rules + airbank_category_mappings

## Co se teprve staví (podle specifikace)

Viz `docs/spendex-spec.md` pro plné detaily. Klíčové featury:

**Typy budgetů (sekce 4 specifikace):**
Aktuálně jsou všechny budgety „měsíční" (Typ 1). Přibydou:
- **Typ 2 – Roční/sezónní:** budget má podpoložky (`budget_items`) s časovým oknem a expected amount. Alert = platba mimo okno nebo nad budget podpoložky.
- **Typ 3 – Fond obnovy „Drahé věci":** žádný timing, jen typická cena + frekvence. Zobrazení jako stav fondu, ne progress bar.

Schema změny které budou potřeba:
- Přidat `type` sloupec do `categories` nebo `budgets` (`monthly` / `annual` / `fund`)
- Nová tabulka `budget_items` pro podpoložky Typu 2 (category_id, name, amount, window_start month, window_end month)

**Vizualizace teploměru (sekce 7.2 specifikace):**
Nahradit stávající `BudgetBar` v DashboardPage teploměrem: rtuť = utraceno, svislá čárka = aktuální den v měsíci jako % z délky období. Platí jen pro Typ 1.

**Příjmy a měsíční bilance (sekce 7.4 specifikace):**
Přidat sledování příjmů (Tom OSVČ ~140k, Martin ~20k, Sudo nájem 21k). Měsíční přehled musí zobrazit kompletní obraz: příjmy / pevné výdaje / variabilní budgety / bilance.

**Projekce do konce měsíce:**
`projekce = utraceno_dnes / dny_uplynulé × dny_v_období`

## Důležitá business pravidla

- Alertovací práh: >10 % překročení budgetu = červená, 1–10 % = žlutá, ≤0 % = zelená
- OSVČ účet Toma je mimo scope aplikace – do přehledu vstupuje jen čistý příjem
- Výdaje z ročních kategorií (Typ 2) se NESMÍ zobrazit jako překročení měsíčního budgetu
- Jazyk UI: čeština (`i18n.js`)
