# Kontrola fondů, design

Datum: 2026-08-26
Stav: návrh k implementaci

## 1. Problém

Účty „Nepravidelné" a „Licence" (`accounts.is_fund = 1`) jsou fondy: chodí na ně měsíční
dotace a postupně se z nich platí roční výdaje (kategorie typu 2). Dnes o nich aplikace
neřekne to jediné, co je u fondu podstatné — **jestli na nich zbývá dost na to, co ještě
letos přijde**.

Reálný stav k 25. 8. 2026: na Nepravidelném je **7 158 Kč**, spadl tam z 29 641 během
srpna (servis Toyoty −14 361, optika −5 000). Přitom jen podpoložka „Beach zima 2026"
plánuje **10 200 Kč** s oknem 9–12. Fond tedy nestačí a nikde to není vidět.

**Zadání (potvrzeno uživatelem v brainstormingu):**

1. Stránka odpoví na **obě** otázky: „vyjde to?" (krytí) nahoře a „jak jsme se sem
   dostali?" (historie) pod tím.
2. Pokrývá **každý účet s `is_fund = 1`** — dnes Nepravidelné a Licence, přepínačem.
3. Které roční kategorie se platí z kterého fondu, určí **uživatel explicitně**, ne
   odvození z historie.
4. Podpoložky, jejichž **okno už uplynulo a nevyčerpaly se, se ignorují**.

## 2. Proč ne odvození z historie

Zvažovalo se automatické přiřazení kategorie k fondu podle toho, odkud se nejčastěji
platila. Na reálných datech (2026) to selhává přesně tam, kde na tom záleží:

| Kategorie | Odkud se platí | Verdikt |
|---|---|---|
| Y_Licence | Licence 156× (83 133 Kč) vs. Společný 5× | jednoznačné |
| Y_PrEP, Optika / Y_Auto Moto / Y_Pojistky / Y_Lítačka / Y_Beach | Nepravidelné | jednoznačné |
| **Y_Sport** | Společný 3× (6 550) vs. Nepravidelné 3× (15 450) | **remíza** |
| **Y_Oblečení** | Společný 12× (14 744), fond 1× (298) | **není z fondu vůbec** |
| Y_Terapie, WEB domény | letos žádná platba | **nelze odvodit** |

Automat by uhodl šest kategorií a tiše se spletl u čtyř — a u Y_Oblečení jde o známé
omezení (financuje se dvakrát: dotací i nákupem ze Společného). Zkreslené číslo krytí
je horší než žádné, protože se podle něj rozhoduje.

## 3. Datový model

Jediná změna schématu — nový nullable sloupec, přidaný jako `ALTER TABLE` na konec
`initSchema()` v `src/db/schema.js` (stejný vzor jako ostatní migrace):

```sql
ALTER TABLE categories ADD COLUMN fund_account_id INTEGER
```

| Hodnota | Význam |
|---|---|
| `id` fondového účtu | kategorie se financuje z tohoto fondu, její zbývající plán vstupuje do krytí |
| `NULL` (výchozí) | kategorie se z fondu nefinancuje — do krytí nevstupuje (případ Y_Oblečení) |

Žádná nová tabulka. Sloupec nemá FK constraint (SQLite je v ALTER TABLE nepodporuje
přidat) — integritu drží validace v API: `PATCH /api/categories` přijme jen `id` účtu
téhož uživatele s `is_fund = 1`, nebo `null`.

**Smazání fondového účtu** osiřelé odkazy nechá — bez FK je `ON DELETE SET NULL`
nedostupné. Výpočet krytí proto joinuje `accounts` a kategorie s neexistujícím
`fund_account_id` se chová jako `NULL`.

## 4. Výpočet krytí — `src/utils/fund-coverage.js`

### 4.1 Zůstatek fondu

Stejná kotva jako u Vývoje spoření: nejnovější `transactions.balance_after` na daném
účtu napříč celou historií, plus pohyby, které nastaly po něm.

**Zjednodušení oproti spoření (ověřeno na produkčních datech):** u fondových účtů se
nohy převodů nepřekrývají — dotaz `account_id = <fond> AND counterparty_account =
<číslo téhož fondu>` vrací **0 řádků** pro Nepravidelné i Licence. Pohyb na fondu je
proto prostě:

```sql
SELECT COALESCE(SUM(amount), 0) FROM transactions
WHERE user_id = ? AND account_id = ? AND date >= ? AND date <= ?
```

Dedup nohou z `src/utils/savings.js` (párovací okno, `external` řádky) se tady
**nepoužije**. U spořicího účtu je nutný proto, že tam je část pohybů zachycená jen jako
protistrana na běžném účtu; u fondů jsou všechny nohy zaúčtované přímo na fondu.

Pozor na rozlišení, které §7 rozvádí: **`savings.js` (dedup pohybů) zůstává beze změny**;
sdílet se bude jen řetězení zůstatků od kotvy, které dnes leží v `stats.js`.

### 4.2 Zbývá vyčerpat

```
zbývá = Σ přes AKTIVNÍ podpoložky fondu:  max(0, amount − spent_v_okně_položky)

aktivní podpoložka = window_to ≥ dnešní datum
podpoložka fondu   = její kategorie má fund_account_id = <účet>
spent_v_okně       = SUM(-amount) transakcí kategorie v datovém okně položky
```

„Aktivní" se posuzuje proti **konci datového okna** (`window_to`), ne proti číslu měsíce:
u cross-year položky (`window_start > window_end`, např. okno 10–1) leží konec v dalším
roce a porovnání čísel měsíců by ji nesprávně označilo za uplynulou. Okno se počítá pro
**aktuální kalendářní rok** — `budget_items` nesou měsíce 1–12 bez roku, takže roční
horizont je vlastnost datového modelu, ne volba.

`spent_v_okně` se počítá **stejně jako v `src/routes/budget-items.js:27-42`** (včetně
cross-year okna, kdy `window_start > window_end` posune konec do dalšího roku), aby
čísla seděla se stránkou Roční budgety.

**Proč čerpání v okně položky, ne za rok:** kategorie Y_Lítačka má dvě položky —
Tom 3 650 (okno 4–5, zaplaceno) a Martin 3 650 (okno 8–9, nezaplaceno). Roční plán
7 300 minus roční čerpání 3 650 dá „zbývá 3 650", což je náhodou správně; ale jakmile
by Tom stál 4 000, vyjde 3 300 a Martinova lítačka se v krytí scvrkne. Okno položky
drží obě nezávisle.

### 4.3 Krytí

```
krytí = zůstatek − zbývá
```

Kladné = fond pokryje, co ho čeká. Záporné = schodek. Dnešní data pro Nepravidelné:
7 158 − 10 200 = **−3 042 Kč**.

### 4.4 Známé omezení: překrývající se okna

Kategorie s víc podpoložkami, jejichž okna se překrývají, započítá tutéž platbu do
každé z nich. Y_Beach volejbal má čtyři položky (Tom AVL 1–12, Beach léto 5–9, Tom
Ládví 5–9, Beach zima 9–12), takže platba 3 700 Kč z července sníží zbytek u tří z nich
naráz. Důsledek: **krytí je optimističtější než realita.**

Přesně by to řešila jen vazba transakce → podpoložka, kterou datový model nemá.
Tahle featura ji nezavádí; stejnou nepřesnost už dnes vykazuje stránka Roční budgety,
takže obě stránky aspoň lžou stejně.

## 5. API

### 5.1 `GET /api/stats/fund-history`

Parametry: `account_id` (povinný), `from`, `to` (`YYYY-MM`, výchozí jako u
`savings-history`: rozsah končící BĚŽÍCÍM obdobím, minimálně 6 období).

Validace: `account_id` musí být účet **téhož uživatele** s `is_fund = 1`, jinak
`400 { error: 'Účet není fondový.' }`. Rozsah období stejné limity jako ostatní
historie (`MAX_PERIODS`).

Odpověď:

```js
{
  account: { id, name, account_number },
  coverage: {
    balance: number|null,        // null = účet nemá ani jeden snapshot
    balance_date: string|null,   // datum kotvy, ať je vidět, jak je číslo staré
    remaining: number,           // zbývá vyčerpat
    diff: number|null,           // balance − remaining; null když balance je null
    items: [{ budget_item_id, category_id, category_name, name,
              amount, spent, remaining, window_from, window_to }]
  },
  periods: [{ key, start, end, partial }],
  values:  [{ period, net, tx_ids, balance_derived, balance_actual }],
  totals:  { net }
}
```

`values` má **záměrně stejný tvar** jako odpověď `savings-history`, aby šla použít
existující komponenta grafu beze změny jejího rozhraní.

`balance: null` (fond bez jediného snapshotu) není chyba — stránka v tom případě skryje
kartu krytí a ukáže vysvětlení, že chybí data ze snapshotů.

### 5.2 `PATCH /api/categories/:id` — nové pole

Přijme `fund_account_id` (číslo nebo `null`). Validace: účet existuje, patří uživateli,
má `is_fund = 1`. Jinak `400 { error: 'Účet není fondový.' }`.

## 6. Klient

### 6.1 Stránka `/fund-history` „Kontrola fondů"

Route v `App.jsx`, položka v `Sidebar.jsx` vedle „Vývoj spoření" (sekce s ostatními
historiemi). Struktura shora dolů:

1. **Přepínač fondových účtů** — chips ve stylu ostatních filtrů (`--brand #863bff`).
   Když má uživatel jediný fondový účet, přepínač se skryje. Žádný fondový účet →
   stránka vysvětlí, že se fond označuje zaškrtnutím u účtu v Nastavení.
2. **Karta krytí** — velké číslo „Zbývá po pokrytí +X Kč" / „Chybí X Kč" (zelená/červená
   podle znaménka), pod ním dva řádky: zůstatek k datu kotvy a zbývá vyčerpat.
3. **Rozpad zbývajících položek** — tabulka `název · kategorie · plán · vyčerpáno ·
   zbývá`, aby bylo vidět, z čeho se „zbývá" skládá. Řádek proklikne do Transakcí na
   kategorii a datové okno položky.
4. **Graf** — existující `SavingsHistoryChart` beze změny (křivka zůstatku + sloupce
   salda, sdílená osa X), pod ním tabulkový pohled po obdobích jako u spoření.

### 6.2 Výběr fondu u roční kategorie

Na stránce Roční budgety dostane každá kategorie typu 2 select „Financuje se z fondu"
s možnostmi `— nefinancuje se z fondu —` plus fondové účty. Uloží se přes `PATCH
/api/categories/:id`.

Po mutaci **refetch ze serveru**, ne lokální dopočet — `fund_account_id` ovlivňuje
server-počítané krytí (viz opakovaná chyba „UI si dopočítává server-počítaná pole").

## 7. Sdílený kód

Řetězení zůstatků od kotvy (`balances` mapa přes ABSOLUTNÍ `periodIndex`, dopočet oběma
směry) je dnes vnořené v `savings-history` v `src/routes/stats.js:429-465`. Vytáhne se
do `src/utils/balance-chain.js` jako čistá funkce:

```js
chainBalances({ anchorIndex, anchorBalance, fromIndex, toIndex, netAt })
  → Map<absIdx, number>
```

`netAt(absIdx)` je callback, takže si každý volající dodá vlastní způsob počítání
pohybů (spoření dedup nohou, fond prostý součet). Oba endpointy pak jedou přes tutéž
aritmetiku — jinak vzniknou dvě kopie netriviálního dopočtu, které se rozejdou.

`savings-history` se na helper přepojí; jeho chování se nesmí změnit (kryto stávajícími
testy).

## 8. Testy

**Backend:**

- `fund-coverage` — zbývá ignoruje položky s uplynulým oknem; `max(0, …)` u přečerpané
  položky nezáporné; kategorie s `fund_account_id = NULL` do součtu nevstoupí;
  kategorie odkazující na neexistující účet se chová jako NULL; případ Y_Lítačka
  (dvě položky, jedna zaplacená) vrátí zbytek druhé.
- `balance-chain` — dopočet oběma směry od kotvy; kotva mimo rozsah; prázdný rozsah.
- `fund-history` — 400 pro nefondový účet, pro cizí účet a pro chybný formát období;
  `balance: null` u fondu bez snapshotu; `values` má stejný tvar jako `savings-history`.
- `categories` — `PATCH` přijme fondový účet, odmítne nefondový i cizí, přijme `null`.
- **Regrese:** `savings-history` po přepojení na `balance-chain` vrací tatáž čísla.

**Klient:** čisté utility k výpočtu popisků krytí, pokud nějaké vzniknou. Stránka jako
taková je bez testu — repo nemá komponentní testy (známá mezera).

## 9. Mimo scope

- **Alerty a push notifikace** při poklesu pod krytí — stránka se otevírá ručně.
- **Vazba transakce → podpoložka**, která by odstranila omezení z §4.4.
- **Sledování zůstatku u nefondových účtů** (Společný, Hlavní) — krytí u nich nedává
  smysl a graf samotný je k ničemu.
- **Zpětné doplnění `balance_after`** — pokrytí je řídké (Nepravidelné 11 snapshotů ze
  71 transakcí) a chybějící historii už nelze rekonstruovat; kotva se posledním
  snapshotem stejně vždy srovná.
