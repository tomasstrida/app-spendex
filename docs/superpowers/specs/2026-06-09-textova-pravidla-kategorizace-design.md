# Textová pravidla kategorizace — konfigurace v aplikaci

**Datum:** 2026-06-09
**Stav:** schváleno k implementaci

## Problém

Auto-kategorizace transakcí je čistě rule-based (žádná sémantika). Textové
patterny (`textOverrides`) jsou dnes **zadrátované** ve statickém souboru
`scripts/seed/rules.js` — jediná cesta ke změně je úprava kódu a deploy.

Navíc e-mailové notifikace AirBank **neobsahují AB kategorii** (`ab_category: ''`),
takže u nich odpadá vrstva L2. Pokud obchodník není v textových patternech,
platba vždy spadne na fallback „Ostatní" (např. „Restaurace U Houdku" → Ostatní,
protože žádný pattern „restaurace" neexistuje).

Cíl: umožnit uživateli spravovat textová pravidla (které texty → která kategorie)
přímo v aplikaci, bez zásahu do kódu.

## Současný stav (kontext)

- `apply-rules.js` — čistá funkce `applyRules(tx, account, rules)`, precedence:
  **L0 Převody → L3 textOverrides → L1 účet → L2 AB kategorie → fallback**.
  Pattern se hledá case-insensitive jako substring v `description + note + place`.
- `textOverrides` se runtime berou **jen ze seedu** (`scripts/seed/rules.js`):
  - `emailIngest.js` → `applyRules(tx, account, seedRules)`
  - `import.js` (CSV) → `applyRules(t, account, effectiveRules)`, kde
    `effectiveRules = { ...seedRules, abCategoryMap: seed + DB airbank_category_mappings }`
    (tj. AB mapping už dnes mixuje seed + DB, ale textOverrides ne).
- Tabulka `category_rules (id, user_id, category_id, pattern, created_at)` v DB
  **existuje, ale runtime se nikde nečte** — jen `rebuild.cjs` do ní seeduje.
- `airbank_category_mappings` má plný CRUD (`import.js`) — vzor pro UI/endpointy.
- Výchozí kategorie se **neauto-seedují** při registraci; tvoří se ručně
  (`categories.js` POST). Na prod má Tom/Martin kategorie už nasazené.

## Rozhodnutí (z brainstormingu)

1. **Jeden zdroj pravdy = DB.** Seed patterny se jednorázově migrují do
   `category_rules`; runtime pak textové patterny čte jen z DB.
2. **Umístění UI = samostatná stránka „Pravidla".** (Později může pojmout
   i AB-kategorie mapping, který dnes nemá žádné UI — mimo scope teď.)
3. **Aplikace jen na nové transakce.** Žádné dávkové přeštítkování existujících.
   (Případné tlačítko „aplikovat na existující" je budoucí přírůstek.)

## Návrh

### 1. Datový model

Rozšířit `category_rules` o dva nullable sloupce (parita se seedem — benzinky <200):

```sql
ALTER TABLE category_rules ADD COLUMN amount_max_abs REAL;  -- pravidlo platí jen když ABS(amount) <= X
ALTER TABLE category_rules ADD COLUMN amount_min_abs REAL;  -- ... a/nebo >= Y
```

(Přidat do `initSchema()` v `try/catch` jako stávající migrace.)

`pattern` = substring v `description + note + place`, case-insensitive (beze změny
chování). Bez `priority` sloupce — pořadí řeší řazení v helperu.

### 2. Backend — kategorizace čte z DB

Nový helper `src/utils/load-user-rules.js`:

```
loadUserRules(db, userId) → { ...textOverrides pole }
```
- SELECT z `category_rules` JOIN `categories` (název kategorie pro `category`).
- **Řazení:** pravidla s `amount_max_abs` nebo `amount_min_abs` NOT NULL první
  (specifičtější = benzinky), poté ostatní; v rámci skupiny `id ASC`.
  → zachová dnešní precedenci „specifičtější výjimka před generickým patternem"
  bez explicitního priority sloupce.
- Vrací pole tvaru `[{ pattern, category, amount_max_abs?, amount_min_abs? }]`
  kompatibilní s tím, co `applyRules` očekává v `rules.textOverrides`.

Napojení:
- `emailIngest.js`: místo `seedRules` sestavit `rules` objekt s
  `textOverrides: loadUserRules(db, userId)` (ostatní vrstvy ze seedu beze změny).
- `import.js`: `effectiveRules.textOverrides = loadUserRules(db, userId)`
  (AB mapping mix zůstává).
- `apply-rules.js` **se nemění** — pořád bere `rules.textOverrides` z parametru.

### 3. Migrace / seed existujících uživatelů

V `schema.js` (po vytvoření tabulky) idempotentní krok při startu:
- Pro každého `user_id`, který **nemá žádný** záznam v `category_rules`:
  projdi `seedRules.textOverrides`, pro každé pravidlo najdi `category_id`
  podle jména kategorie u daného uživatele; existuje-li, vlož
  `(user_id, category_id, pattern, amount_max_abs, amount_min_abs)`.
  Pravidlo na neexistující kategorii přeskoč.
- Idempotentní: běží jen když je uživatelova sada `category_rules` prázdná.

Seed soubor `scripts/seed/rules.js` zůstává jako zdroj migrace; runtime ho pro
textové patterny už nečte (L0/L1/L2/fallback konstanty se z něj nadále berou).

### 4. CRUD endpointy

Nový router `src/routes/rules.js`, mount `/api/rules`, vše scoped na
`req.dataUserId` (household-aware), za `requireAuth`:

- `GET /api/rules` → seznam pravidel + `category_name`, `category_color`.
- `POST /api/rules` → `{ pattern, category_id, amount_max_abs?, amount_min_abs? }`.
  Validace: `pattern` neprázdný (trim), `category_id` patří uživateli.
- `PATCH /api/rules/:id` → úprava (ownership check `WHERE id=? AND user_id=?`).
- `DELETE /api/rules/:id` → smazání (ownership check).

### 5. Frontend — stránka „Pravidla"

- Nová routa + položka v menu/Sidebaru.
- Tabulka/seznam pravidel: **pattern → kategorie** (chip s barvou kategorie).
- Formulář přidat/upravit: textové pole pattern, select kategorie; sbalené
  „pokročilé" pole pro `amount_max_abs` / `amount_min_abs` („jen do částky" /
  „od částky") — kvůli benzinkám, většina pravidel ho nepoužije.
- Inline úprava/smazání.
- Nápověda: „Pravidlo se uplatní na nově importované platby."
- i18n texty do `i18n.js`.

### 6. Testy

- `apply-rules.test.js` — beze změny (funkce se nemění), případně doplnit, že
  textOverrides z DB fungují stejně.
- `load-user-rules.test.js` (nové) — řazení (amount podmínky první), mapování
  jména kategorie → category_id, vynechání pravidel na neexistující kategorii.
- `rules.security.test.js` / isolation — ownership a household izolace CRUD.
- Idempotence seed migrace — opakovaný start nevytvoří duplicity.

## Mimo scope (vědomě)

- Dávkové přeštítkování existujících transakcí (jen nové).
- Priority/drag-and-drop pořadí pravidel (řeší heuristické řazení).
- UI pro AB-kategorie mapping (samostatná budoucí položka na téže stránce).
- Diakritika-insensitive match (zůstává case-insensitive; banka posílá ASCII
  uppercase, takže to v praxi stačí).

## Dotčené soubory

- `src/db/schema.js` — ALTER + seed migrace
- `src/utils/load-user-rules.js` — nový helper
- `src/services/emailIngest.js`, `src/routes/import.js` — napojení helperu
- `src/routes/rules.js` — nový router
- `src/index.js` — mount routeru
- `client/src/pages/RulesPage.jsx` — nová stránka
- `client/src/App.jsx`, `client/src/components/Sidebar*` — routa + menu
- `client/src/i18n.js` — texty
- testy výše
