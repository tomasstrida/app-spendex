# Spendex – čistý rebuild dat (config-as-code)

**Datum:** 2026-05-16
**Stav:** návrh ke schválení
**Kontext:** Po dvou ad-hoc importech se data rozsypala (paralelní taxonomie kategorií,
sémanticky špatná AB→kategorie mapování, příjmy smíchané s výdaji). Příčina: neexistuje
verzovaný zdroj pravdy pro taxonomii a pravidla. Tento rebuild zavádí konfiguraci jako
kód, deterministický a idempotentní wipe+seed+import.

## 1. Cíl a princip

Jednorázově (a opakovatelně) přestavět produkční DB z **verzované konfigurace** tak, aby:

- existovala jedna kanonická taxonomie kategorií,
- kategorizace transakcí běžela přes explicitní, reviewovatelný 3vrstvý systém pravidel
  (+ vrstva 0 pro interní převody),
- pečlivě nastavená čísla (budgety, fixní výdaje, roční okna, příjmy) byla zachycena
  v configu a deterministicky obnovena (ne ztracena),
- import byl idempotentní a použitelný i pro budoucí měsíční importy bez znovu-rozsypání.

Schválený přístup: **config-as-code seed + idempotentní `rebuild.cjs` CLI**.

## 2. Architektura a struktura souborů

```
scripts/
  seed/
    categories.js     – 23 kategorií (name, type 1/2/3)
    accounts.js        – 10 účtů (account_number, name, role)
    budgets.js         – default budgety (category name → částka)
    fixed-expenses.js  – 8 fixních výdajů (name, amount, sort_order)
    annual.js          – annual_budgets + budget_items (s časovými okny)
    income.js          – 4 ruční příjmy (person, amount, period)
    rules.js           – L2 abCategoryMap{}, L3 textOverrides[], L1 accountRules[],
                          L0 ownAccountNumbers[]
  rebuild.cjs          – orchestrátor (CLI)
  lib/
    apply-rules.js     – čistá funkce (tx, účet, rules) → category name; testovatelná bez DB
```

`apply-rules.js` je izolovaná čistá funkce – jednotkově testovatelná samostatně.

## 3. Kanonická taxonomie (23 kategorií)

Typy: **1** = měsíční budget · **2** = roční/sezónní · **3** = fond „drahé věci".

| # | Kategorie | Typ | Budget / pozn. |
|---|---|---|---|
| 1 | Jídlo a běžné nákupy | 1 | 20000 |
| 2 | Auto Moto - PHM | 1 | 8500 |
| 3 | Sport | 1 | 1200 |
| 4 | Nákupy bydlení | 1 | 1000 |
| 5 | Oblečení | 1 | 3000 |
| 6 | Zábava | 1 | 4500 |
| 7 | Restaurace a kávičky | 1 | 10000 |
| 8 | Dárky | 1 | 1000 |
| 9 | Beauty | 1 | 3000 |
| 10 | Terapie | 1 | 3000 |
| 11 | Y - Lítačka | 2 | items: Tom 3650 (měs 4–5), Martin 3650 (8–9) |
| 12 | Y - Auto Moto - Servis | 2 | roční 30000 |
| 13 | Y - Tom cvíčo | 2 | roční 33000 |
| 14 | Licence | 1 | 6000 |
| 15 | Tom osobní | 1 | 1000 |
| 16 | Martin osobní | 1 | 1000 |
| 17 | Y - Beach volejbal | 2 | items: léto 10500 (5–9), zima 21000 (9–12) |
| 18 | Y - Léky, PrEP, Optika | 2 | roční 20000 *(přesun z Lékárny)* |
| 19 | Drahé věci | 1 | 0 |
| 20 | Ostatní | 1 | — (fallback) |
| 21 | Příjmy | 1 | — (vyloučena z výdajových budgetů; je příjem) |
| 22 | Převody | 1 | — (vyloučena z budgetů i z příjmů) |
| 23 | Fixní platby | 1 | — (bez budgetu = mimo měsíční budgety; dočasný domov pro AB „Pravidelne mesicni", než vznikne tracker) |

Změny oproti původní sadě 22: zrušeno **Lékárna** (drobné → Jídlo, dražší zdraví →
Y-Léky/PrEP) a **Pojistky**; **Beach a Tom cvíčo** (t1) → **Y - Tom cvíčo** (t2);
**Y - Auto Moto - Servis** t1→t2; přidáno **Příjmy**, **Převody**, **Fixní platby**.

**Otevřené k reviewu specu:**
- Název „Fixní platby" (uživatel odmítl „Pravidelné platby") – finalizovat.
- Sladění názvů ve `fixed_expenses` („Y - Pojistky 600", „Y - Beach a cvíčo 3800")
  s novou taxonomií – fixní výdaje jsou nezávislé na kategoriích, ale názvy matou.

## 4. Systém pravidel kategorizace

**Precedence (nejsilnější → nejslabší):**
`L0 Převody → L3 text-override → L1 účet → L2 AB-kategorie → fallback „Ostatní"`

### L0 – Interní převod (nejvyšší priorita)
Pokud číselný prefix `counterparty_account` ∈ množina 10 vlastních čísel účtů
→ kategorie **Převody**. Přebíjí vše. Důvod: ověřeno, že 202/1012 transakcí jsou
interní převody rozprostřené přes mnoho AB kategorií (Příchozí úhrada 101, Cizí 68,
Sport 7, …); detekce nesmí záviset na AB kategorii. Vyloučeno z výdajů i příjmů.

Vlastní účty: 1679014015, 1679014023, 1679014031, 1679014058, 1679014066,
1679014074, 1679014082, 1679014103, 1679014111, 1679014138.

### L1 – Pravidla podle účtu
- Účet **Licence** (1679014111, spending) → kategorie **Licence**.
- Účty role `fixed` (Harmonicka-najem) a `ignored` (Tom-OSVC, Tom-AirBank, Hlavní,
  Spořicí-účet-1, Dane-doplatek) se nezapočítávají do měsíčních budgetů (filtr dle
  role účtu); kategorie přiřazena kosmeticky přes L2.

### L2 – AB kategorie → Spendex kategorie
```
Jídlo, Nakupy Jidlo, Lékárna, Nákupy           → Jídlo a běžné nákupy
Restaurace                                      → Restaurace a kávičky
Doprava                                         → Auto Moto - PHM
Sport                                           → Sport
Zábava                                          → Zábava
Bydlení                                         → Nákupy bydlení
Licence Apple apod                              → Licence
Drahe-veci                                      → Drahé věci
Zdravotní, Terapie                              → Terapie
Služby                                          → Beauty
Dárky                                           → Dárky
Tom osobni                                      → Tom osobní
Pravidelne mesicni                              → Fixní platby (mimo budget)
Pojištění, Sociální, Splátky, Výběr hotovosti,
  OSVC, Nezařazeno, Vzdelavani                  → Ostatní
Příchozí úhrada                                 → Příjmy (jen externí; interní → L0)
```

### L3 – Text-override (přebíjí účet i AB)
```
MAX FITNESS / MAXFITNESS     → Sport
PIDLitacka / PID Litacka     → Y - Lítačka
Klinika Infekcnich / PrEP    → Y - Léky, PrEP, Optika
ROHLIK / ROHLÍK              → Jídlo a běžné nákupy
```
Routing ročních z účtu „Nepravidelné" (servis/brýle) se doladí přidáním pár
text-override pravidel po prvním importu dle reálných protistran (návrh to umožňuje).

Persistování: L2 → tabulka `airbank_category_mappings` (využije i AirBank sync v appce),
L3 → `category_rules`. L0 a L1 jsou import-time logika v `apply-rules.js`.

## 5. Tok rebuildu

`node scripts/rebuild.cjs` — env `DB_PATH`, `CSV_DIR`, `DRY_RUN` (default `1`), `CONFIRM`.

1. **Záloha:** `VACUUM INTO /data/backup-rebuild-<ts>.db` (WAL-safe konzistentní kopie);
   ověření počtu řádků v záloze.
2. **Jedna transakce (atomicky):**
   - DELETE v FK-bezpečném pořadí: `budget_items` → `annual_budgets` → `budgets` →
     `category_rules` → `airbank_category_mappings` → `transactions` →
     `fixed_expenses` → `income` → `accounts` → `categories`.
   - Seed z `seed/*`: categories(23) → accounts(10) → budgets → fixed_expenses →
     annual_budgets+budget_items → income → L2 do `airbank_category_mappings`,
     L3 do `category_rules`.
   - Import CSV: pro každý účet (dle čísla v názvu souboru) parse přes
     `parseAirBankCSV`; pro každou tx `apply-rules` (L0→L3→fallback) určí kategorii;
     INSERT s `external_id` rozlišeným per účet (`<ref>-<účet>`), aby interní převody
     (obě nohy) neselhaly na `UNIQUE(user_id, external_id)`.
3. **Verifikace:** počty (categories=23, accounts=10, transactions≈1012, fixed=8,
   income=4); Σ příjmy / Σ výdaje / net; počet Převodů ≈202; budgety se spent per
   období; nezkategorizované mimo „Ostatní" ≈0; 0 tx s mrtvým `category_id`;
   porovnání net vs CSV inventory.
4. Bez `CONFIRM=1` → ROLLBACK + tisk reportu (dry-run je default). S `CONFIRM=1`
   → COMMIT.

Idempotence: wipe+seed je deterministický, skript je bezpečně re-runnable a
použitelný i pro budoucí měsíční importy s čerstvým CSV. Předpoklad: `UNIQUE INDEX
idx_categories_user_name` (již nasazen v prod) zaručuje, že seed kategorií nevytvoří
duplicity.

## 6. Zachovaná kurátorská data (do seed configu verbatim)

- **budgets.js** – default částky dle tabulky v sekci 3.
- **fixed-expenses.js** – 8 položek: Y - Léky optika 4000, Y - Lítačka 600,
  Y - Servis auto moto 2500, Y - Beach a cvíčo 3800, Y - Pojistky 600, Y - Licence 6000,
  Nájem + zálohy Stodola 45000, Spoření 25000. *(Pozn.: měsíční rezervy, nezávislé na
  category_id; sladění názvů viz sekce 3 – open.)*
- **annual.js** – annual_budgets: Y - Léky, PrEP, Optika 20000 (přesun z Lékárny),
  Y - Auto Moto - Servis 30000, Y - Tom cvíčo 33000. budget_items: Lítačka Tom 3650
  (4–5), Lítačka Martin 3650 (8–9), Beach léto 2026 10500 (5–9), Beach zima 2026
  21000 (9–12). *(Roční budget na Lékárně zrušen – přesunut na Y-Léky/PrEP/Optika.)*
- **income.js** – 4 příjmy verbatim: Martin 23000 (2026-02), Společně 156000
  (2026-01), Sudo 21000 (2026-02), Tom 126000 (2026-02).

## 7. Testování a verifikace

- **Jednotkové (TDD red-green) na `lib/apply-rules.js`:** precedence L0–L3 + fallback;
  detekce interního převodu (counterparty ∈ vlastní účty) přebíjí AB i text;
  override MAX FITNESS→Sport, PIDLitacka→Y-Lítačka, Klinika/PrEP→Y-Léky/PrEP;
  účetní pravidlo Licence; neznámá AB → Ostatní.
- **Integrační dry-run:** `rebuild.cjs` s `DRY_RUN=1` na VACUUM-kopii prod DB;
  ověřit počty, net vs CSV inventory, 0 nezkategorizovaných mimo Ostatní,
  0 mrtvých FK – až poté `CONFIRM=1` na ostro.
- Záloha `backup-rebuild-<ts>.db` umožní rollback.

## 8. Mimo rozsah (samostatné follow-up specy)

- **Tracker pravidelných plateb:** samostatná sekce zobrazující každou pravidelnou
  měsíční platbu zvlášť („proběhla tento měsíc?"). Zatím AB „Pravidelne mesicni"
  → kategorie „Fixní platby" (bez budgetu).
- **Admin rozhraní pro editaci párování:** UI pro doplňování/zpřesňování pravidel
  (L1–L3) bez zásahu do kódu.

## 9. Rizika

- **Ztráta dat při wipe:** mitigace = VACUUM záloha + dry-run default + atomická
  transakce.
- **Neúplné/nepřesné mapování:** část AB kategorií je hrubá; L3 overrides se doladí
  iterativně po prvním importu (návrh to umožňuje bez schématických změn).
- **Drift názvů fixed_expenses vs taxonomie:** kosmetické, k vyřešení v reviewu.
- **Budoucí měsíční CSV:** skript je idempotentní, ale nový export musí pokrývat
  všech 10 účtů; chybějící účet = chybějící data (verifikace počtů to odhalí).
