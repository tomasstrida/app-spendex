# Příjmy (automatická detekce) + oprava duplicitních fixních plateb

**Datum:** 2026-05-18
**Stránka:** Měsíční schůzka (`client/src/pages/ReportPage.jsx`)
**Kontext:** Na schůzce se nezobrazují žádné příjmy a fixní platby dvojitě započítávají nájem + energii.

## Problém

1. **Příjmy se nezobrazují.** Tabulka `income` se plní jen ručně per období. Pro běžné období nikdo nic nezadá → sekce „Příjmy" je prázdná. Skutečný příjem chodí na účet **Hlavní** (role `ignored`), takže ho aplikace nikde nevidí. Uživatel chce vždy vidět příjmy rozdělené na **Tom / Martin / Sudo nájem**.
2. **Duplicitní fixní platby.** Dotaz `fromAccounts` ve `src/routes/fixed-expenses.js` vrací všechny odchozí transakce z účtů s rolí `fixed`, i ty, které už pokrývá `match_pattern` ruční položky. Výsledek: „JANA HRDLIČKOVÁ" (38 126) duplikuje „Nájem Stodůlky", „Pražská energetika, a.s." (3 500) duplikuje „Záloha energie PRE". `Fixní platby celkem` je 99 542 místo správných ~57 916. Account-řádky mají `id = null`, takže je nelze smazat tlačítkem.

## Cíl

- Příjmy se na schůzce zobrazují automaticky, rozdělené na Tom / Martin / Sudo nájem, jako plán vs. skutečnost (stejný vizuál jako fixní platby).
- Fixní platby se nezapočítávají dvakrát; zmizí duplicitní account-řádky pokryté ručním `match_pattern`.

## Část A — Příjmy: automatická detekce z transakcí

Mirror modelu fixních plateb: konfigurovatelné zdroje příjmu + sumace skutečných příchozích transakcí za období.

### Datový model

Nová tabulka (per uživatel, **ne** per období — analogie `fixed_expenses`):

```sql
CREATE TABLE IF NOT EXISTS income_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  person TEXT NOT NULL,
  planned_amount REAL NOT NULL DEFAULT 0,
  match_pattern TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Stávající tabulka `income` (ruční záznamy per období) **zůstává beze změny** — kód ji už používá; nový model ji nahrazuje jako primární zdroj zobrazení, `income` se přestane na schůzce číst (ponecháno kvůli historickým datům, neřešíme migraci).

> **Rozhodnutí:** Nezavádět override per období. Tomův příjem kolísá, ale skutečnost se bere z transakcí, takže override planned_amount nepotřebuje. `planned_amount` je jen referenční očekávání pro status (✅/⚠️/❌).

### Account scoping — nová role `income`

- Do `VALID_ROLES` v `src/routes/accounts.js` přidat `'income'`.
- Do `ROLE_LABELS` a `ROLE_HINTS` v `client/src/pages/ImportPage.jsx` přidat položku `income` (dropdown se generuje z těchto map automaticky → žádná další UI změna).
- Uživatel přiřadí roli `income` účtu **Hlavní** ručně v Importu.
- Detekce příjmů čte **pouze** transakce z účtů s rolí `income` (jinak by interní převody mezi vlastními účty zaplevelily součty).

### Backend — `src/routes/income.js`

Přepsat router na práci s `income_sources`:

- `GET /api/income?period=YYYY-MM` — vrátí seznam zdrojů; pro každý se `match_pattern` sečte `SUM(amount)` z transakcí kde `amount > 0`, `account.role = 'income'`, `date` v rozsahu období (`getPeriodDates(billingDay, period)`), `description LIKE '%pattern%'`. Vrací `{ period, sources: [{ id, person, planned_amount, match_pattern, actual, tx_count, status }] }`.
- `status` přes existující `paymentStatus(planned_amount, actual, tx_count)` z `utils/recurring` (stejná logika jako fixní platby; pro příjem `actual >= planned` = ✅).
- `POST /api/income` — vytvoří zdroj `{ person, planned_amount, match_pattern }`.
- `PATCH /api/income/:id` — edituje zdroj (person, planned_amount, match_pattern, sort_order).
- `DELETE /api/income/:id` — smaže zdroj.

> **Pozn. k `paymentStatus`:** Ověřit chování pro příjem (chceme: skutečnost ≥ plán → ok; výrazně méně → missing/mismatch). Pokud současná signatura nesedí na „příjem" sémantiku, přidat tenkou variantu `incomeStatus(planned, actual)` v `utils/recurring` místo ohýbání `paymentStatus`.

### Seed

Při inicializaci (idempotentně, jen pokud uživatel nemá žádné `income_sources`) vytvořit:

| person | match_pattern | planned_amount |
|---|---|---|
| Tom | `Tom - OSVC` | 140000 |
| Martin | `Bísek Libor` | 20000 |
| Sudo nájem | `Tomáš Střída` | 21000 |

Patterny i částky jsou editovatelné v UI.

### Frontend — `ReportPage.jsx`

Sekce „Příjmy" se vykreslí stejným vzorem jako „Fixní platby":

- řádek: status ikona (✅/⚠️/❌) + `person` + (skutečnost vs. plán hint při odchylce) + `actual` částka + edit/delete tlačítka,
- formulář `IncomeSourceForm` (analogie `FixedExpenseForm`): `person`, `planned_amount`, `match_pattern`,
- `Příjmy celkem` = `Σ actual`,
- souhrn ✅/⚠️/❌ pod seznamem (stejně jako fixní platby).

`IncomeForm` (starý, per-období ruční) se odstraní; `usedPersons` logika padá.

### Bilance

`totalIncome` v `ReportPage` = `Σ actual` ze zdrojů (dnes `Σ income.amount`). Sekce „Bilance" a „Příjmy celkem" beze změny logiky, jen jiný zdroj čísla.

## Část B — Oprava duplicitních fixních plateb

V `src/routes/fixed-expenses.js`, větev s `period`:

1. Sesbírat všechny neprázdné `match_pattern` z ručních položek (`manual.filter(m => m.match_pattern)`).
2. V dotazu `fromAccounts` vyřadit transakce, jejichž `description` odpovídá některému z těchto patternů — přidat dynamicky `AND NOT (description LIKE '%p1%' OR description LIKE '%p2%' …)` přes parametrizované placeholdery (žádná string interpolace).
3. Tím zmizí account-řádky „JANA HRDLIČKOVÁ" a „Pražská energetika, a.s." a `Fixní platby celkem` přestane dvojitě počítat.

Pokud žádné patterny nejsou, dotaz se nemění (zpětná kompatibilita).

## Out of scope (YAGNI)

- Migrace dat ze staré tabulky `income` do `income_sources`.
- Override `planned_amount` per období.
- Více příjmových účtů s různou sémantikou (model to umožní, ale neřeší se).
- Detekce příjmu mimo účty s rolí `income`.

## Testy

- `income.js`: GET sečte jen `amount > 0` z `role='income'` účtu v období; pattern match; status hranice; izolace per `user_id`.
- `fixed-expenses.js`: regrese — položka s `match_pattern` shodným s account-transakcí se v outputu objeví jen jednou; součet odpovídá; bez patternů beze změny.
- `accounts.js`: role `income` projde validací, neplatná role 400.

## Dopad / rizika

- **DB migrace:** nová tabulka přes `IF NOT EXISTS` v `schema.js` (žádný framework, konzistentní se stávajícím vzorem).
- **Manuální krok:** uživatel musí přiřadit roli `income` účtu Hlavní, jinak budou příjmy 0 — zdokumentovat v UI hintu.
- **Prod data:** seed `income_sources` se pekne při rebuildu; deploy kódu sám příjmy nenaplní (viz paměť „Prod data propagation").
- **`paymentStatus` sémantika:** riziko špatného statusu pro příjem — ověřit/oddělit funkci.
