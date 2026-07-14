# B-2 Licence subkategorie

**Datum:** 2026-07-14
**Stav:** Design – čeká na schválení uživatelem
**Zdroj:** Spendex backlog 13.7.2026, položka „Licence rozdělíme do subkategorií"
**Balíček:** B (přepracování modelu kategorií), dílčí featura B-2

## Kontext

Dnes je „Licence" jedna plochá kategorie (Typ 1), kam textová pravidla řadí
platby (OPENAI, Google Workspace…). Uživatel chce vidět **rozpad** na jednotlivé
služby (ChatGPT, Claude, Anthropic API, Railway, CloudFlare, WEDOS, Ostatní),
aniž by Licence přestala být jedna kategorie.

Po brainstormingu (volba „oddělené subsystémy" v balíčku B): **žádná globální
parent_id hierarchie.** Subkategorie je lehký, lokalizovaný koncept –
`transactions` dostane vazbu na číselník subkategorií, plněný textovými pravidly.

## Rozhodnutí z brainstormingu

1. **Plnění:** rozšířit stávající textová pravidla (`category_rules`) o volitelnou
   subkategorii – pravidlo řekne kategorie + subkategorie najednou
   (OPENAI → Licence / ChatGPT).
2. **Definice subkategorií:** pevný **spravovaný číselník** (tabulka
   `subcategories`, per kategorie), dropdown jen z definovaných. Ne volný text.
3. **Zobrazení rozpadu:** na **Schůzce**, v **Měsíčních rozpočtech** i v
   **Transakcích** (sloupec + filtr).
4. **Retroaktivní naplnění:** ano – migrační skript doplní subkategorii do
   historických plateb podle pravidel (aditivní, dry-run → CONFIRM).

## Rozsah

### 1. Schema (`src/db/schema.js`)

Nová tabulka + dva sloupce (migrace na konec `initSchema()`):

```sql
CREATE TABLE IF NOT EXISTS subcategories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);
-- unikátní název subkategorie v rámci kategorie
CREATE UNIQUE INDEX IF NOT EXISTS idx_subcat_user_cat_name
  ON subcategories(user_id, category_id, name);
```

```sql
ALTER TABLE transactions ADD COLUMN subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE SET NULL;
ALTER TABLE category_rules ADD COLUMN subcategory_id INTEGER REFERENCES subcategories(id) ON DELETE SET NULL;
```

**Volba FK (ne text):** `transactions.subcategory_id` je FK na `subcategories.id`
– přejmenování subkategorie se propíše, smazání subkategorie nuluje vazbu
(`ON DELETE SET NULL`), konzistentní s číselníkem.

### 2. Kategorizační engine (`src/utils/apply-rules.js`, `load-user-rules.js`)

- `loadUserRules` přidá do textOverride objektu `subcategory_id` (JOIN nebo přímý
  sloupec z `category_rules`).
- **`applyRules` změní návratovou hodnotu** ze stringu na objekt
  `{ category, subcategory_id }`:
  - matchne-li L3 textové pravidlo se `subcategory_id`, vrátí ho;
  - ostatní vrstvy (L0 převod, L1 účet, L2 AB, fallback) → `subcategory_id: null`.
- **Dva konzumenti** se upraví (`import.js:149`, `emailIngest.js:24`): místo
  `const catName = applyRules(...)` → `const { category, subcategory_id } =
  applyRules(...)`, a `subcategory_id` se uloží do `transactions` při insertu.

### 3. Číselník subkategorií – CRUD

- Backend: nová route `src/routes/subcategories.js` – `GET /?category_id=`,
  `POST`, `PATCH /:id`, `DELETE /:id` (ownership přes `dataUserId`, validace
  názvu, writeLimiter).
- **Správa v UI:** na stránce **Kategorie** (`CategoriesPage.jsx`) – u kategorie
  akce „Subkategorie" → modal/sekce se seznamem + přidání/přejmenování/smazání.
  (Potvrzeno uživatelem 2026-07-14: správa na stránce Kategorie, subkategorie
  logicky patří ke kategorii.)

### 4. Pravidla – pole subkategorie (`src/routes/rules.js`, `RulesPage.jsx`)

- Route POST/PATCH přijmou volitelné `subcategory_id`.
- UI: ve formuláři pravidla dropdown „Subkategorie" – nabídne subkategorie
  **vybrané kategorie** (prázdné, dokud kategorie nemá subkategorie). Volitelné.

### 5. Transakce (`TransactionsPage.jsx`, `src/routes/transactions.js`)

- Nový sloupec **„Subkategorie"** (default skrytý, jako `counterparty_account`).
- Ruční editace: v editaci transakce dropdown subkategorií kategorie transakce
  (+ prázdná volba). PATCH přijme `subcategory_id`.
- **Filtr:** možnost filtrovat podle subkategorie (rozšíření stávajícího filtru).
- Backend `transactions` GET vrací `subcategory_id` + `subcategory_name` (JOIN).

### 6. Rozpad v přehledech

- **Stats** (`src/routes/stats.js`): pro kategorie se subkategoriemi vrátit
  rozpad `by_subcategory` (název + `SUM(-amount)`) v období.
- **Schůzka** (`ReportPage.jsx`): řádek kategorie se subkategoriemi (Licence)
  půjde rozkliknout → rozpad subkategorií (ChatGPT 420 / Claude 500 / … / celkem).
- **Měsíční rozpočty** (`DashboardPage.jsx`): pod teploměrem kategorie se
  subkategoriemi rozpad subkategorií.

### 7. Retroaktivní migrace

Skript `scripts/migrate-subcategories.cjs` (vzor stávajících migrací):
- dry-run default, `CONFIRM=1` zapíše;
- projde transakce v kategoriích, které mají subkategorie, aplikuje textová
  pravidla se `subcategory_id`, doplní `transactions.subcategory_id` **jen kde je
  dnes NULL** (aditivní, nemaže);
- prod spuštění přes `railway ssh` po explicitním potvrzení uživatelem.

## Datová konfigurace (mimo mechanismus)

Uživatel po nasazení: založí subkategorie Licence (ChatGPT, Claude, Anthropic
API, Railway, CloudFlare, WEDOS, Ostatní) v číselníku a přiřadí je pravidlům
(OPENAI → ChatGPT, ANTHROPIC/CLAUDE → Claude/Anthropic API, RAILWAY → Railway,
CLOUDFLARE → CloudFlare, WEDOS → WEDOS). Pak spustí retroaktivní migraci.

## Non-goals (mimo B-2)

- **Apple rozklíčování** (balíček D): platby přes Apple (APPLE.COM/BILL) jsou
  agregát více služeb → subkategorii nelze jednoznačně určit z popisu. Rozklíčení
  podle času+částky z Apple e-mailu řeší balíček D. V B-2 dostanou Apple platby
  subkategorii jen pokud na ně sedne pravidlo (jinak zůstanou bez subkategorie).
- Subkategorie pro jiné kategorie než Licence (mechanismus je obecný, ale
  zavádí se pro Licence; jiné kategorie si uživatel může přidat stejně).
- Globální parent_id hierarchie kategorií (vyloučeno v balíčku B).
- Rozpočty na úrovni subkategorie (subkategorie je jen analytický rozpad, ne
  vlastní budget).

## Testy

- `apply-rules.test.js`: applyRules vrací `{category, subcategory_id}`; L3
  pravidlo se subcategory → vrátí id; ostatní vrstvy → null.
- `subcategories` route test: CRUD + ownership + unikátní název v kategorii.
- `rules` route test: přijme/uloží `subcategory_id`.
- stats rozpad `by_subcategory`.
- Migrace skript: dry-run nezapisuje; doplní jen NULL; nemaže existující.

## Nasazení

Commit + push do `staging` (Railway staging), po vizuální kontrole na pokyn
merge `staging` → `main`. Retroaktivní migraci na prod spustit až po nasazení
kódu, s explicitním potvrzením. Hlásit verzi.
