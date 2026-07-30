# Balíček E — Předplacené balíčky (prepaid), design

Datum: 2026-07-30
Stav: návrh k implementaci

## 1. Problém

Uživatel zaplatí jednou částkou balíček služeb, který čerpá postupně bez dalších plateb —
typicky 10 tréninků za 5 000 Kč. Dnes celá částka spadne do měsíce platby a rozbije měsíční
rozpočet kategorie (např. Sport): jeden měsíc masivně přečerpaný, dalších pět měsíců umělé
nuly. Teploměr ani projekce v takovém měsíci nevypovídají o ničem.

**Zadání (potvrzeno uživatelem):**

1. Bolest = **zkreslení měsíce**, ne přehled o zbývajících jednotkách (ten je vedlejší přínos).
2. Rozpouštění **podle skutečného čerpání** — uživatel si absolvovaný trénink odtiká; do měsíce
   spadne přesně tolik jednotek × cena. Ne rovnoměrně po N měsíců.
3. Projeví se **jen v Měsíčních rozpočtech** (teploměry). Schůzka zůstává čistě cash-flow:
   v měsíci platby jednorázový řádek „Nákup předplacených balíčků", dál nic.

## 2. Zvolený model

Vlastní entita mimo `transactions`; čerpání se přičítá k `spent` **výhradně v `GET /api/budgets`**.
Žádné cash-flow místo (stats/overview, Schůzka, Transakce) se nedotýká.

Zvažované alternativy:

- **Virtuální transakce** (čerpání = odvozený řádek v `transactions`): dědí celý engine zdarma,
  ale vyžaduje vyloučit tyhle řádky ze všech cash-flow agregací — tedy sáhnout do bilance, kterou
  uživatel právě ověřoval proti reálným datům. Riziko regrese převážilo přínos.
- **Ruční rozpad platby na N transakcí**: falšuje datum skutečné platby, rozbíjí dedup proti bance,
  neřeší zbývající jednotky. Zamítnuto.

### 2.1 Tok

```
Platba 5 000 Kč (Sport, březen)
   │
   ├─ uživatel označí „Založit předplacený balíček" (10 jednotek, kategorie čerpání = Sport)
   │
   ├─ transakce se přeřadí do technické kategorie `prepaid_purchase` (type=4)
   │     → zmizí z březnového rozpočtu Sport
   │     → v bilanci Schůzky vlastní mínus řádek „Nákup předplacených balíčků" = 5 000
   │
   └─ vznikne prepaid_packages (total 5 000, units 10, unit 500)

Čerpání: tlačítko +1 → prepaid_draws (datum, 1 jednotka, 500 Kč)
   → GET /api/budgets připočte 500 Kč ke `spent` kategorie Sport v období, kam datum spadá
   → teploměr Sport reaguje na spotřebu, ne na platbu
```

Technická kategorie je stejný vzorec jako `fund_topup` z 2026-07-30 — včetně bootstrapu,
ochrany před smazáním a vlastního řádku v bilanci.

## 3. Datový model

Migrace na konci `initSchema()` v `src/db/schema.js` (žádný framework, `try/catch` jako okolí).

```sql
CREATE TABLE IF NOT EXISTS prepaid_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  transaction_id INTEGER,              -- platba, ze které balíček vznikl
  category_id INTEGER NOT NULL,        -- kam se čerpání účtuje (cílová kategorie)
  original_category_id INTEGER,        -- kategorie tx před přeřazením (pro zrušení balíčku)
  name TEXT NOT NULL,
  total_amount REAL NOT NULL,          -- kladné číslo (ABS částky platby)
  units_total REAL NOT NULL,           -- počet jednotek (10 tréninků)
  unit_amount REAL NOT NULL,           -- total_amount / units_total
  valid_until TEXT,                    -- volitelné datum platnosti, jen informativní
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'closed'
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS prepaid_draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  package_id INTEGER NOT NULL,
  date TEXT NOT NULL,                  -- YYYY-MM-DD, den čerpání
  units REAL NOT NULL DEFAULT 1,
  amount REAL NOT NULL,                -- kladné; units × unit_amount, u doúčtování zbytek
  note TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (package_id) REFERENCES prepaid_packages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prepaid_pkg_user ON prepaid_packages(user_id, status);
CREATE INDEX IF NOT EXISTS idx_prepaid_draws_pkg ON prepaid_draws(package_id);
CREATE INDEX IF NOT EXISTS idx_prepaid_draws_date ON prepaid_draws(user_id, date);
```

`unit_amount` i `amount` se ukládají, nedopočítávají za běhu — historická čerpání zůstanou
platná i po případné korekci balíčku a doúčtování zbytku má vlastní částku.

### 3.1 Technická kategorie

Bootstrap v `schema.js` analogicky k `fund_topup` (`src/db/schema.js:435-472`):

- název „Nákup předplacených balíčků", `type=4`, `system_role='prepaid_purchase'`,
  `color='#8b5cf6'`, `icon='Ticket'`
- jen pro uživatele, kteří už mají aspoň jednu kategorii (household: kategorie má jen data owner)
- existující kategorie stejného jména se **povýší** (`UPDATE type=4, system_role=…`) + smažou se
  její záznamy v `budgets`
- idempotentní

## 4. Dopady na stávající kód

| Místo | Změna |
|---|---|
| `GET /api/budgets` (`src/routes/budgets.js:28-35`) | k `spent` přičíst čerpání za období; vracet i `tx_spent` a `prepaid_spent` zvlášť |
| `GET /api/stats/overview` — `accounting` (`src/routes/stats.js:52-63`) | vyloučit `system_role='prepaid_purchase'` ze sekce Účetní (není to převod, saldo nemá být kontrolováno na nulu) |
| `GET /api/stats/overview` | nový agregát `prepaid_purchase: { category_id, name, outflow, tx_count }` pro bilanci |
| `src/utils/fixed-expenses.js:60,71` | guard `COALESCE(c.system_role,'') != 'fund_topup'` zobecnit na `COALESCE(c.system_role,'') = ''` — matcher fixních plateb nesmí chytat žádnou systémovou kategorii |
| `src/routes/categories.js` | ochrana `prepaid_purchase` proti změně typu a smazání (stejná jako u `fund_topup`) |
| `ReportPage.jsx` | nový mínus řádek bilance „Nákup předplacených balíčků" |
| `DashboardPage.jsx` | řádek „z toho předplacené" v kartě kategorie + sekce Předplacené balíčky |

`src/utils/transfer-category.js` už filtruje `system_role IS NULL`, takže třetí systémová `type=4`
kategorie ho nerozbije — ověřit testem, neměnit.

### 4.1 Výpočet `spent` v `/api/budgets`

```sql
COALESCE((
  SELECT SUM(d.amount)
  FROM prepaid_draws d
  JOIN prepaid_packages p ON p.id = d.package_id AND p.user_id = d.user_id
  WHERE d.user_id = db.user_id
    AND p.category_id = db.category_id
    AND d.date >= ? AND d.date <= ?
), 0) as prepaid_spent
```

`spent = tx_spent + prepaid_spent`. Období se bere z `getPeriodDates(billingDay, periodKey)` —
stejné hranice jako transakce, žádný vlastní výpočet dat.

Souhrn „Celkem za období" (`BudgetSummary`) sčítá `b.spent`, takže čerpání zahrne automaticky.

### 4.2 Parita prokliků

Pravidlo „proklik vrátí přesně transakce, ze kterých je součet" nesmí tiše padnout. Proto:

- karta kategorie s nenulovým `prepaid_spent` zobrazí podřádek **„z toho předplacené: 500 Kč"**
- ten vede na `/prepaid?category=<id>&period=<key>` (seznam čerpání za období), **ne** do Transakcí
- proklik na hlavní částku kategorie vede do Transakcí jako dnes a odpovídá `tx_spent`

Součet tedy zůstává rozklikávatelný, jen se dělí na dvě komponenty s vlastními cíli.

## 5. API

Vše `requireAuth`, scope `req.dataUserId`, write endpointy s `writeLimiter`.
Nový router `src/routes/prepaid.js` mountovaný na `/api/prepaid`.

| Metoda | Cesta | Tělo / chování |
|---|---|---|
| GET | `/api/prepaid` | `?status=active\|closed\|all` (default `active`), volitelně `category`, `period`. Vrací balíčky s dopočtem `drawn_units`, `drawn_amount`, `remaining_units`, `remaining_amount`, `last_draw_date` a při `period` i čerpání toho období |
| POST | `/api/prepaid` | `{ transaction_id, name, category_id, units_total, valid_until?, note? }` → ověří vlastnictví tx i kategorie, `total_amount = ABS(tx.amount)`, uloží `original_category_id`, přeřadí tx do `prepaid_purchase` |
| POST | `/api/prepaid/:id/draws` | `{ units = 1, date = dnes, note? }` → `amount = units × unit_amount`; odmítne `units <= 0` a překročení zbývajících jednotek (400) |
| DELETE | `/api/prepaid/draws/:id` | smaže omylem zapsané čerpání |
| POST | `/api/prepaid/:id/close` | `{ write_off: true\|false }` → při `true` založí doúčtovací čerpání na `total_amount − SUM(draws)` s dnešním datem, pak `status='closed'` |
| DELETE | `/api/prepaid/:id` | zruší balíček, vrátí transakci do `original_category_id`, čerpání padnou přes CASCADE |

Validace: `units_total > 0`, `transaction_id` musí patřit uživateli a mít zápornou částku,
`category_id` musí být `type=1` (čerpání dává smysl jen proti měsíčnímu rozpočtu),
`date` ve formátu `YYYY-MM-DD`.

Čistá logika (`remaining`, `amount` čerpání, částka doúčtování) žije v `src/utils/prepaid.js`
jako pure funkce, aby šla testovat bez DB.

## 6. UI

**Založení** — v Transakcích u řádku (inline editace) tlačítko „Založit předplacený balíček":
modal s názvem (předvyplněný z popisu), počtem jednotek, cílovou kategorií (default aktuální
kategorie transakce) a volitelnou platností. Po uložení řádek zešedne s odznakem „balíček".

**Čerpání** — na stránce Měsíční rozpočty (`DashboardPage`) nová sekce **Předplacené balíčky**
se seznamem aktivních: název, kategorie, `zbývá 6 z 10 · 3 000 Kč`, tlačítko **+1** a rozklik na
detail (historie čerpání, smazání čerpání, uzavření balíčku). Tlačítko +1 je hlavní interakce —
musí být na jeden klik bez opuštění stránky.

**Detail / správa** — stránka `/prepaid` (sekce Konfigurace, položka „Předplacené balíčky"):
aktivní i uzavřené, filtr podle kategorie a období, ruční čerpání s vlastním datem a poznámkou.

**Schůzka** — jediná změna je mínus řádek „Nákup předplacených balíčků" v bilanci. Pořadí:
Příjmy → Fixní → Měsíční → Drahé věci → Roční mimo fond → **Nákup předplacených balíčků** →
Nestandardní dobití.

Ikony z katalogu `client/src/categoryIcons.jsx`, texty do `i18n.js` (prefix `prepaid_`).

## 7. Hraniční případy

- **Nedělitelná částka** — `unit_amount = total / units` bez zaokrouhlení; drobný rozdíl se
  srovná při uzavření balíčku, kde se doúčtuje přesný zbytek.
- **Přečerpání** — víc jednotek, než balíček má, se odmítne. Uživatel balíček uzavře a založí nový.
- **Zpětné čerpání** — datum lze zadat do minulého období; čísla toho měsíce se změní. Vědomé,
  je to stejné chování jako ruční přeřazení kategorie transakce.
- **Smazaná platba** — `transaction_id` zůstane NULL, balíček žije dál; detail zobrazí upozornění,
  že zdrojová platba neexistuje.
- **Refundace balíčku** — uživatel balíček smaže, transakce se vrátí do původní kategorie.
- **Nedočerpaný balíček** — nic se neděje automaticky. Bez uzavření zůstane zbytek mimo rozpočty;
  proto detail nabízí „dočerpat zbytek". Automatická expirace se nedělá.
- **Household** — vše přes `req.dataUserId`, balíčky jsou sdílené stejně jako kategorie.

## 8. Testy

- `src/utils/prepaid.test.js` — pure výpočty: zbývající jednotky/částka, částka čerpání,
  doúčtování zbytku, nedělitelná částka.
- `src/routes/prepaid.test.js` — vznik balíčku přeřadí tx do `prepaid_purchase` a uloží původní
  kategorii; ownership (cizí tx i kategorie = 403/404); strop jednotek; uzavření s doúčtováním
  i bez; zrušení balíčku vrátí kategorii.
- `src/routes/budgets.test.js` — čerpání v období zvyšuje `spent`, čerpání mimo období ne;
  nákup balíčku se do `spent` nezapočte; `tx_spent` + `prepaid_spent` dávají `spent`.
- `src/routes/stats.test.js` — `prepaid_purchase.outflow` sedí; kategorie se neobjeví v `accounting`.
- `src/db/schema.test.js` — bootstrap technické kategorie je idempotentní a povýší stejnojmennou.
- `src/utils/transfer-category.test.js` — třetí systémová `type=4` kategorie nerozbije identitu
  kategorie převodů.

## 9. Mimo scope

- Automatická expirace balíčků a notifikace „balíček dochází".
- Rozpouštění na Schůzce (vědomé rozhodnutí — bilance zůstává cash-flow).
- Rozpoznání balíčků při importu z banky.
- Vazba čerpání na subkategorie.
- Rovnoměrné rozpouštění po N měsíců jako alternativní režim.
