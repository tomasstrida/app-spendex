# B-3 Účetní kategorie + Převody interní na Schůzce

**Datum:** 2026-07-14
**Stav:** Design – schváleno uživatelem
**Zdroj:** Spendex backlog 13.7.2026:
- „Vytvořit novou skupinu kategorií „Účetní" pro převody mezi účty a podobně"
- „Přidat do „schůzka" kategorii „Převody interní" (aby bylo vidět, že má nulové saldo)"
**Balíček:** B (přepracování modelu kategorií), dílčí featura B-3

## Kontext

Kategorie jako „Převody" (interní přesuny mezi vlastními účty) nejsou výdaj ani
příjem — jsou to čistě účetní pohyby, které se mají v součtech vyrušit (saldo ~0).
Dnes jsou `type = 1` (měsíční) jako běžné výdaje, takže konceptuálně splývají
s provozními kategoriemi. Uživatel chce:

1. **Skupinu „Účetní"** — kategorie mimo výdaje/příjmy (převody mezi účty a podobně),
   které se nezapočítávají do výdajů a spravují se odděleně.
2. **Řádek „Převody interní" na Schůzce** — souhrn se saldem, aby bylo vidět,
   že interní převody vycházejí na nulu (nenulové saldo = signál chyby).

## Rozhodnutí z brainstormingu

1. **Členství skupiny:** Účetní = **Převody + volitelné další účetní kategorie**
   (rozšiřitelné). **Příjmy zůstávají zvlášť** (mají vlastní bohatou sekci Příjmy
   na Schůzce, řešeno jiným backlog bodem).
2. **Datový model:** **`categories.type = 4`** (čtvrtá hodnota vedle 1 měsíční /
   2 roční / 3 fond). Vzájemně vylučující s rozpočtovými typy — účetní kategorie
   nemá rozpočet. Využije stávající filtrování podle `type`.
3. **Saldo Převodů:** **napříč VŠEMI vlastními účty** bez ohledu na roli (vč.
   `ignored`/savings). Obě nohy převodu se započtou → saldo ~0 při spárování;
   nenulové saldo = chybějící noha nebo falešně označený externí převod. Toto je
   smysl „nulového salda".
4. **Zobrazení:** nová sekce **Účetní na Schůzce** (souhrnné řádky + saldo) +
   **správa na stránce Kategorie** (type=4). Na Dashboardu (Měsíční rozpočty) se
   účetní **automaticky nezobrazí** — jen vyloučí z výdajů.

## Rozsah

### 1. Datový model (žádná schema změna)

`categories.type` (INTEGER DEFAULT 1, bez CHECK constraintu) dostane čtvrtou
hodnotu **`4` = účetní**. Žádný nový sloupec ani migrace schématu.

- Účetní kategorie nemá rozpočet. Stávající logika v `src/routes/categories.js`
  (`if (newType !== 1) DELETE FROM budgets`) mrtvé budgety odstraní sama — beze změny.
- **Seed** (`scripts/seed/categories.js`): kategorie **„Převody" → `type: 4`**
  (dnes `type: 1`). „Příjmy" zůstává `type: 1`.

**Název kategorie:** kategorie **zůstává „Převody"** (NEpřejmenovává se na
„Převody interní"). Důvod: `scripts/seed/rules.js` má `internalTransferCategory:
'Převody'` a L0 pravidlo v `src/utils/apply-rules.js` mapuje interní převod na
tuto kategorii **podle názvu**. Přejmenování by vyžadovalo synchronní změnu
konstanty i dat a zvětšilo plochu rizika bez funkčního přínosu. Sekce „Účetní"
dává internímu charakteru dostatečný kontext; uživatel může kategorii ručně
přejmenovat v UI, pokud chce.

### 2. Automatické vyloučení z výdajů

`type = 4` se přirozeně vyloučí všude, kde se dnes filtruje na `type === 1`:

- **Dashboard** (`client/src/pages/DashboardPage.jsx` ~197): filtr
  `b.category_type === 1` → účetní zmizí z provozních budgetů i ze souhrnného
  teploměru „Celkem za období".
- **Roční budgety** (type 2) a **Drahé věci** (type 3) — nedotčené, type 4 se tam
  nezobrazí.
- **Schůzka – Měsíční výdaje** (`ReportPage.jsx:180`): sekce už dnes filtruje
  `b.category_type === 1`, takže type 4 se v Měsíčních výdajích **nezobrazí** —
  žádná duplicita se sekcí Účetní. Beze změny.

### 3. Schůzka – nová sekce „Účetní"

**Backend** (`src/routes/stats.js`, endpoint `GET /overview`): nový blok
`accounting` v odpovědi. Pro každou kategorii `type = 4` daného uživatele:

```sql
SELECT c.id, c.name, c.color, c.icon,
  COALESCE(SUM(t.amount), 0) AS saldo,
  COUNT(t.id) AS tx_count
FROM categories c
LEFT JOIN transactions t ON t.category_id = c.id
  AND t.user_id = ?
  AND t.date >= ? AND t.date <= ?
WHERE c.user_id = ? AND c.type = 4
GROUP BY c.id
ORDER BY c.name ASC
```

- **`saldo = SUM(t.amount)` napříč VŠEMI účty** — **bez** `SPENDING_FILTER`, bez
  filtru na roli. Konvence znaménka: kladné = čistý příliv do účetní kategorie,
  záporné = odliv, **~0 = vyrovnané**.
- Odpověď: `accounting: [{ id, name, color, saldo, tx_count }]`.

**Frontend** (`client/src/pages/ReportPage.jsx`): nová sekce **„Účetní"** umístěná
**za** sekcí „Měsíční výdaje" a **před** „Drahé věci". Struktura shodná se
stávajícími `report-section` (nadpis `h2.report-section-title` + řádky):

- Každá účetní kategorie = jeden souhrnný řádek: barevná tečka + název +
  `formatCurrency(saldo)`. Řádek je `<Link>` na
  `/transactions?category_id=${id}&period=${period}` (vzor stávajících řádků).
- **Signál nenulového salda:** pokud `Math.round(saldo) !== 0`, řádek dostane
  varovnou barvu / ikonu (např. `text-danger` + drobná poznámka), aby bylo vidět,
  že interní převody nevyšly na nulu. Práh: |saldo| ≥ 1 Kč = nevyrovnané.
- Sekce se nezobrazí, pokud uživatel nemá žádnou účetní kategorii
  (`accounting.length === 0`) — žádná prázdná sekce.
- Rozsah **„jen shrnutí"**: žádný rozpad jednotlivých transakcí, jen saldo za
  kategorii (detail je proklikem do Transakcí).

### 4. Správa na stránce Kategorie

`client/src/pages/CategoriesPage.jsx` – `TYPE_OPTIONS` (~180) dostane čtvrtou
položku:

```js
{ value: 4, label: 'Účetní', desc: 'Převody mezi účty, nezapočítává se do výdajů' }
```

- Radio výběr typu už existuje; přidání čtvrté volby stačí.
- Přepnutí kategorie na type 4 přes stávající `PATCH /api/categories/:id` — smaže
  případné budgety (existující logika `newType !== 1`).
- Formulářové sekce specifické pro type 3 (typická cena/frekvence) se pro type 4
  nezobrazí (podmínky `type === 3` zůstávají beze změny).

### 5. Migrace

- **Seed** `scripts/seed/categories.js`: „Převody" → `type: 4`.
- **Retroaktivní prod migrace** `scripts/migrate-accounting-type.cjs` (vzor
  stávajících migrací, dry-run default / `CONFIRM=1`):
  - pro každého uživatele najde kategorii jménem **„Převody"** a nastaví
    `type = 4` (jen kde je dnes `type != 4`);
  - aditivní — nemaže, jen mění typ; případné budgety té kategorie smaže
    (konzistence s runtime chováním);
  - dry-run vypíše kandidáty, `CONFIRM=1` zapíše v `db.transaction`;
  - prod spuštění přes `railway ssh` po nasazení kódu a explicitním potvrzení.

### 6. Testy

- **`stats` route test:** `accounting` blok obsahuje jen `type = 4` kategorie;
  saldo počítá napříč všemi účty (i `ignored`), tj. dvě protisměrné nohy převodu
  → saldo 0; type 1/2/3 kategorie se v `accounting` neobjeví; kategorie type 4 se
  neobjeví v `by_category` sekci Měsíční výdaje (pokud ji dotaz odděluje).
- **`categories` route test:** `PATCH { type: 4 }` na kategorii s budgetem →
  budget smazán, `type = 4` uložen (reuse vzoru z roční migrace v
  `categories.test.js`).
- **Client util test** (pokud dává smysl): filtr Dashboardu vyloučí `category_type
  === 4`.

## Non-goals (mimo B-3)

- **Drahé věci** („zrušit kategorii → jen roční budget, dál zobrazovat samostatně")
  — samostatný backlog bod, dříve vědomě odloženo („nech fond nulový, řešíme
  později"). NENÍ součástí B-3.
- **Příjmy beze změny** — backlog bod „Schůzka – Příjmy bez tolerance / jen
  definované zdroje" je samostatná featura, ne součást B-3.
- Přejmenování kategorie „Převody" na „Převody interní" (viz 1 – vědomě ne).
- Rozpočty ani rozpad transakcí u účetních kategorií.
- Automatické rozpoznávání, které kategorie mají být účetní — uživatel značí ručně
  (kromě seedového přepnutí „Převody").

## Nasazení

Commit + push do `staging` (Railway staging), po vizuální kontrole na pokyn merge
`staging` → `main`. Retroaktivní migraci na prod spustit až po nasazení kódu,
s explicitním potvrzením. Hlásit verzi.
