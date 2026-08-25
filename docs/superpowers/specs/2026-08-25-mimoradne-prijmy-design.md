# Mimořádné příjmy, design

Datum: 2026-08-25
Stav: návrh k implementaci

## 1. Problém

Do domácnosti občas přijdou peníze, které nepatří do žádného pravidelného příjmu: přeplatek
za energie, dar, výhra, prodej použité věci. Dnes s nimi Spendex neumí naložit ani jedním
rozumným způsobem:

- **Vypadnou z bilance.** Do „Příjmy celkem" na Schůzce vstupují jen platby napárované na
  definovaný `income_sources` alias (striktní whitelist v `computeMeetingSurplus`,
  `client/src/utils/meetingBalance.js`). Nečekaný příjem alias nemá, takže skončí jako
  „auto-only" a z bilance zmizí — zůstane po něm jen varování `unmatchedIncome`
  („1 nezařazená příchozí platba"), a to jen když má protiúčet.
- **Nebo zkreslí kategorii.** Přeplatek zařazený do kategorie Energie sníží `utraceno`
  (`SUM(-amount)`), takže měsíc vypadá, jako by se za energie skoro neplatilo. Teploměr
  i historie kategorie tím dostanou výkyv, který neodpovídá skutečné spotřebě.
- **Obcházka přes trvalý alias je horší.** Založit `income_sources` řádek s `planned_amount = 0`
  by fungovalo, ale zůstane v konfiguraci navždy a jeho matcher může chytit další platby
  od stejné protistrany.

**Zadání (potvrzeno uživatelem v brainstormingu):**

1. Mimořádný příjem stojí **pod čarou provozní bilance** — bilance provozu zůstane srovnatelná
   mezi měsíci, mimořádná částka se přičte až do výsledného „Na spořicí".
2. Mechanismus = **systémová kategorie**, stejným vzorem jako `fund_topup` a `prepaid_purchase`.
3. **Přeplatky energií patří sem**, ne do kategorie Energie: utraceno v kategorii má zůstat
   reálnou spotřebou měsíce.
4. **Jeden koš**, bez subkategorií. Rozlišení („Přeplatek PRE", „Prodej kola") nese popis platby.
5. **Ruční zařazování**, žádná textová pravidla — takových plateb bude minimum a pravidlo na
   „PRE" by chytalo i běžnou platbu za elektřinu opačným směrem.
6. **Vývoj spoření se v této etapě nemění.**

## 2. Zvolený model

Mimořádný příjem = transakce zařazená do systémové kategorie `system_role = 'extra_income'`
(`type = 4`, „Mimořádné příjmy"). Kategorie je jediné místo, kde taková platba žije: z výpočtu
příjmů se vyloučí, do rozpočtů (type 1–3) nevstupuje už dnes.

Zvažované alternativy:

- **Fronta na Schůzce** (dnešní varování `unmatchedIncome` povýšit na akci se dvěma tlačítky):
  proaktivní, nulová konfigurace dopředu, ale staví nový aparát vedle existujícího modelu
  kategorií a neumí platby bez protiúčtu. Zamítnuto ve prospěch kategorie, která zdarma dědí
  filtry, prokliky, hromadnou změnu kategorie i případná budoucí pravidla.
- **Příznak `is_extra_income` u transakce**: univerzální, ale zavádí druhou osu klasifikace
  vedle kategorie a s ní otázku, co znamená příznak + kategorie zároveň. Zamítnuto.
- **Subkategorie / více kategorií**: YAGNI. Subkategorie lze přidat později bez migrace dat.

### 2.1 Tok

```
Příchozí platba 8 000 Kč (přeplatek PRE)
   │
   ├─ uživatel ji ručně zařadí do kategorie „Mimořádné příjmy"
   │
   ├─ GET /api/stats/overview → extra_income.inflow = 8 000
   │
   ├─ incomeSourcesForPeriod() ji VYNECHÁ  → nezvýší „Příjmy celkem"
   │                                       → nezaloží varování unmatchedIncome
   │
   └─ Schůzka: řádek pod provozním přebytkem → „Na spořicí" +8 000
```

## 3. Datový model

Nová systémová kategorie, bootstrap v `src/db/schema.js` přesně podle vzoru `fund_topup`
(řádky ~523-575) a `prepaid_purchase`:

| Sloupec | Hodnota |
|---|---|
| `name` | `Mimořádné příjmy` |
| `type` | `4` |
| `system_role` | `extra_income` |
| `color` | `#10b981` (zelená — jediná příjmová systémová kategorie) |
| `icon` | `Gift` |

Bootstrap má dvě větve, stejně jako u předchozích dvou:

1. **INSERT** pro každého uživatele, který už má aspoň jednu kategorii a zároveň ještě nemá
   kategorii se `system_role = 'extra_income'`. Podmínka „už má kategorie" brání tomu, aby
   systémová kategorie vznikla dřív než uživatelova vlastní sada.
2. **Promote** existující kategorie stejného jména (`type = 4`, `system_role = 'extra_income'`),
   aby nevznikly dvě.

Žádná nová tabulka, žádná migrace dat, žádný nový sloupec v `transactions`.

**Ochrana kategorie** už je generická a pokrývá i tuhle: `src/routes/categories.js:89` drží typ
systémové kategorie pevně kódem, `:123` odmítá smazání. Není co doplňovat, jen ověřit testem.

### 3.1 Riziko: čtvrtá type=4 kategorie

Type 4 dnes nese tři významy: „Převody interní" (uživatelská, `system_role IS NULL`),
`fund_topup` a `prepaid_purchase`. Přibude čtvrtý. Každý dotaz, který hledá „tu kategorii
převodů" podle `type = 4`, musí mít `AND system_role IS NULL` — jinak si sáhne pro špatnou.

**Implementační krok:** projít všechny výskyty `type = 4` v backendu (zejména
`src/utils/transfer-category.js` a matcher fixních plateb) a ověřit, že guard mají. Guard
matcheru fixních plateb byl v balíčku E zobecněn z `!= 'fund_topup'` na
`COALESCE(system_role,'') = ''`, takže novou kategorii pokrývá bez zásahu — ověřit testem.

## 4. API

### 4.1 `GET /api/stats/overview` — nový blok `extra_income`

Struktura zrcadlí `fund_topup` a `prepaid_purchase` (`src/routes/stats.js:121-149`, `:187-199`),
liší se znaménkem: tohle je příliv.

```js
extra_income: {
  category_id: <id | null>,
  name: <string | null>,
  inflow: <number>,     // COALESCE(SUM(t.amount), 0) — SALDO, ne jen kladné částky
  tx_count: <number>,
}
```

SQL:

```sql
SELECT COALESCE(SUM(t.amount), 0) AS inflow, COUNT(t.id) AS tx_count
FROM transactions t
WHERE t.user_id = ? AND t.category_id = ? AND t.date >= ? AND t.date <= ?
```

Tři rozhodnutí v tomhle dotazu:

- **Saldo, ne `amount > 0`.** Kdyby uživatel část přeplatku vrátil a zařadil vratku do stejné
  kategorie, číslo zůstane pravdivé. Stejný princip jako refundy v kategoriích.
- **Bez `SPENDING_FILTER`.** Ten filtr vyžaduje kategorii typu 1–3 a zahodil by všechno.
  Stejné rozhodnutí jako u `fund_topup`.
- **Bez omezení na účet.** Mimořádný příjem může přistát na kterémkoli účtu domácnosti.

**Dopad na ostatní agregáty ve stejném endpointu** (ověřeno proti kódu, ne odhad):

| Agregát | Chování | Akce |
|---|---|---|
| `by_category` | `SPENDING_FILTER` **nefiltruje podle typu kategorie**, jen podle role účtu — mimořádný příjem na `spending` účtu tam spadne se záporným `spent`. | Žádná. Klient `by_category` všude filtruje na `type === 2` / `type === 3` (`ReportPage`, `AnnualBudgetsPage`), takže se nikde nezobrazí. |
| `total_spent` | Ze stejného důvodu klesne o částku mimořádného příjmu. | Žádná. Klient `total_spent` nepoužívá — dnes už obsahuje i interní převody a nákupy balíčků. |
| `budget-history` (Vývoj výdajů) | Má explicitní `c.type != 4`. | Žádná. |
| **`accounting` (sekce Účetní)** | **Vezme všechny `type = 4` kromě `prepaid_purchase` a kontroluje saldo na nulu.** Mimořádný příjem má saldo trvale kladné, takže by se hlásil jako nevyrovnaný převod s ⚠. | **Nutná — viz 4.2.** |

### 4.2 Vyloučení z Účetní sekce

`accounting` (`src/routes/stats.js:54-66`) existuje kvůli kontrole interních převodů: saldo napříč
účty má vyjít nula, jinak chybí párová noha. Mimořádný příjem není převod a nulu nikdy nedá —
patří ven ze stejného důvodu jako `prepaid_purchase`. Podmínka se rozšíří:

```sql
AND COALESCE(c.system_role, '') NOT IN ('prepaid_purchase', 'extra_income')
```

### 4.3 `incomeSourcesForPeriod()` — vyloučení

**Nejrizikovější místo celé featury.** Příchozí platba dnes prochází výpočtem příjmů
(`src/utils/income.js`) a bez zásahu by skončila započtená dvakrát:

- jako **varování** `unmatchedIncome` — vizuální šum, platba v kategorii je přece zařazená;
- jako **skutečný příjem**, pokud na ni sedne nějaký `income_sources` alias (typicky obecný
  alias bez omezení na cílový účet). To by bilanci reálně nafouklo o dvojnásobek.

Řešení: hlavní SELECT v `incomeSourcesForPeriod()` doplnit o vyloučení kategorie:

```sql
AND (t.category_id IS NULL OR t.category_id != ?)
```

Id kategorie se načte jedním dotazem na začátku funkce; když kategorie neexistuje
(uživatel bez bootstrapu), podmínka se vynechá a chování zůstane dnešní.

## 5. Klient

### 5.1 `computeMeetingSurplus()` — dvě nová pole

`surplusToSavings()` zůstává **beze změny** — je to provozní přebytek a jeho význam se nemění.
`computeMeetingSurplus()` (`client/src/utils/meetingBalance.js`) přijme nový vstup `extraIncome`
(default 0) a vrátí navíc:

| Pole | Význam |
|---|---|
| `extraIncome` | mimořádné příjmy za období |
| `surplus` | provozní přebytek — beze změny významu |
| `totalToSavings` | `surplus + extraIncome` — kolik má reálně jít na spořicí |

Default 0 drží zpětnou kompatibilitu: volající, který `extraIncome` nepředá, dostane
`totalToSavings === surplus`.

### 5.2 Schůzka (`ReportPage.jsx`)

Bilance se rozdělí na dva bloky:

```
  Příjmy celkem
− Fixní platby
− Měsíční výdaje
− Drahé věci
− Roční výdaje mimo fond
− Nákup předplacených balíčků
− Nestandardní dobití ročního budgetu
─────────────────────────────────────
= Provozní přebytek                     ← dnešní `surplus`, přejmenovaný řádek
+ Mimořádné příjmy                      ← nový řádek, proklik do Transakcí
─────────────────────────────────────────
= Na spořicí                            ← `totalToSavings`, výsledný řádek
  Skutečně převedeno                    ← beze změny
```

Detaily:

- Řádek **Mimořádné příjmy** se zobrazí jen když `extra_income.category_id` existuje
  a `inflow !== 0` — stejná podmínka jako u `prepaid_purchase` a `fund_topup`. V měsíci bez
  mimořádného příjmu vypadá stránka přesně jako dnes, jen s přejmenovaným řádkem.
- Proklik: `category_ids=<id>` + `period`, **bez `direction`**. `inflow` je saldo (§4.1) — kdyby
  proklik filtroval jen `direction=in`, u vráceného přeplatku by vypsal víc transakcí, než kolik
  udává součet nad ním. **Musí vézt i `period`** — TransactionsPage AND-uje období z kontextu
  a bez něj se rozejde součet s výpisem.
- Formátování: `formatCurrency` vrací absolutní hodnotu, takže znaménko se skládá ručně
  (`inflow >= 0 ? '+' : '−'`), stejně jako u `annual_off_fund`.
- Třída `report-bilance-result` dnes visí na jediném řádku. Nově je výsledný řádek
  **Na spořicí**; „Provozní přebytek" dostane vlastní vizuální odlišení (mezisoučet — slabší
  než výsledek, silnější než položka), aby bylo poznat, že bilance má dva stupně.
- Když mimořádný příjem v období není, „Provozní přebytek" a „Na spořicí" ukazují stejné číslo.
  To je záměr — dva řádky, ne skrývání jednoho: uživatel má vidět strukturu bilance konzistentně.

### 5.3 Spořicí účet (`SavingsPage.jsx`)

`SavingsPage` čte `computeMeetingSurplus()` pro řádek „plán" (`:44`, `:102`). Musí přejít na
`totalToSavings` a načíst `stats.extra_income`, jinak se plán spoření rozejde se Schůzkou právě
o mimořádnou částku. **Tohle je snadné přehlédnout** — obě stránky mají sdílet jedno číslo.

### 5.4 Picker kategorií

Select v editaci transakce (`TransactionsPage.jsx:1031-1034`) mapuje `categories` bez filtru na
typ, takže systémová kategorie je dostupná automaticky. **K ověření při implementaci:** stejný
picker v `ImportPage` (zařazování z fronty revize) — pokud tam filtr na typ je, mimořádný příjem
by se nedal zařadit v místě, kde ho uživatel potká nejdřív.

## 6. Testy

**Backend:**

- `schema` — bootstrap založí kategorii; druhé spuštění nezaloží druhou (idempotence); existující
  kategorie stejného jména se povýší místo vzniku duplicity.
- `stats` — `extra_income.inflow` sečte příchozí platby v kategorii za období; vratka v téže
  kategorii saldo sníží; období mimo rozsah se nezapočítá; bez kategorie vrací `category_id: null`
  a `inflow: 0`.
- `income` — platba v kategorii `extra_income` **nevstoupí** do `incomeSourcesForPeriod()`, a to
  ani když na ni sedne `income_sources` alias (regrese dvojího započtení).
- `stats` — sekce `accounting` kategorii `extra_income` **nevrací** (jinak by hlásila nevyrovnané
  saldo s ⚠); `prepaid_purchase` zůstane vyloučená jako dnes.
- `categories` — systémovou kategorii nelze smazat ani jí změnit typ.
- `fixed-expenses` — matcher fixních plateb kategorii `extra_income` přeskočí (guard
  `COALESCE(system_role,'') = ''`).

**Klient:**

- `meetingBalance` — `totalToSavings === surplus + extraIncome`; chybějící `extraIncome`
  se chová jako 0; `surplus` se zavedením mimořádného příjmu nemění.

## 7. Mimo scope

Vědomě odloženo, dokud se neukáže, že chybí:

- **Značka ve Vývoji spoření** — skok v grafu salda bude bez vysvětlení. Rozhodnuto odložit;
  doplní se bez předělávání (kategorie i agregát už budou existovat).
- **Subkategorie** (Přeplatek / Dar / Výhra / Prodej) — přidatelné později bez migrace dat.
- **Textová pravidla** pro automatické zařazení.
- **Mimořádné výdaje** — zrcadlový případ (nečekaný jednorázový výdaj mimo fond). Model by byl
  symetrický, ale zadání ho nezahrnuje.
- **Retroaktivní zařazení historických plateb** — uživatel si je případně zařadí ručně přes
  hromadnou změnu kategorie, která už existuje.

## 8. Známá omezení

- **Nic nehlídá, že do kategorie spadne odchozí platba.** Model to unese (saldo), ale bilance
  by pak ukázala záporný mimořádný příjem. Vědomě bez validace — jde o ruční zařazování
  v řádu jednotek plateb za rok.
- **Domácnost sdílí jednu kategorii.** Mimořádný příjem jednoho z partnerů se od druhého
  nerozliší; rozpad podle osoby by vyžadoval buď subkategorie, nebo vazbu na člena domácnosti.
- **Mimořádný příjem zvyšuje plán spoření, ne skutečnost.** Řádek „Skutečně převedeno" dál měří
  reálné pohyby na spořicím účtu — pokud peníze zůstanou na běžném účtu, plán a skutečnost se
  rozejdou. To je stávající chování bilance a je správné.
