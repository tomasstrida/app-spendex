# Revize zařazení — nástroj na výdaje na neobvyklém účtu

**Datum:** 2026-07-17
**Stav:** schváleno (brainstorming), k implementaci
**Kontext:** fáze B z diskuse „kategorie vs. role účtu". Fáze A (kategorie přebíjí
účet ve výpočtech) přijde až na vyčištěných datech — mimo rozsah tohoto specu.

## Problém

Když se výdaj s reálnou kategorií (běžný/roční/drahá věc) omylem zaplatí z účtu
s rolí `ignored` (Spořicí, zz-Hromadné akce, Tom-AirBank, Hlavní, Dane-doplatek),
`SPENDING_FILTER` ho ze všech výdajových výpočtů vyřadí — „zmizí". Uživatel to
dnes nemá jak systematicky najít a opravit.

## Zjištění z dat (proč je detekce úzká)

- **OSVČ (`role=income`) se NEřeší** — má 481k v „reálných" kategoriích (business).
  Zůstává tvrdě mimo scope.
- Ignorované účty mají 276k v „reálných" kategoriích, ale velká část je
  **„Mimo systém"** (vědomě mimo) a **„Pravidelné platby"** (fixní, počítané jinde).
  Ty se z revize vylučují — nejsou to omyly.

## Detekce „podezřelé transakce"

Transakce je podezřelá, když splňuje VŠE:
- `amount < 0` (výdaj),
- **není interní převod** — `counterparty_account` (normalizované) není žádné
  z vlastních čísel účtů,
- účet má **`role = 'ignored'`**,
- kategorie je **typ 1/2/3** (běžný / roční / drahá věc),
- název kategorie **není** v `{'Mimo systém', 'Pravidelné platby'}`,
- **není odložená** (`review_dismissed = 0`).

## Chování / akce

Stránka „Revize zařazení" ukáže seznam podezřelých (datum, popis, částka, kategorie,
účet, poznámka). U každé:
- **Přeřadit kategorii** (reuse `PATCH /api/transactions/:id`) — když je zařazení
  špatné (např. „převod do RB" omylem v „Drahé věci" → přeřadit na „Mimo systém").
  Po přeřazení mimo reálné kategorie transakce ze seznamu zmizí sama.
- **„Nechat, je to OK"** — odloží (`review_dismissed = 1`); transakce je zařazená
  správně a jen čeká na fázi A. Přestane se hlásit.

**Účet se NEmění** (nefalšujeme, odkud platba reálně odešla). Skutečné započítání
těchto výdajů vyřeší až fáze A.

## Backend

- Migrace: `ALTER TABLE transactions ADD COLUMN review_dismissed INTEGER NOT NULL DEFAULT 0`
  (do `initSchema()` v try/catch).
- `GET /api/review/misplaced` — vrací podezřelé transakce (detekce výše), s názvem
  účtu a kategorie. Řazení podle částky sestupně.
- `POST /api/review/dismiss` `{ id }` — ověří vlastnictví, nastaví `review_dismissed = 1`.
- `POST /api/review/undismiss` `{ id }` — vrátí zpět (pro jistotu).
- Interní převod / vlastní účty: `normCounterparty` z `utils/income.js`.
- Konstanta vyloučených kategorií (`Mimo systém`, `Pravidelné platby`) v routeru,
  komentovaná (jde o názvy — křehčí; do budoucna případně příznak na kategorii).

## Frontend

- `client/src/pages/ReviewPage.jsx`, route `/review`.
- Položka „Revize zařazení" v Sidebaru, sekce Konfigurace (u Duplicit).
- Seznam podezřelých; inline dropdown pro změnu kategorie; tlačítko „Nechat, je to OK".
- Prázdný stav: „Žádné výdaje na neobvyklém účtu — vše sedí."
- (Badge s počtem u položky menu — volitelné, later.)

## Mimo rozsah (YAGNI)

- Fáze A (kategorie přebíjí účet ve výpočtech).
- Přeúčtování (změna account_id).
- Řešení OSVČ (income zůstává mimo).
- Sjednocení klasifikace měsíční/roční.

## Testy

- Backend (`src/routes/review.test.js`): detekce (ignored + reálná kategorie →
  ano; spending účet → ne; income → ne; „Mimo systém"/„Pravidelné platby" → ne;
  interní převod → ne; dismissed → ne); dismiss/undismiss mění viditelnost.

## Verze

Auto-bump patch (pre-commit hook).
