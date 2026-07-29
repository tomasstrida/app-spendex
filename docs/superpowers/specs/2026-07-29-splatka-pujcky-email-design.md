# Splátka půjčky z e-mailové notifikace → Pravidelné platby

Datum: 2026-07-29

## Problém

AirBank posílá notifikaci o inkasní splátce půjčky v tomto tvaru:

```
zůstatek na účtu Tom - OSVC číslo 1679014031/3030 se snížil o částku 15 000,00 CZK. …

Pro úplnost uvádíme detaily této úhrady:

Splátka půjčky Půjčka 1
Částka: 15 000,00 CZK
Datum zaúčtování: 22.07.2026
Kód transakce: 164468245922
```

`parseEmailNotification` zná tři tvary detailu: „úhrada na účet/z účtu … číslo",
„Platba kartou v …" a „Snížení/Zvýšení částky blokace". Řádek `Splátka půjčky Půjčka 1`
nesedí na žádný z nich → parser vrátí `description=''`, `note=''`, `place=null`,
`counterparty_account=null`.

Důsledky:
- L3 textová kategorizace (`apply-rules`) matchuje `description + note + place` → nemá se čeho chytit.
- Fixní platby na Schůzce (`fixed-expenses`) matchují stejnou trojici → platba se nikdy nespáruje.
- Transakce spadne do review fronty s prázdným popisem.

## Řešení

### 1. Generický fallback v parseru

Poslední fallback, aktivní jen když jsou `description`, `place` i obě „Zprávy pro…" prázdné
(→ nulová regrese pro dnes rozpoznávané tvary):

1. Kotva `Pro úplnost uvádíme detaily…:`; úsek textu od ní po řádek `Kód transakce:`.
2. První neprázdný řádek úseku, který **není** ve tvaru `Klíč: hodnota`
   (vyřadí `Částka:`, `Datum zaúčtování:`, `Karta:`, `Variabilní symbol:`…).
3. Ten se stane `description`.

Když kotva chybí, fallback nesáhne nikam → chování zůstane jako dnes.

`tx_type` zůstává `null` — generický fallback nemá z čeho spolehlivě odvodit typ transakce.

**Proč generický a ne úzký regex na „Splátka půjčky":** stejnou třídou problému jsou
inkasa, poplatky a další typy bez protiúčtu. Jedna změna pokryje i budoucí neznámé tvary.

### 2. Kategorizační pravidlo

- `scripts/seed/rules.js`: nový `textOverride` `{ pattern: 'Splátka půjčky', category: 'Pravidelné platby' }`
  v sekci „Tracker fixních plateb".
- Idempotentní migrace v `schema.js`: doplní pravidlo do `category_rules` existujícímu
  uživateli, pokud tam pattern ještě není (seed se hotové sadě nepřesype — stejný postup
  jako u pravidla „TV poplatek").

Pattern je bez čísla půjčky → pokryje `Půjčka 1`, `Půjčka 2`, … jedním řádkem.
Kategorie `Pravidelné platby` je vyloučená z měsíčních budgetů
(`spending-filter.js`, `review.js`) → splátka nerozbije žádný teploměr.

Důsledek: L3 dostane shodu → `confident = true` → platba se zaúčtuje rovnou,
bez review fronty.

### 3. Schůzka

Bez zásahu do kódu. Uživatel si v Konfiguraci → Fixní platby založí řádek s
`match_pattern = 'Půjčka 1'` (ne `Splátka půjčky`, aby se víc půjček nesčítalo
do jednoho řádku). Stávající matcher přes `description LIKE` ho najde.

### 4. Retro migrace

`scripts/migrate-loan-payment-description.cjs` — `email_inbox` drží `raw_text` i po
zařazení, takže lze přeparsovat novým parserem:

- `status='imported'` → doplní `description` v `transactions` (párování přes `external_id`)
  a přeřadí kategorii podle pravidel,
- `status='pending'` → aktualizuje `parsed_json` a `suggested_category_id`.

Mění jen řádky, kde je dnes `description` prázdný a nový parser vrátí neprázdný.
Dry-run výchozí, ostro jen s `CONFIRM=1`.

## Testy

`src/utils/emailParser.test.js`:
- e-mail se splátkou půjčky 1:1 → `description = 'Splátka půjčky Půjčka 1'`,
  `amount = -15000`, `source_account = '1679014031/3030'`, `date = '2026-07-22'`
- regrese: kartová platba a převod se jménem protistrany fallbackem nezmění popis
- e-mail bez kotvy „Pro úplnost" → `description` zůstane prázdný

`src/utils/apply-rules.test.js`:
- transakce s popisem `Splátka půjčky Půjčka 1` → kategorie `Pravidelné platby`
