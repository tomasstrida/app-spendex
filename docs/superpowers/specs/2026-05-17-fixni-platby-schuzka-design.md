# Fixní platby + přepracování stránky Schůzka — design

**Datum:** 2026-05-17
**Stav:** schváleno uživatelem (brainstorming), připraveno pro writing-plans

## 1. Cíl a kontext

Stránka „Měsíční schůzka" (`client/src/pages/ReportPage.jsx`) má dnes manuální sekci „Pevné výdaje" — seznam název+částka bez vazby na reálné transakce. Nelze ověřit, že fixní platba ten měsíc skutečně proběhla.

Tato featura slučuje původní backlog #1 (splátka RAV ve špatné kategorii) a #2 (Schůzka přehled) do jedné práce. Splátka auta není variabilní výdaj, ale fixní závazek → patří do trackeru fixních plateb, ne do progress baru.

Cíl: na měsíční Schůzce ověřit, že všech 5 sledovaných fixních plateb proběhlo ve správné výši, vidět skutečně nasporenou částku a kumulovaný zůstatek „Harmonické rezervy".

## 2. Rozsah (vstupní analýza, potvrzeno uživatelem)

### 2.1 Tracker fixních plateb (skupina A)

Matchování substring patternu na `transactions.description`, `amount < 0`, v daném období.

| Název (fixed_expenses) | Pattern | Očekávaná částka |
|---|---|---|
| Nájem Stodůlky | `JANA HRDLIČKOVÁ` | 38126 |
| Záloha energie PRE | `Pražská energetika` | 3500 |
| Splátka auta RAV4 | `Toyota Financial` | 13255 |
| Telefon T-Mobile | `T-Mobile` | 2590 |
| Internet Nordic | `Nordic Telecom` | 445 |

### 2.2 Spoření

Samostatný výpočet, ne kategorie. Netto převodů na účet `1679014082` za období:
`net = Σ |amount<0| (vklady) − Σ amount>0 (výběry)`.

### 2.3 Harmonická rezerva

Kumulativní zůstatek obálky `1679014066` do konce zvoleného období. Reálné výdaje z obálky (nájem, PRE) v datech nemají protistranu `1679014066`, proto rekonstrukce přes tracker:

```
rezerva(do end) =
    Σ |amount<0|  kde counterparty_account LIKE '1679014066%'   (vklady do obálky)
  − Σ |amount<0|  kde description LIKE '%JANA HRDLIČKOVÁ%'        (nájem)
  − Σ |amount<0|  kde description LIKE '%Pražská energetika%'     (PRE)
  − Σ  amount>0   kde counterparty_account LIKE '1679014066%'    (vratky)
  pro všechny transakce s date ≤ end
```

### 2.4 Mimo scope

- OSVČ odvody (ÚSSZ, Oborová zdravotní, FÚ, daně) — už dnes vyloučeno filtrem `accounts.role='spending'` ve `stats.js`.
- `Harmonicka - najem` (−45000) není výdaj, je to interní převod/obálka.
- `Mgr. Petr Hrdina` — nepravidelná frekvence → zůstává variabilní Terapie.
- Digitální předplatné NEpatří do trackeru — řeší se kategorizací (viz 5.2).
- Pattern `RAILWAY` se nepoužívá (kolize s jízdným).

## 3. Architektura (přístup C)

Editovatelný tracker zůstává v `fixed_expenses` tabulce/route/UI. Stabilní bankovní fakta (čísla účtů, tolerance) jsou config-as-code, ve stylu `scripts/seed/rules.js`. Stav se počítá při čtení, žádná denormalizace, žádný cron.

### 3.1 Schema změna

`src/db/schema.js`, konec `initSchema()`, `try/catch` blok dle konvence:

```sql
ALTER TABLE fixed_expenses ADD COLUMN match_pattern TEXT;
```

Jen jeden sloupec. Tolerance je globální konstanta (uživatel zvolil globálních ±5 %, ne per-řádek), proto NEní DB sloupec. `match_pattern = NULL` → řádek se chová jako dnešní legacy (jen očekávaná částka, bez stavu).

### 3.2 Config modul

Nový `src/utils/recurring.js` (vedle `period.js` — stejná doménová vrstva, runtime-dostupné pro `stats.js` a `fixed-expenses.js`):

```js
module.exports = {
  MATCH_TOLERANCE_PCT: 5,
  savingsAccount: '1679014082',
  reserveAccount:  '1679014066',
  reservePaidPatterns: ['JANA HRDLIČKOVÁ', 'Pražská energetika'],
};
```

## 4. Backend

### 4.1 `GET /api/fixed-expenses?period=` — rozšíření manuální větve

Accountová větev (`accounts.role='fixed'`) zůstává beze změny (mimo scope).

Pro každý manuální řádek s `match_pattern != NULL`, při zadaném `?period=`:

```
match: user_id, amount<0, date ∈ [start,end], description LIKE '%'||pattern||'%'
actual   = SUM(ABS(amount))
tx_count = COUNT(*)
status   = tx_count = 0                          → 'missing'
           expected ≤ 0                           → null (žádný stav)
           |actual − expected| / expected ≤ 0.05  → 'ok'
           jinak                                  → 'mismatch'
```

Tracker matchuje **bez** filtru `accounts.role='spending'` — nájem/RAV mohou být na ne-spending účtech a s filtrem by se nedetekovaly. Tracker se ptá „odešla tahle konkrétní platba", napříč všemi účty. `LIKE` se použije stejně jako ve stávajícím `scripts/lib/apply-rules.js` (konzistentní matching).

Přidaná pole do JSON řádku: `match_pattern`, `actual`, `tx_count`, `status`.

POST a PATCH `/api/fixed-expenses` přijmou volitelné pole `match_pattern` (trim, nullable string), aby šlo pattern editovat z UI.

### 4.2 `GET /api/stats/overview` — přidat `savings` a `reserve`

Do JSON response přibydou dva objekty (počítané dotazy nad `transactions`, uživatel + období z `getPeriodDates`):

```
savings = { deposits, withdrawals, net }
  counterparty_account LIKE '1679014082%', date ∈ [start,end]
  deposits    = Σ |amount| kde amount<0
  withdrawals = Σ  amount  kde amount>0
  net         = deposits − withdrawals

reserve = { balance }
  dle vzorce 2.3, date ≤ end (kumulativně, ne jen období)
```

## 5. Seed a kategorizace

### 5.1 `scripts/seed/fixed-expenses.js`

Nahradit celé pole skupinou A z tabulky 2.1, každý řádek s `match_pattern` a `sort_order` 1–5. Staré řádky (Y-Léky, Y-Lítačka, „Nájem + zálohy Stodola 45000", Spoření 25000, …) zaniknou — buď chybné (45000 odpovídala obálce, ne reálné platbě 38126), nebo patří jinam (Y-řádky jsou Typ 2 kategorie, Spoření je teď samostatný výpočet 2.2).

`scripts/rebuild.cjs` ř. 89: `INSERT INTO fixed_expenses` rozšířit o sloupec `match_pattern`.

### 5.2 `scripts/seed/rules.js` — kategorizace předplatného

Digitální předplatné NEpatří do trackeru, řeší se jako kategorie (rozhodnutí uživatele):

- `textOverrides` (L3) → kategorie **`Licence`** (Typ 2): `OPENAI`, `Google Workspace`, `DISCORD`, `NUELINK`, `OPUS CLIP`, `P.SKOOL.COM`
- `ČESKÁ TELEVIZE` → kategorie **`Pravidelné platby`** (rozhodnutí uživatele, ne Licence)
- `RAILWAY` se NEpřidává (kolize s jízdným)

### 5.3 RAV přepis kategorie

`textOverrides` (L3): `Toyota Financial` → kategorie **`Pravidelné platby`**. Tím se splní původní backlog #1 (RAV zmizí z „Auto Moto - PHM"). Ostatní tracker platby (nájem, PRE, T-Mobile, Nordic) si ponechají přirozenou kategorizaci — k potvrzení v review specu.

Tracker fixních plateb je jinak čistě čtecí — kromě tohoto explicitního RAV override nepřidává L3 patterny; matchuje jen pro výpočet stavu, kategorie ostatních transakcí se nemění.

## 6. Frontend (`ReportPage.jsx`)

Pořadí sekcí (šedé = beze změny):

1. Příjmy — beze změny
2. **Fixní platby** (přejmenováno z „Pevné výdaje") — tracker
3. Měsíční výdaje (Typ 1) — beze změny
4. Roční / sezónní (Typ 2) — beze změny (sem spadne digitální předplatné kategorizací)
5. Drahé věci (Typ 3) — beze změny
6. Graf výdajů — beze změny
7. **Spoření & rezerva** — nový blok
8. **Bilance** — přestrukturovaná

### 6.1 Sekce „Fixní platby" — varianta B

Řádek: ikona stavu vlevo (✅/⚠️/❌), název, očekávaná částka; u `mismatch` se dopíše odchylka textem (např. „+530 oproti plánu"), u `missing` text „chybí". Bez barevného pruhu — vizuálně klidné, konzistentní se stávajícími řádky rozpočtů (`report-budget-row`). Při `tx_count>1` doplnit počet plateb. Souhrnný řádek: „✅ N proběhly · ⚠️ M jiná částka · ❌ K chybí".

Zachovat CRUD (přidat/editovat/smazat) včetně pole `match_pattern` ve formuláři. Řádky bez patternu se zobrazí jako dnes (bez stavu).

### 6.2 Blok „Spoření & rezerva"

Dva řádky: „Skutečně nasporeno (za období)" = `savings.net` (zelená při +), „Harmonická rezerva (kumulativně)" = `reserve.balance`. Drobný popisek vysvětlující původ čísel.

### 6.3 Sekce „Bilance"

Rozpad (Příjmy / − Fixní platby / − Variabilní výdaje) zůstává **informativní**. Výsledný řádek se přejmenuje na „Skutečně nasporeno" a zobrazí `savings.net` — měřené netto převodů, NE dopočet `příjmy − fixní − variabilní`. Drobný popisek, že výsledek je měřená hodnota, ne aritmetický rozdíl rozpadu (rozpad a výsledek spolu záměrně matematicky nesedí).

## 7. Edge cases a error handling

- Víc shod v období → součet `ABS(amount)`, `tx_count>1`, stav podle součtu, UI zobrazí počet.
- `match_pattern = NULL` → žádný stav, legacy chování.
- `expected ≤ 0` → žádný stav (ochrana proti dělení nulou; POST už vyžaduje kladnou částku).
- Rezerva kumulativní `date ≤ end` přes celou historii.
- Backend nové dotazy jsou jen čtecí. Jediný nový write je volitelné `match_pattern` na stávajícím POST/PATCH.
- Frontend: chybí-li `savings`/`reserve` v response → default 0 / blok skrýt.

## 8. Testy

Styl `node:test` jako `scripts/seed/seed.test.js` a `scripts/lib/apply-rules.test.js`:

- Stav fixní platby: hraniční tolerance ±5 % (přesně 5 %, těsně nad), `ok`/`mismatch`/`missing`.
- Spoření netto = vklady − výběry.
- Rezerva kumulativně = vklady do obálky − nájem − PRE − vratky do `end`.
- Víc shod v období → součet.
- `match_pattern = NULL` → bez stavu.

## 9. Nasazení

Změny se šíří přes `scripts/rebuild.cjs` — destruktivní full rebuild (smaže a znovu naseeduje per-user data, re-importuje transakce, re-kategorizuje). Schema `ALTER TABLE` musí proběhnout před rebuildem; zajištěno, protože `schema.js` běží přes db singleton při startu i v rebuildu. Deploy dle CLAUDE.md workflow (staging → na pokyn main).

## 10. Otevřené body k potvrzení v review specu

1. RAV → `Pravidelné platby`: přepsat jen RAV, nebo i ostatní tracker platby pro konzistenci? (návrh: jen RAV)
2. Texty popisků na stránce (čeština, `i18n.js`) — finální znění při implementaci.
