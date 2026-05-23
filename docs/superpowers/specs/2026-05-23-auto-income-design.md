# Auto-Příjmy + always-import (Fáze 2)

**Datum:** 2026-05-23
**Autor:** Tomas + Claude
**Status:** Schváleno (rozhodnutí: 1b — manuální `income_sources` jako alias; 2a — always-import; A — re-použít role='income' jako „income source"), čeká na implementační plán
**Předchází:** Fáze 1 (CSV archiv) — v produkci.
**Navazuje:** Fáze 3 (zálohy DB) — eskalace z backlogu.

## Problém

Dnes Schůzka zobrazuje příjmy jen pokud uživatel ručně definuje `income_sources` s `match_pattern`. Import navíc defaultně přeskakuje příchozí transakce (`skip_incoming=true`), takže příjmové platby ani nejsou v DB. Výsledek: nutná údržba sources, zápočet závisí na `account.role='income'` jako destination (ale žádný účet tu roli nemá), a OSVČ→Hlavní převod není rozpoznán jako příjem.

## Cíl

1. Příchozí transakce **vždy importovat** (skip toggle pryč), aby byly v DB k auto-detekci.
2. Na Schůzce **automaticky** rozpoznat příjmy ze surových transakcí — bez nutnosti ručních `income_sources`.
3. Ponechat ruční `income_sources` jako **volitelný alias/label** (pojmenovat skupinu, dát očekávanou částku pro status).
4. Re-použít `role='income'` na účtech v nové sémantice: „vlastní účet, jehož převody se počítají jako příjem do domácnosti" (typicky OSVČ).

## Architektura

### Nová sémantika `accounts.role`

- `spending` — operativní účty (Společný, Nepravidelné, Licence, …). Transakce vstupují do reportů/budgetů.
- `fixed` — fixní platby (Harmonicka-nájem). Vstupují do reportů.
- `income` — **NOVÁ SÉMANTIKA**: vlastní účet, jehož převody směrem k aktivním účtům (`spending`/`fixed`) se počítají jako příjem domácnosti. Typicky OSVČ.
- `ignored` — beze změny. Účet je v evidenci (kvůli archivu, detekci interních převodů…), ale jeho transakce se nezapočítávají do reportů ani do příjmů (Hlavní jako transit, Spořicí, Tom-AirBank, Dane).

Old sémantika `role='income'` (= destination of income) **odpadá** — nahrazena pravidly níže.

### Pravidla auto-detekce příjmů

Pro období `[start, end]`:

**Příjem** = transakce kde:
- `amount > 0` (přílo na účet uživatele), AND
- `account_id` patří uživateli (libovolná role kromě toho, aby ji uživatel nesmazal), AND
- `counterparty_account` (normalizovaný = jen číslice před `/`):
  - NENÍ číslo žádného z uživatelových účtů, **NEBO**
  - JE číslo některého z uživatelových účtů, ale tento účet má `role='income'`.

**Interní převod** (vyloučeno z příjmů) = `counterparty_account` se shoduje s číslem vlastního účtu s rolí `spending` / `fixed` / `ignored`.

Edge case: transakce **bez** `counterparty_account` — zařazena podle `description` (fallback group key). Pokud popis vypadá jako interní transfer (TBD heuristika), vyloučeno — v MVP necháváme všechny non-counterparty incoming jako „neznámý zdroj".

### Seskupení a alias

Auto-skupiny:
- Group key = normalizovaný counterparty_account (přednost), fallback `description`.
- Per skupina: `total = SUM(amount)`, `tx_count`, primární `display_name` = label z counterparty (číslo účtu) / description.

Aplikace ručních aliasů (`income_sources`):
- Pro každou auto-skupinu projdi `income_sources` uživatele a najdi shodu:
  1. **NOVÉ pole** `match_counterparty_account` (text, normalizované číslo) — pokud se shoduje s group key counterparty → match. Přednost.
  2. **Stávající** `match_pattern` (LIKE proti description transakcí ve skupině) — pokud existuje a shoduje se s alespoň jednou transakcí ve skupině → match.
- Pokud match: `display_name = source.person`, `planned_amount = source.planned_amount`, `status = incomeStatus(planned, actual, tx_count)`.
- Pokud žádný match: skupina zůstává „auto-only" — bez očekávané částky a bez statusu.

Ruční zdroj **bez** auto-shody (např. plánovaný zdroj, který v tomto období nedorazil):
- Vrátí se jako řádek s `actual=0`, `tx_count=0`, `status='missing'`. Funguje jako dnes.

### Endpoint změny

**`GET /api/income?period=YYYY-MM`** — zachovaná URL, přepsaná logika:

Response shape stejný (minimalizovat změny frontendu):
```json
{
  "period": "2026-05",
  "sources": [
    {
      "id": 1 | null,                  // null = auto-only, číslo = navázaný income_source
      "person": "Tom" | "1679014031",  // alias nebo counterparty label
      "planned_amount": 162000 | null,
      "match_pattern": "Strida" | null,
      "match_counterparty_account": "1679014031" | null,
      "actual": 162000,
      "tx_count": 1,
      "status": "ok" | "mismatch" | "missing" | null,  // null pokud planned chybí
      "sort_order": 0
    }, ...
  ]
}
```

Pořadí: nejdřív ruční zdroje (po `sort_order, id`), pak auto-only skupiny seřazené sestupně podle `total`.

**Schema migrace:**
```sql
ALTER TABLE income_sources ADD COLUMN match_counterparty_account TEXT;
```

**`POST /api/income`** (vytvoření zdroje): rozšířeno o `match_counterparty_account`. Beze změny pro stávající zdroje.

**`PATCH /api/income/:id`**: dtto.

**Import:**
- `POST /api/import/confirm` — `skip_incoming` se přestane respektovat (alias na false). Default v handleru: false. Pole zůstává v signatuře, aby starší klient nezpůsobil chybu, ale je tichá ignored.
- Frontend ImportPage: toggle „Přeskočit příchozí" **odebrán**. Všechny incoming se importují.

### Frontend (ReportPage / Schůzka)

Sekce Příjmy:
- Mapuje stejné pole `sources` z `/api/income` — kód v `ReportPage.jsx` zůstává prakticky beze změny.
- **Status icons** (`✅⚠️❌`) zobrazit jen pokud `row.status !== null` (auto-only řádky bez planned mají status null).
- **Tlačítka Edit/Delete** zobrazit jen pokud `row.id != null` (auto-only nelze editovat — nejsou v `income_sources`).
- Klik na řádek → `/transactions?period=&q=<counterparty>` nebo dle counterparty filtru (volitelné rozšíření, nemusí být v Fázi 2 — pokud jednoduché, přidat).

Form `IncomeSourceForm`:
- Přidat pole **„Číslo protiúčtu"** (volné, volitelné). Mapováno na `match_counterparty_account`.
- Popis: „Použij pro přesnou shodu (např. číslo OSVČ účtu) — má přednost před textem popisu."

### Update role descriptions

V `client/src/pages/ImportPage.jsx` (component `AccountSelector`):

```js
const ROLE_HINTS = {
  spending: 'Transakce vstupují do kategorií a budgetů.',
  fixed:    'Transakce jsou fixní výdaje (nájem, energie…), nezapočítávají se do budgetů.',
  income:   'Vlastní účet, jehož převody do spending/fixed účtů jsou příjem domácnosti (OSVČ).',
  ignored:  'Účet je mimo evidenci (transit, savings, daně…). Transakce ignorovány v reportech.',
};
```

## Edge cases

- **Transakce bez counterparty:** group by description. V současných datech nejčastěji ne-AirBank manuální tx; AirBank obvykle counterparty dává.
- **Více transakcí ze stejného protiúčtu v období:** sečtou se do jednoho řádku (auto-grouping). Detail klikem.
- **`income_source` s `match_pattern` matchuje transakce ve dvou různých skupinách:** dnes nemůže nastat (pattern proti description), v praxi popis se v rámci skupiny opakuje. Pokud nastane, alias se aplikuje na první matching skupinu (deterministicky podle order).
- **Smazání role='income'** na OSVČ: jeho převody přestanou být detekované jako příjem. Bez varování v UI.
- **Backfill:** dosavadní importy `skip_incoming=true` → DB nemá historické incoming. Pro období před změnou Příjmy ukáží jen ruční zdroje, které matchují něco v DB (nic, pokud incoming chybí). Uživatel re-importuje minulé CSV pro backfill (dedup transakcí přes external_id zabrání duplicitě).

## Co je mimo scope Fáze 2

- UI pro hromadnou změnu rolí účtů — uživatel mění roli per účet přes existující dropdown v AccountSelectoru.
- Heuristika „interní transfer podle popisu" pro tx bez counterparty.
- Click-through z řádku příjmu do filtrovaných transakcí (nice-to-have; přidám pokud bude trivial, jinak odložím).
- Phase 3 (zálohy DB).

## Testovací scénář (ruční)

1. Nastavit Tom-OSVC `role='income'` (přes Import → AccountSelector → role dropdown).
2. Importovat CSV obsahující příchozí převod z OSVČ → po importu transakce v DB (bez skip).
3. Na Schůzce: sekce Příjmy ukazuje řádek s alias / counterparty číslem OSVČ a částkou.
4. Vytvořit `income_source` „Tom" s `match_counterparty_account=1679014031` (a optional `planned_amount=162000`). Po refresh: řádek se přepojmenuje na „Tom", přidá se status ✅/⚠️/❌ podle planned vs actual.
5. Importovat CSV z Hlavního s transferem ze Spořicího → na Schůzce **NESMÍ** být v Příjmech (interní mezi tracked účty, Spořicí role='ignored').
6. Toggle „Přeskočit příchozí" v Importu **není** vidět.

## Rizika

- **Role re-purpose** je breaking change sémantiky pro existing 'income' use case. V dnešní DB ale žádný účet nemá `role='income'`, takže nikomu se nic nerozbije. Old query v `routes/income.js` (filter `a.role='income'` jako destination) odpadá při přepsání endpointu.
- **`income_sources` zůstávají, ale jejich starý match_pattern matching používal pouze accounts s role='income'**. Po přepsání už nepoužíváme filter na destination — pattern se aplikuje na transakce ze všech accountů. Praktický dopad: pattern „Strida" zachytí všechny transakce s tím popisem napříč všemi účty, ne jen ty co přistály na 'income' účtu. Pravděpodobně OK / chtěné. Pokud by uživatel měl konflikt (např. „Strida" jako popis výdaje), counterparty_account match má přednost.
- **Backfill:** historie bez incoming není ideální, ale řešitelná re-importem.
