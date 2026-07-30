# Design: Roční kategorie (typ 2) v měsíční bilanci Schůzky

**Datum:** 2026-07-30
**Stav:** čeká na review uživatele
**Kontext:** `client/src/pages/ReportPage.jsx` (bilanční sekce), `client/src/utils/meetingBalance.js`, `client/src/pages/SavingsPage.jsx`, `src/routes/stats.js`, `src/utils/fixed-expenses.js`, `src/db/schema.js`.

## Problém

Bilance Schůzky = Příjmy − Fixní platby − Měsíční výdaje (typ 1) − Drahé věci (typ 3). **Roční kategorie (typ 2) v ní nejsou vůbec.** Audit reálných dat za červenec 2026 (prod) to vyčíslil:

- Reálný externí odtok domácnosti **169 432 Kč** vs. bilance **156 483 Kč** → rozdíl **12 949 Kč**.
- Roční čerpání za červenec: Y_Licence 15 078 + Y_Pojistky 6 867 + Y_Léky 5 551 = **27 296 Kč**, v bilanci nula.
- Financování ročních fondů je **asymetrické**: dotace na účet Nepravidelné je definovaná fixní platba (14 650 ✅), ale na účet Licence přiteklo 16 500 Kč a **není nikde**.
- **17 % ročních výdajů neteče přes fondový účet** (2026, 7 měsíců: 30 539 Kč ≈ 4 363 Kč/měs) — Y_Oblečení celá (14 744, vždy ze Společného), Y_Sport 4 950, Y_Auto servis 5 789, Y_Licence 3 010, Y_Pojistky 1 346, Y_Léky 1 200, Y_Beach −500.

Model dotací je přitom navržený konzistentně: součet ročních budgetů 247 001/rok vs. systém dotací (zrušené trvalé příkazy 14 500/měs + Licence 6 000/měs) = 246 000/rok. Nedodržuje se ale ani jedna ze dvou podmínek, za kterých by „výdaje ≤ dotace" stačilo: dotace není pevná (2–6 dorovnávacích převodů měsíčně, fondy jsou trvale na nule — netto za celý 2026: Licence +3 152, Nepravidelné +4 998) a část ročních výdajů se platí mimo fond.

## Rozhodnutí z brainstormingu

1. **Nová technická kategorie „Nestandardní dobití ročního budgetu"** nese převody nad rámec standardní dotace. Nelze to odvodit z cílového účtu (na Nepravidelné šlo v červenci i 3 000 „Dotace na T-mobile" a 150 na TV poplatek = financování *fixních* plateb) ani z poznámky (ze 6 převodů na Licence měly poznámku jen 2). Rozhodnutí musí být per transakce → kategorie je správný nosič.
2. **Doplnit, ne nahradit.** Standardní dotace zůstává fixní platba (jako dnes Nepravidelné 14 650; k tomu uživatel zavede pevný trvalý příkaz na Licence). Nová kategorie nese jen nadplán.
3. **Roční výdaje placené mimo fondový účet dostanou vlastní bilanční řádek**, aby byla bilance uzavřená bez ohledu na to, odkud se platilo.

Cílový model: **bilance měří odliv z provozních účtů.** Rozdíl proti skutečnému ročnímu čerpání je pak přesně změna stavu fondu (červenec: fondy vyrostly o ~6 400, bilance je o tuhle částku konzervativnější — správně, ty peníze na spořicí dát nelze).

### Cílová podoba bilance (červenec 2026, ilustrace)

```
Příjmy                                203 700
─ Fixní platby                        102 990   (10 dnešních + nová dotace Licence 6 000)
─ Nestandardní dobití ročního budgetu  10 500   ⚠
─ Roční výdaje mimo fond                2 653
─ Měsíční výdaje                       55 893
─ Drahé věci                            3 600
──────────────────────────────────────────────
= Na spořicí (přebytek)                28 064
```

(Rozdělení 6 000 / 10 500 je ilustrativní — v červenci pevný příkaz na Licence ještě neexistoval.)

## Řešení

### 1. Schema — `src/db/schema.js`

Tři migrace na konec `initSchema()`, každá ve vlastním `try/catch` (stávající konvence):

```sql
-- 1.
ALTER TABLE categories ADD COLUMN system_role TEXT;              -- NULL | 'fund_topup'
-- 2.
ALTER TABLE accounts   ADD COLUMN is_fund INTEGER NOT NULL DEFAULT 0;
```

3. **Bootstrap kategorie** (idempotentní): pro každý `user_id`, který **už má aspoň jednu kategorii** a nemá kategorii se `system_role = 'fund_topup'`, vlož `name = 'Nestandardní dobití ročního budgetu'`, `type = 4`, `system_role = 'fund_topup'`, `color = '#f59e0b'`, `icon = 'PiggyBank'` (klíč z `CATALOG` v `client/src/categoryIcons.jsx`; klíče jsou tam CamelCase).

Podmínka „už má aspoň jednu kategorii" je záměrná: v household sharingu jsou kategorie jen u data ownera (Martin, user 2, žádné nemá) — bez ní by vznikl mrtvý záznam.

**Identita v kódu je `system_role`, nikdy název.** Poučení z `transfer-category.js` (prod měl „Převody interní", kód hledal „Převody").

### 2. Matcher fixních plateb — `src/utils/fixed-expenses.js`

Dnešní guard `COALESCE(c.type, 0) != 4` v textové větvi se u řádků s `include_transfers = 1` **vypíná** — a to jsou právě obě dotace, které by jinak nestandardní dobití sebraly a započítaly podruhé. Obě větve matcheru proto musí kategorii `fund_topup` vylučovat **vždy**:

- `matchByDesc`: přidat `AND COALESCE(c.system_role, '') != 'fund_topup'` (před stávající `includeTransfers` podmínku, která zůstává).
- `outgoingWithCp`: dnes nemá join na `categories` — přidat `LEFT JOIN categories c ON c.id = t.category_id` a stejnou podmínku. Bez toho by dotace matchovaná číslem fondového účtu sečetla i nadplánové převody.

### 3. Backend agregáty — `src/routes/stats.js` (`GET /overview`)

Dvě nové položky v odpovědi:

```js
fund_topup: {
  category_id,        // id kategorie se system_role='fund_topup' (null když neexistuje)
  name,               // název kategorie (label bilančního řádku – renaming v UI se propíše)
  outflow,            // Σ|amount| za období: amount < 0, kategorie fund_topup, účet NENÍ is_fund
  tx_count,
  saldo,              // Σ amount napříč VŠEMI účty – kontrola, že nechybí párová noha
},
annual_off_fund: {    // null, když uživatel nemá ŽÁDNÝ účet s is_fund = 1
  spent,              // Σ(−amount) za období: kategorie type=2, účet NENÍ is_fund, + SPENDING_FILTER
  tx_count,
}
```

- `outflow` bere jen odchozí nohy, takže párová příchozí noha ho neruší. Vyloučení `is_fund` účtů dělá definici „odliv z provozních účtů" doslovnou (převod fond→fond by se nezapočítal).
- `annual_off_fund` používá `SPENDING_AND` — stejný fragment jako `by_category`, aby řádek seděl s čísly na stránce Roční budgety.
- `annual_off_fund = null` dokud není nakonfigurovaný ani jeden fondový účet: jinak by hned po deployi řádek ukázal celé roční čerpání (27 296) a mátl.

### 4. Sdílený výpočet — `client/src/utils/meetingBalance.js`

`surplusToSavings` a `computeMeetingSurplus` dostanou dva nové vstupy:

```js
export function surplusToSavings({ totalIncome, totalFixed, fundTopup, annualOffFund, totalType1, totalType3 }) {
  return totalIncome - totalFixed - fundTopup - annualOffFund - totalType1 - totalType3;
}
```

`computeMeetingSurplus({ ..., fundTopup = 0, annualOffFund = 0 })` je vrátí i v návratovém objektu. Defaulty 0 → volající, který je nepošle, dostane dnešní chování.

### 5. Bilanční řádky — `client/src/pages/ReportPage.jsx`

Za řádek „Fixní platby", před „Měsíční výdaje" (pořadí = od nejmenší volnosti rozhodování k největší):

- **`fund_topup.name`** — render když `outflow !== 0`. Klik → `/transactions?period=X&category_ids=<category_id>&direction=out`. Když `saldo !== 0`, k částce malý `⚠` s titulkem „U některého převodu chybí párová noha — zkontroluj sekci Účetní."
- **„Roční výdaje mimo fond"** — render když `annual_off_fund !== null && spent !== 0`. Klik → `/transactions?period=X&category_ids=<všechna typ 2 id>&off_fund=1&spending_only=1`.

`SavingsPage.jsx` předá stejné dva vstupy do `computeMeetingSurplus` (jinak by se plánovaný přebytek na dvou stránkách rozešel).

### 6. Filtr pro proklik — `src/routes/transactions.js`

Nový param v `buildTxWhere` (stejný styl jako `spending_only` / `match_patterns`):

```js
if (query.off_fund === '1') {
  where += ` AND NOT EXISTS (SELECT 1 FROM accounts ofa WHERE ofa.id = t.account_id AND ofa.is_fund = 1)`;
}
```

### 7. Konfigurace fondových účtů — `src/routes/accounts.js` + `client/src/pages/AccountsPage.jsx`

`is_fund` do `SELECT` v `GET /`, do `INSERT` v POST a do `UPDATE` v PATCH (coerce na 0/1, `'is_fund' in req.body` pattern jako u `account_number`). V UI checkbox „Fondový účet (roční budgety)" u účtu. Uživatel zaškrtne **Licence** a **Nepravidelné**.

### 8. Ochrana systémové kategorie — `src/routes/categories.js`

- `PATCH /:id`: u kategorie se `system_role IS NOT NULL` ignorovat změnu `type` (název, barvu a ikonu měnit lze).
- `DELETE /:id`: u kategorie se `system_role IS NOT NULL` vrátit 400 „Systémovou kategorii nelze smazat."

### 9. Drobnost — chip filtr v Transakcích

`client/src/pages/TransactionsPage.jsx:617` má skupiny chipů jen pro typy 1/2/3. Přidat `{ type: 4, label: 'Účetní' }`, ať se dá filtr z prokliku odklikat (URL filtr funguje i bez toho, jen chip není zvýrazněný).

## Konfigurace, kterou udělá uživatel (ne kód)

1. Trvalý příkaz v AirBank na účet Licence (např. 6 000/měs), „Zpráva pro příjemce: **Dotace - Licence**".
2. Fixní platba „Dotace na účet Licence": `match_pattern = 'Dotace - Licence'`, `include_transfers = 1`, `valid_from` = měsíc, kdy příkaz začne. **Ne** `match_counterparty_account` — to by sečetlo i nadplánové převody (i když je guard z §2 vyloučí, textový matcher je tu přesnější a čitelnější).
3. Zaškrtnout `is_fund` u účtů Licence a Nepravidelné.
4. U každého nadplánového převodu označit **obě nohy** kategorií „Nestandardní dobití ročního budgetu".

Bez bodu 1 je „nestandardní" všechno a řádek jen zastoupí chybějící dotaci.

## Kontrola správnosti bez nového kódu

Sekce **Účetní** na Schůzce už dnes ukazuje saldo per kategorie typu 4 s ⚠ při `saldo !== 0`. Když uživatel označí jen jednu nohu převodu, saldo nové kategorie nebude 0 a ⚠ ho na to upozorní. Žádný nový kontrolní mechanismus není potřeba.

## Testy

- `src/utils/fixed-expenses.test.js` — (a) řádek s `include_transfers = 1` **nematchuje** tx v kategorii `fund_topup` (textová větev); (b) řádek s `match_counterparty_account` **nematchuje** tx v `fund_topup` (účtová větev); (c) regrese: běžný převod s `include_transfers = 1` se matchuje dál.
- `src/routes/stats.test.js` — `fund_topup.outflow` bere jen `amount < 0`, jen v období, vylučuje účty `is_fund = 1`; `saldo` napříč všemi účty vyjde 0 při obou nohách; `annual_off_fund` je `null` bez fondového účtu a správná hodnota s ním (vč. respektování `SPENDING_FILTER`).
- `client/src/utils/meetingBalance.test.js` — přebytek odečítá oba nové vstupy; chybějící vstupy (default 0) = dnešní výsledek.
- `src/routes/transactions.test.js` — `off_fund=1` vyloučí transakce z fondového účtu.
- ReportPage/SavingsPage/AccountsPage: bez unit testů (JSX), ověřit `npm run build`.

## Mimo scope / vědomě odložené

- **Auto-párování druhé nohy** převodu při přiřazení kategorie (stejná abs. částka, opačné znaménko, protiúčet = druhý účet, ±3 dny). YAGNI — kontrola saldem to pokrývá, převodů je 2–6/měs.
- **Retroaktivní označení historie.** Červen a starší zůstanou bez nových řádků; dobití fondů by šlo dohledat, ale je to ruční práce bez přínosu pro plánování dopředu.
- **Rozpad nového řádku per fond.** Jedna kategorie pro všechny fondy; detail je vidět po prokliku do Transakcí (poznámka + protiúčet).
- **Červnové dvojí počítání nájmu** (38 126 — počítá se současně převod „old - Na nájem" 45 000 i skutečná platba „Nájem Stodůlky"; oprava = `Nájem Stodůlky.valid_from = '2026-07'`, symetricky s PRE). Samostatná konfigurační drobnost.
- **Ostatní nálezy z auditu** (nedoklikaná platba RAMPA SPORT 2 830 ve frontě, 2× sporná kategorie u Drahých věcí, +100 „Beach" v Y_Sport, `Příjmy` jako type 1) — mimo tuto featuru.
