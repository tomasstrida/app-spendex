# Automatické zařazení opakujících se plateb podle protiúčtu

**Datum:** 2026-08-19
**Stav:** schváleno uživatelem (design), čeká na implementační plán

## Problém

Automatické zařazení (`categorize()` v `src/services/emailIngest.js`) běží
čistě na textových pravidlech (`category_rules.pattern` proti
description/note/place). U opakujících se plateb, kde se text mění každou
periodu (např. „DPH 2026/07" → „DPH 2026/08", nebo název konkrétní faktury od
klienta), žádné textové pravidlo nikdy nesedí — i když se platba objevuje
pravidelně na stejný protiúčet a uživatel ji pokaždé ručně zařadí do stejné
kategorie. Typicky jde o platby na účtu **Tom-OSVC** a **zz-Hromadné akce**.

Tyhle platby proto trvale visí v review frontě (`email_inbox`, status
`pending`) a čekají na ruční klik, i když je jejich zařazení triviálně
předvídatelné podle čísla protiúčtu.

Požadavek uživatele: rozpoznat vzor podle protiúčtu, nabídnout založení
pravidla ke schválení, a po schválení nechat budoucí platby zařazovat
automaticky — s tím, že o auto-zařazení se uživatel dozví jen přes stávající
informační notifikaci (žádná nová výjimka v notifikačním chování).

## Řešení

Rozšíření `category_rules` o matchování podle **čísla protiúčtu** (stejný
princip jako dnešní `fixed_expenses.match_counterparty_account` /
`income_sources.match_counterparty_account` — plné číslo účtu, exact match),
vedle stávajícího textového `pattern`. Detekce kandidátů reuse-uje scoring
(coverage + purity) z `scripts/suggest-rules-from-history.cjs`, ale klíčovaný
přes `counterparty_account` místo prefixu textu description. Návrhy se
uživateli nabízí na dvou místech se sdíleným zdrojem dat: inline banner v
review frontě (reaktivně, hned po ručním zařazení) a sekce na stránce
Pravidla (dávkově, na vyžádání nad celou historií).

Zvažovaná alternativa: samostatná tabulka „counterparty rules" mimo
`category_rules` — zamítnuto, zbytečně duplikuje CRUD/UI/`load-user-rules.js`
infrastrukturu, kterou `category_rules` už má.

## 1. Datový model

Migrace na konec `initSchema()` v `src/db/schema.js` (`ALTER TABLE` v
try/catch bloku, jako obvykle):

- `category_rules.match_counterparty_account TEXT` — `NULL` = pravidlo
  matchuje jen textem jako dnes.
- `category_rules.match_account_id INTEGER` — volitelné omezení jen na
  konkrétní vlastní účet (FK `accounts.id`), pro případy kdy stejný protiúčet
  znamená jinou věc na jiném vlastním účtu. `NULL` = bez omezení.

Pravidlo je platné, pokud má vyplněné `pattern` NEBO
`match_counterparty_account` (nebo obojí zároveň — pak platí AND, pro extra
přesnost). Existující řádky (`match_counterparty_account IS NULL`) se chovají
beze změny.

Nová tabulka `rule_suggestions`:

```sql
CREATE TABLE rule_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  counterparty_account TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  subcategory_id INTEGER,
  coverage_count INTEGER NOT NULL,
  purity REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|dismissed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
)
```

`UNIQUE(user_id, counterparty_account)` — nechceme duplicitní návrhy pro
stejný protiúčet; opakovaná detekce nad stejným protiúčtem existující řádek
jen aktualizuje (`coverage_count`/`purity`), pokud je stále `pending`.

## 2. Candidate finder (`src/utils/counterparty-rule-candidates.js`)

Nová sdílená funkce `findCounterpartyRuleCandidates(db, userId, {onlyCounterpartyAccount?})`:

- Vstup: historicky zařazené transakce (`transactions` s `counterparty_account
  IS NOT NULL`), volitelně omezené na jeden konkrétní protiúčet (pro reaktivní
  trigger po jedné platbě — levnější než scan celé historie).
- Seskupí podle `counterparty_account`, spočítá `coverage` (počet tx) a
  `purity` (podíl nejčastější `category_id`).
- Filtr: `coverage >= 3`, `purity >= 0.90` (stejné výchozí prahy jako
  `suggest-rules-from-history.cjs`).
- Vynechá protiúčty, které:
  - už mají existující pravidlo s `match_counterparty_account` rovným tomuto
    číslu,
  - odpovídají L0 identitě (vlastní účty — interní převody se řeší jinde,
    nemá smysl nabízet pravidlo),
  - mají `rule_suggestions` řádek ve stavu `approved` nebo `dismissed`.
- Vrací pole kandidátů `{counterparty_account, category_id, subcategory_id, coverage_count, purity}`.

Tahle funkce se volá ze dvou míst (bod 3 a 4) — žádná duplicitní logika.

## 3. Reaktivní trigger

`POST /api/email-inbox/:id/approve` (`src/routes/emailInbox.js`) po zapsání
transakce zavolá `findCounterpartyRuleCandidates(db, userId,
{onlyCounterpartyAccount: tx.counterparty_account})`. Pokud vrátí kandidáta a
neexistuje pro něj ještě `rule_suggestions` řádek, vytvoří ho (`status:
'pending'`) a vrátí ho v response endpointu jako `newSuggestion`.

Frontend (`ImportPage.jsx`) po úspěšném `approve()` zkontroluje response —
pokud obsahuje `newSuggestion`, zobrazí inline banner:

> „Tahle platba (protiúčet …) se opakuje potřetí a pokaždé jde do kategorie
> **X**. Založit pravidlo, aby se příště zařadila automaticky?"
> [Založit] [Ne, díky]

Tlačítka volají endpointy z bodu 5.

## 4. Dávkový trigger (stránka Pravidla)

Nová sekce „Návrhy" na `RulesPage.jsx`:

- `GET /api/rules/suggestions` — vrací `rule_suggestions` se `status='pending'`
  pro přihlášeného uživatele (join na `categories`/`accounts` pro čitelný
  název kategorie a příp. protistrany).
- Karta: „Protiúčet … → kategorie X (N plateb, purity Y %)" + tlačítka
  Založit/Zamítnout.
- Tlačítko „Zkontrolovat historii" volá
  `POST /api/rules/suggestions/scan` → spustí
  `findCounterpartyRuleCandidates(db, userId)` nad celou historií (bez
  omezení na jeden protiúčet) a uloží nové kandidáty. Pokrývá vzory, které
  existovaly už před nasazením této featury, nebo které uživatel v
  reaktivním flow přehlédl.

## 5. Schválení / zamítnutí

- `POST /api/rules/suggestions/:id/approve` — ownership check
  (`user_id`), vytvoří `category_rules` řádek s
  `match_counterparty_account = suggestion.counterparty_account`,
  `category_id`, `subcategory_id` (pokud je), označí suggestion `status =
  'approved'`, `resolved_at = now`.
- `POST /api/rules/suggestions/:id/dismiss` — `status = 'dismissed'`,
  `resolved_at = now`. Trvalé zamítnutí, žádné opětovné navrhování pro stejný
  protiúčet (YAGNI — bez re-prompt logiky při rostoucím coverage).

## 6. Downstream — routing a notifikace

Žádná změna v `apply-rules.js` mimo novou podmínku z bodu 1 a žádná změna v
`emailIngest.js`/`pushNotify.js`: jakmile `category_rules` obsahuje řádek s
`match_counterparty_account`, `applyRules()` ho najde stejně jako dnešní
textová pravidla → `confident = true` → platba jde rovnou do `transactions`
(`status: imported`), review fronta se nepoužije.

Notifikace beží podle **existujícího** `notify_scope` nastavení beze změny
(potvrzeno uživatelem) — při defaultu `pending_only` žádná zpráva, při `all`
stávající šablona `✅ … → Kategorie`.

`recategorizePending()` (`emailIngest.js`) beze změny přeřadí staré `pending`
položky se stejným protiúčtem po schválení pravidla, protože jede přes
stejnou `applyRules` logiku.

## 7. Edge cases

- **Chybějící protiúčet** (karetní platba bez `counterparty_account`) — mimo
  scope téhle featury, řeší dál jen textová pravidla /
  `suggest-rules-from-history.cjs`.
- **Nekonzistentní kategorizace na stejném protiúčtu** (purity < 90 %,
  typicky zz-Hromadné akce s různorodými platbami) — žádný návrh, žádný spam.
- **OSVČ účet mimo scope měsíčních reportů** — feature nijak nerozlišuje
  „scope" účtu, řeší jen aby transakce nevisela v review frontě; kategorie
  může být klidně mimo běžný report scope.
- **Duplicitní scan** (dávkový scan najde protiúčet, který mezitím vznikl i
  reaktivně) — `UNIQUE(user_id, counterparty_account)` zabrání duplicitě,
  scan dělá `INSERT OR IGNORE`/update jen pokud je stále `pending`.

## 8. Testy

- `src/utils/apply-rules.test.js` — nová podmínka `match_counterparty_account`
  samotná, v kombinaci s `pattern` (AND), v kombinaci s `match_account_id`.
- `src/utils/counterparty-rule-candidates.test.js` — coverage/purity scoring
  nad fixture daty, včetně negativního případu (purity < 90 %) a vynechání
  protiúčtů s existujícím pravidlem/vyřešeným návrhem.
- `src/routes/rule-suggestions.test.js` — ownership, `approve` vytvoří
  správný `category_rules` řádek, `dismiss` nastaví status, `scan` neduplikuje.
- Integrační test: pending položka → `approve` s counterparty pravidlem →
  `recategorizePending()` přeřadí historické pending položky se stejným
  protiúčtem do `transactions`.

## Mimo scope (vědomě)

- Žádná plná statistická detekce (frekvence/interval/variance částky) —
  jen coverage+purity podle protiúčtu, jako u textových pravidel dnes.
- Žádná speciální notifikační výjimka pro recurring auto-zařazení.
- Žádné re-navrhování po zamítnutí.
