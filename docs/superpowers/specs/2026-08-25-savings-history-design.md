# Vývoj spoření — historický pohled na spořicí účet

Datum: 2026-08-25
Stav: schváleno k implementaci

## Cíl

Nová sekce **„Vývoj spoření"** ukazuje dvě věci najednou:

1. **Přírůstek za období** — kolik se v každém období podařilo naspořit (vklady, výběry, čisté saldo).
2. **Zůstatek v čase** — jak naspořená částka roste.

Je to historický protějšek existující měsíční stránky „Spořicí účet" (`/savings`),
stejně jako je `/budget-history` protějškem `/budgets`.

Rozsah: **jen spořicí účet `1679014082/3030`** (konstanta `savingsAccount`
v `src/utils/recurring.js`). Zobecnění na výběr účtu není součástí této práce.

## Výchozí situace (ověřeno na produkčních datech 2026-08-25)

- Pohyby spořicího účtu existují **od 2024-01**, do 2026-06 ze zdroje `airbank` (CSV),
  od 2026-06 dál `airbank-email`.
- V datech jsou **obě nohy** interních převodů (noha na spořicím i noha na běžném účtu
  s protiúčtem spořicího). Dedup už řeší `/api/stats/overview`.
- Zůstatek účtu se nikde neukládá: `transactions` sloupec pro zůstatek nemá, CSV parser
  ho nečte a e-mailový parser větu o zůstatku ignoruje.
- `email_inbox.raw_text` se uchovává i pro řádky se `status='imported'`
  (364 řádků od 2026-06-07, z toho 11 zmiňuje spořicí účet) → snapshoty zůstatku
  jde doplnit zpětně.
- Poslední reálný zůstatek v datech: **111 878,44 Kč k 2. 8. 2026**.

## Rozhodnutí

| Otázka | Rozhodnutí |
|---|---|
| Co graf ukazuje | přírůstek za období **i** zůstatek v čase |
| Zdroj absolutního zůstatku | snapshoty z AirBank notifikací |
| Kotva dopočtené křivky | poslední reálný snapshot, zpětný dopočet do minulosti |
| Rozpad přírůstku | vklady / výběry / čisté saldo (úroky se neoddělují) |
| Neshoda dopočtu a skutečnosti | vykreslit **obě** křivky vedle sebe |
| Umístění | samostatná stránka `/savings-history`, položka menu pod „Vývoj výdajů" |
| Poslední období rozsahu | na rozdíl od Vývoje výdajů **včetně rozjetého aktuálního období**, vizuálně odlišeného |

## 1. Data — snapshoty zůstatku

### Schema

Nový sloupec v `transactions` (migrace na konec `initSchema()` v `src/db/schema.js`,
do stávajícího `try/catch` seznamu `ALTER TABLE`):

```
ALTER TABLE transactions ADD COLUMN balance_after REAL
```

Sémantika: **zůstatek účtu, ke kterému patří tato noha transakce** — tedy účtu
v `transactions.account_id`. U převodu Společný → Spořicí nesou obě nohy jiný zůstatek,
proto hodnota patří k transakci, ne k převodu.

### Parser

`src/utils/emailParser.js` doplní do vraceného objektu `balance_after`.

Zdrojová věta v notifikaci:

```
zůstatek na účtu Spořicí účet 1 číslo 1679014082/3030 se zvýšil o částku 100,00 CZK.
Dostupný zůstatek k 02.08.2026 v 14:12 je 111 878,44 CZK.
```

Parsuje se hodnota za „Dostupný zůstatek k … je" přes stávající `parseAmount`
(zvládá mezery jako oddělovač tisíců i desetinnou čárku). Když věta chybí nebo se
nepodaří převést na číslo, `balance_after` je `null` — parser nikdy neselže kvůli zůstatku.

Poznámka k přesnosti: jde o *dostupný* zůstatek, tedy po odečtení karetních blokací.
Na spořicím účtu se karty nepoužívají, takže rozdíl proti účetnímu zůstatku nevzniká.

### Ukládání

`balance_after` se zapisuje do transakce v obou cestách, kterými e-mailová platba
vzniká: automatický ingest (`src/services/emailIngest.js`) i ruční zařazení z fronty
(`src/routes/emailInbox.js`). Hodnota se veze v `parsed_json`, takže ruční cesta ji má
k dispozici bez opětovného parsování.

CSV import zůstatek nepřináší a nijak se nemění.

### Retro migrace

`scripts/migrate-balance-after.cjs` — projde `email_inbox` (všechny statusy),
z `raw_text` vyparsuje zůstatek a doplní ho k transakci spárované přes `external_id`.

- Výchozí režim je **dry-run** (vypíše, co by změnil, a nic nezapíše).
- Ostrý běh jen s `CONFIRM=1` a **výhradně po explicitním pokynu uživatele**.
- Idempotentní: přepisuje jen řádky, kde je `balance_after IS NULL`.

## 2. Backend

### Refaktor: `src/utils/savings.js`

Logika „co je pohyb na spořicím účtu" je dnes zapečená uvnitř `/api/stats/overview`
(`src/routes/stats.js`, cca řádky 85–165): hledání účtu přes `normCounterparty`,
párování obou nohou převodu v okně 3 dnů, příznak `external`, převod částky do pohledu
spořicího účtu. Nová stránka potřebuje totéž.

Vytáhne se beze změny chování do `src/utils/savings.js`:

```js
savingsMovements(db, userId, start, end) → {
  transfers,     // stejný tvar jako dnes stats.savings.transfers
  deposits,      // kladné pohyby z pohledu spořicího účtu
  withdrawals,   // absolutní hodnota záporných pohybů
  net,           // deposits − withdrawals
}
```

`/api/stats/overview` bude helper volat, jeho odpověď se nemění. Stávající testy
v `src/routes/stats.test.js` (sada testů „savings: …") refaktor hlídají — musí projít
beze změny.

Důvod: dvě nezávislé definice „co je vklad na spořicí" by se dřív nebo později rozešly
a Schůzka by ukazovala jiné číslo než graf.

### Endpoint `GET /api/stats/savings-history?from=YYYY-MM&to=YYYY-MM`

Hlavička a validace kopíruje `/budget-history`:

- Období přes `getPeriodDates(billingDay, key)`, ne kalendářní měsíce.
- `PERIOD_KEY_RE`, `MAX_PERIODS = 60`, chybové hlášky stejné.
- Výchozí rozsah: `from` z `defaultHistoryRange(currentPeriodKey(billingDay), 6)`,
  ale `to` = `currentPeriodKey(billingDay)` — na rozdíl od Vývoje výdajů se zobrazuje
  i rozjeté aktuální období. Výchozí rozsah je tedy o jedno období delší.
  Explicitní `from`/`to` z query se nikdy nepřebíjí.

Odpověď:

```jsonc
{
  "from": "2026-01", "to": "2026-08", "billing_day": 1,
  "periods": [{ "key": "2026-01", "start": "2026-01-01", "end": "2026-01-31", "partial": false }],
  "values": [{
    "period": "2026-01",
    "deposits": 25000,
    "withdrawals": 0,
    "net": 25000,
    "balance_derived": 98000,      // dopočtený zůstatek ke konci období
    "balance_actual": null,        // poslední reálný snapshot v období, jinak null
    "tx_ids": [1, 2, 3]
  }],
  "anchor": { "date": "2026-08-02", "balance": 111878.44 },   // null, když snapshot neexistuje
  "totals": { "deposits": 0, "withdrawals": 0, "net": 0 }
}
```

`partial: true` má období, které ještě neskončilo (`end` je v budoucnosti).

**`tx_ids`** je povinné: součty v grafu se počítají z dedupovaných pohybů, takže proklik
do Transakcí musí vrátit přesně ty transakce, ze kterých je součet — filtrování podle
data a účtu by vrátilo i zahozené druhé nohy převodů. Viz zavedený vzor u ostatních
JS-počítaných agregátů.

**Dopočtená křivka (`balance_derived`)**

- Kotva = poslední transakce se `balance_after IS NOT NULL` a `account_id` = spořicí účet,
  napříč celou historií (i mimo zobrazený rozsah).
- Zůstatek ke konci období, ve kterém kotva leží, se vezme z kotvy; do minulosti se
  netto pohyby postupně **odečítají**, do budoucnosti **přičítají**.
- Pozor: kotva nemusí být poslední transakce období — do konce období mohly přijít další
  pohyby. Zůstatek ke konci kotvícího období = `anchor.balance` + netto pohybů,
  které v tomtéž období nastaly po kotvě.
- Když kotva neexistuje (`anchor: null`), je `balance_derived` u všech období `null`.

**Skutečná křivka (`balance_actual`)**

- Poslední snapshot uvnitř období (podle `date`, `tx_time`, `id`), s `account_id` = spořicí.
- Období bez snapshotu má `null` — nic se nedomýšlí, linka se v grafu přeruší.
- Snapshoty z nohy na *jiném* účtu se ignorují: e-mail o odchozím převodu ze Společného
  nese zůstatek Společného a křivku spořicího by rozbil.

## 3. Frontend

Nová stránka `client/src/pages/SavingsHistoryPage.jsx`, routa `/savings-history`
v `App.jsx`, položka v `Sidebar.jsx` hned pod „Vývoj výdajů", text
`i18n.nav.savingsHistory = 'Vývoj spoření'`.

Struktura kopíruje `BudgetHistoryPage.jsx`: vlastní SVG (žádná grafová knihovna),
ovládání rozsahu období, přepínač graf/tabulka.

**Graf — dva panely pod sebou se společnou osou X**

Saldo se pohybuje v desítkách tisíc, zůstatek ve stovkách tisíc. Dvě škály v jednom
grafu zakazuje konvence zapsaná v `SpendLineChart.jsx` („jedna osa Y, nikdy dvě škály"),
a zdeformovaly by čtení obojího. Proto dva panely nad sebou, období lícují pod sebou:

- **Horní panel:** křivky zůstatku — dopočtená (plná) a skutečná ze snapshotů
  (přerušovaná, kreslí se jen mezi body, které existují).
- **Dolní panel:** sloupce čistého salda období (kladné nahoru zeleně, záporné dolů
  červeně), s vlastní osou Y a nulovou linkou.
- Hover nad obdobím zvýrazní totéž období v obou panelech.
- Legenda přepíná viditelnost sérií.
- Rozjeté období (`partial`) je vizuálně odlišené (světlejší sloupec + poznámka
  v popisku), aby se nečetlo jako propad ve spoření.
- Když `anchor` chybí, křivky se nekreslí a nad grafem je hláška, že zůstatek se doplní,
  jakmile dorazí notifikace ze spořicího účtu.

**Tabulka**

Sloupce: Období | Vklady | Výběry | Saldo | Zůstatek (dopočtený) | Zůstatek (skutečný).
Řádek Celkem / Průměr za zobrazený rozsah (u zůstatku průměr nedává smysl → prázdné).

**Prolinkování**

- Kliknutí na období → `/transactions?tx_ids=…` (parita se součtem v grafu).
- Odkaz na měsíční stránku „Spořicí účet" a zpětný odkaz z ní na „Vývoj spoření".

## Testy

Backend (`node --test 'src/**/*.test.js'` — pozor na uvozovky, `src/` samotné visí):

- `emailParser`: zůstatek se vyparsuje; věta chybí → `null`; formát s mezerami a čárkou.
- `savings.js`: přenesené testy dedupu procházejí přes nový helper.
- `savings-history` endpoint:
  - období se dělí podle `billing_day`, ne podle kalendáře,
  - dedup — převod s oběma nohama se počítá jednou,
  - zpětný dopočet od kotvy dá správný zůstatek pro předchozí období,
  - kotva uprostřed období → zůstatek ke konci období započítá i pozdější pohyby,
  - bez snapshotu je `anchor` null a `balance_derived` všude null,
  - snapshot z jiného účtu se do `balance_actual` nepromítne,
  - `tx_ids` odpovídá pohybům, ze kterých je součet.

Frontend: `npm run build` musí projít (lint sám nechytí `await` v ne-async callbacku).

## Co není součástí

- Zobecnění na výběr libovolného účtu.
- Oddělené vykazování úroků.
- Ruční zadávání počátečního zůstatku.
- Sledování Rezervy a účtu Nepravidelné.
- Čtení zůstatku z CSV exportu.
