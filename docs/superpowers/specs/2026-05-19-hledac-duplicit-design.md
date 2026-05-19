# Hledáč duplicitních transakcí

**Datum:** 2026-05-19
**Stránka:** nová „Duplicity" (sidebar), `client/src/pages/DuplicatesPage.jsx`
**Kontext:** Po chybném importu mohou v DB vzniknout duplicitní transakce. Bulk výběr+mazání už existuje (`TransactionsPage`, `DELETE /api/transactions {ids}`), chybí způsob jak duplicity **najít a předložit k revizi**.

## Problém

Duplicitní transakce z importní chyby nejde efektivně najít — uživatel by je musel hledat očima mezi stovkami řádků. Striktní shoda atributů navíc označí i legitimní stejnodenní platby (z incidentu: 20 „dup_groups" byly reálné různé transakce s různým `external_id`).

## Cíl

Samostatný triage nástroj, který kdykoli proskenuje celou DB uživatele, seskupí podezřelé duplicity ve dvou úrovních jistoty a nechá uživatele vybrat, které smazat — s pojistkou, že ve skupině vždy zůstane ≥1 řádek.

## Rozhodnutí (potvrzeno uživatelem)

- **Žádná admin role / RBAC** — 2 partneři, oba přihlášení = důvěryhodní. „Admin přístup" = nástroj uvnitř aplikace.
- **Dvě úrovně detekce jako dvě záložky.**
- **Stejné ref na různých účtech = legitimní interní převod → NEoznačovat.**
- **Skupina musí vždy mít ≥1 řádek** — vynuceno na serveru, ne jen v UI.
- Žádné auto-mazání; znovupoužití existujícího bulk-delete endpointu.

## Architektura

Frontend-heavy, minimální backend. Tři jednotky:

1. **`src/utils/duplicates.js`** — čistá funkce `findDuplicates(db, userId)`. Žádný Express, testovatelná nad tmp DB.
2. **`src/routes/transactions.js`** — nový `GET /api/transactions/duplicates` (tenký, deleguje na util). Bulk delete `DELETE /api/transactions {ids}` už existuje — rozšířit o serverovou pojistku „nech ≥1 ve skupině".
3. **`client/src/pages/DuplicatesPage.jsx`** + položka v sidebaru + routa v `App.jsx`.

## Detekce — `findDuplicates(db, userId)`

`external_id` je kanonicky `<rawRef>-<accountNumber>` (legacy řádky mohou být holý `<rawRef>`). Odvození rawRef: `v.includes('-') ? v.slice(0, v.lastIndexOf('-')) : v`.

Vrací `{ probable: Group[], possible: Group[] }`, kde
`Group = { key, rows: Row[] }` a
`Row = { id, date, description, amount, account_id, account_name, external_id, source, created_at }`.

- **probable** — skupiny ≥2 řádků se stejným `(rawRef, account_id)` a neprázdným `external_id`/rawRef.
  Klíč `rawRef|account_id`. Tím jsou dvě nohy interního převodu (stejný rawRef, **různý** account_id) v různých skupinách → samostatné, nikdy spolu → fakticky se neoznačí jako duplicita.
- **possible** — skupiny ≥2 řádků se stejným `(date, description, amount, account_id)`.
  Klíč `date|description|amount|account_id`.

Obě seřazená: skupiny dle `date` DESC, řádky ve skupině dle `id` ASC (nejstarší první). Jen `WHERE user_id = ?`.

> Pozn.: `possible` může obsahovat i legitimní stejnodenní platby — proto je to „možné", revize na uživateli. `probable` je po opravě `external_id` (v1.1.73) vzácné, ale chytá pre-fix zbytky a anomálie.

## Backend pojistka při mazání

**Pozor na regresi:** sdílený `DELETE /api/transactions {ids}` používá i `TransactionsPage` pro běžné hromadné mazání. Plošná pojistka „nech ≥1 ve skupině" by tam blokovala legitimní smazání dvou stejných plateb. Proto je pojistka **opt-in přes flag jen pro duplicates flow**:

`DELETE /api/transactions` přijme volitelně `{ ids, guardDuplicateGroups: true }`. Když je flag `true`:
- Server přepočítá `possible` skupiny (`date+description+amount+account_id`) jen pro transakce dotčené v `ids`.
- Pokud by pro některou skupinu byly v `ids` **všechny** její řádky (po smazání by nezůstal žádný), vrátí `400 { error: 'Ve skupině duplicit musí zůstat alespoň jedna transakce.' }` a nemaže nic (atomické, v transakci).
- Jinak smaže standardně.

Bez flagu (volání z `TransactionsPage`) se chování **nemění** — žádná regrese. `DuplicatesPage` flag vždy posílá.

> Skupina velikosti 1 (samostatný řádek bez dupla) flag neovlivní — projde i s flagem, protože „všechny řádky skupiny v ids" je triviálně 1 a smazání jediného člena samostatné skupiny je v duplicates kontextu nedosažitelné (UI tam takový řádek ani nenabízí).

## UI — `DuplicatesPage.jsx`

- Sidebar: nová položka „Duplicity" (ikona Lucide, např. `CopyX`/`Layers`), routa `/duplicates`.
- Dvě záložky: **Pravděpodobné** (probable) / **Možné** (possible) s počty skupin.
- Prázdný stav: „Žádné duplicity 🎉".
- Každá skupina = karta: hlavička (datum · částka · popis · účet · N×), pod ní řádky s checkboxem a sloupci `datum, popis, částka, účet, external_id, zdroj, vytvořeno`.
- Předvýběr: ve skupině zaškrtnuté všechny KROMĚ nejstaršího (`min id`) → uživatel ručně upraví.
- Pod seznamem lišta: „Vybráno k smazání: N" + „Smazat vybrané" → `confirm()` → `DELETE /api/transactions {ids}` → po úspěchu refetch.
- Chyba serveru (pojistka) → alert hláška, nic se nesmaže.
- Vizuální styl konzistentní s `TransactionsPage` (tx-checkbox, tx-bulk-bar, karty jako `report-section`).

## Testy

`src/utils/duplicates.test.js` (tmp DB, vzor dle `income.test.js`):
- interní převod (stejný rawRef, různé account_id) → NENÍ v `probable`.
- stejný rawRef + stejný account_id (2×) → JE v `probable`.
- stejné date+desc+amount+account (2×) → JE v `possible`; různé jen v amount → není.
- legacy holý `external_id` bez `-` → rawRef = celá hodnota.
- izolace per `user_id` (cizí uživatel se nemíchá).

Bulk-delete pojistka — test (tmp DB nebo extrahovaná čistá funkce `wouldEmptyAnyGroup(db,userId,ids)`):
- ids = celá 2členná skupina → odmítnuto (400), nic nesmazáno.
- ids = 1 ze 2 → povoleno.
- ids = samostatný řádek (skupina velikosti 1) → povoleno.

## Mimo rozsah (YAGNI)

- Admin role / oprávnění, audit log.
- Automatické mazání / „smazat všechny duplicity jedním klikem".
- Rollback importní šarže (uživatel zvolil jen hledáč).
- Sloučení/merge transakcí (jen mazání).
- Mazání mimo duplicitní skupiny (na to je TransactionsPage).

## Dopad / rizika

- `possible` má falešné poplachy (legitimní stejnodenní platby) — mitigováno tím, že je to „možné" + viditelné `external_id`/`source` pro rozhodnutí + pojistka ≥1.
- Detekce skenuje všechny transakce uživatele — pro řád ~1–2k řádků (aktuální prod) zanedbatelné; bez paginace (YAGNI).
- Žádná schema změna; znovupoužití bulk-delete endpointu.
