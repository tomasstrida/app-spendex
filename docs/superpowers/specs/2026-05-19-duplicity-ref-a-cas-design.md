# Duplicity: AirBank ref číslo + čas transakce v řádku

**Datum:** 2026-05-19
**Stránka:** `client/src/pages/DuplicatesPage.jsx` + `src/utils/duplicates.js`
**Kontext:** Malá úprava existující featury „Hledáč duplicit" (v1.1.80). Řádek duplicity teď ukazuje `external_id` (kanonický `<ref>-<účet>`) a `created_at` (čas vložení do DB, UTC). Uživatel chce vidět i samotné AirBank ref číslo a skutečný čas transakce.

## Problém

1. Zobrazené `external_id` je kanonický tvar `156476455902-1679014138`; samotné AirBank ref číslo (`156476455902`) není přímo vidět, byť se používá k seskupení „Pravděpodobné".
2. Zobrazený čas je `created_at` = okamžik vložení řádku do DB (UTC, default `datetime('now')`), ne čas transakce v bance. Pro posouzení duplicity chybí skutečný čas platby (`tx_time`).

## Cíl

V řádku duplicity ukázat navíc **AirBank ref** (odvozené z `external_id` přes existující `rawRef()`) a **čas transakce `tx_time`** — obojí jako nové sloupce vedle stávajících, s jasnými popisky odlišujícími „vloženo do DB" vs „čas transakce".

## Rozhodnutí (potvrzeno uživatelem)

- **AirBank ref** se přidá *vedle* `external_id` (oba zůstanou — suffix `-účet` pomáhá rozlišit raw-vs-kanonický import-bug dup).
- **tx_time** se přidá *vedle* `created_at` (oba zůstanou — `created_at` je cenný signál importní dávky).

## Změny

### Backend — `src/utils/duplicates.js`

`findDuplicates` SELECT rozšířit o `t.tx_time`. Do každého řádku ve výsledku přidat odvozené pole `ref` přes existující `rawRef(r.external_id)` (funkce už v modulu je a je exportovaná). Tj. řádek bude mít navíc `ref` a `tx_time`. `wouldEmptyDuplicateGroup` a grouping logika **beze změny** (klíče zůstávají; `ref` je jen pro zobrazení).

> Pozn.: `rawRef` se už používá pro `probable` klíč; přidání `ref` do výstupu je jen zpřístupnění téhož uživateli, žádná nová logika.

### Frontend — `client/src/pages/DuplicatesPage.jsx`

V `GroupCard` v řádku transakce:
- Přidat sloupec **AirBank ref** = `row.ref` (vedle stávajícího `external_id`).
- Přidat sloupec **čas transakce** = `row.tx_time` (vedle stávajícího `created_at`).
- Záhlaví/popisky: aby bylo jasné co je co, doplnit nad seznam řádků skupiny řádek s popiskami sloupců (legenda), nebo `title` tooltipy. Zvolené řešení: malý hlavičkový řádek v kartě se jmény sloupců (datum · popis · částka · ref · external_id · zdroj · tx_time · vloženo), konzistentní vizuál (text-muted, fontSize 11–12), aby uživatel věděl, že poslední dva časy jsou „čas transakce" a „vloženo do DB (UTC)".

Zarovnání/šířky sloupců přizpůsobit (přibyly 2 sloupce) — drobné CSS inline úpravy v rámci existujícího flex řádku, beze změny `App.css`.

## Testy

`src/utils/duplicates.test.js`: doplnit asserci do existujícího `possible`/`probable` testu (nebo přidat krátký test), že vrácené řádky mají `ref` === `rawRef(external_id)` a obsahují `tx_time` (hodnota z vloženého řádku). Žádné nové chování grouping/pojistky → stávající testy musí dál procházet beze změny.

## Mimo rozsah (YAGNI)

- Žádná změna detekční/pojistkové logiky ani API kontraktu kromě přidání 2 polí do řádků.
- Žádné formátování/timezone konverze `tx_time`/`created_at` (zobrazit jak jsou; `tx_time` je z CSV string, `created_at` UTC string).
- Žádná konfigurovatelnost sloupců.

## Dopad / rizika

- Čistě aditivní (2 pole do řádků + 2 sloupce v UI). API tvar zpětně kompatibilní (přidaná pole).
- `tx_time` může být u některých řádků `null` (parser ho nemusí mít) → zobrazit `—`.
- `ref` je `null` jen když `external_id` je null (legacy) → zobrazit `—`.
