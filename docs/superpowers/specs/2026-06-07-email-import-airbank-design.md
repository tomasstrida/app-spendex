# Import transakcí z e-mailových notifikací AirBank

**Datum:** 2026-06-07
**Stav:** návrh (schválený k sepsání plánu)

## Cíl

Umožnit, aby se transakce do Spendexu dostávaly automaticky z notifikačních
e-mailů AirBank (banka posílá e-mail při každém pohybu na účtu), jako rychlejší
alternativa ke zdlouhavému ručnímu CSV importu. AirBank API nefunguje, CSV je
dnes jediná cesta.

E-mailový import **nenahrazuje** CSV import — oba běží souběžně a deduplikují se
navzájem (viz `external_id`). CSV zůstává jako autoritativní/úplný zdroj
(obsahuje `ab_category`), e-mail je rychlá průběžná cesta.

## Kontext: dnešní CSV import

- `src/utils/csvParser.js` — parsuje AirBank CSV na strukturu transakce.
- `src/routes/import.js` — preview + confirm flow, dedup, kategorizace, INSERT.
- `src/utils/externalId.js` — staví kanonické `external_id` = `<ref>-<číslo_zdrojového_účtu>`.
- `src/utils/apply-rules.js` — kategorizace L0 (interní převody) > L3 (textové patterny) > L1 (účetní pravidla) > L2 (AirBank kategorie) > fallback "Ostatní".
- `transactions` má UNIQUE `(user_id, external_id)` → `INSERT OR IGNORE` brání duplicitám.

## Co e-mail obsahuje (ověřeno na reálném vzorku)

Vzorek (odchozí převod):

```
zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 10,00 CZK.
Dostupný zůstatek k 07.06.2026 v 17:47 ...
Odchozí úhrada na účet Tomáš Střída číslo 1679014138/3030
Částka: 10,00 CZK
Datum zaúčtování: 07.06.2026
Zpráva pro plátce: test 10 Kč
Kód transakce: 160610143222
```

Mapování na pole transakce:

| Pole | Zdroj v e-mailu | Pozn. |
|------|-----------------|-------|
| zdrojový účet | „na účtu … číslo `1679014023/3030` se snížil" | explicitní — spolehlivější než CSV auto-detekce |
| `amount` + směr | „**snížil** o částku 10,00" = výdaj `-` / „**zvýšil**" = příjem `+` | |
| `description` + `counterparty_account` | „na účet **Tomáš Střída** číslo **1679014138/3030**" | |
| `note`/`message` | „Zpráva pro plátce/příjemce: …" | |
| `date` | „Datum zaúčtování: 07.06.2026" | |
| `tx_time` | „v 17:47" | čas zůstatku ≈ čas tx |
| `external_id` | „Kód transakce: 160610143222" | přes `externalId.js` |

**Ověřená shoda dedup:** „Kód transakce" v e-mailu = „Referenční číslo" v CSV
(`160610143222`). Pokud se `external_id` z e-mailu staví stejně jako v CSV
(`<ref>-<zdrojový účet>`), **deduplikace funguje napříč oběma cestami**.

**Co v e-mailu CHYBÍ oproti CSV:**

- `ab_category` — NENÍ → L2 kategorizace z e-mailu odpadá. Zůstává L0/L1/L3 +
  fallback „Ostatní". Větší podíl ručního dozařazení (řeší review fronta).
- `place`, `tx_type`, `entered_by` — nepovinné.

**Pozn. k interním převodům:** mají dvě nohy s různými kódy (příchozí
`160610225122`, odchozí `160610143222`), každá noha = vlastní e-mail. `externalId.js`
to už řeší suffixem účtu.

## Architektura

```
AirBank ──► Gmail (Tomáš) ──auto-forward──► inbox@spendex.uk
                                                 │  (MX na Cloudflare)
                                                 ▼
                                  Cloudflare Email Worker  (~30 řádků JS, zdarma)
                                   │  ověří odesílatele (whitelist), zabalí do JSON
                                   ▼  fetch POST + secret
                          POST /api/email/inbound  (Spendex, Railway)
                                   │
                          [3 vrstvy ochrany]
                                   │
                          [emailParser: sada matcherů]
                                   │
                          external_id (ref + zdroj. účet)  ── stejný jako CSV → dedup
                                   │
              ┌────────────────────┼─────────────────────┐
              ▼                     ▼                      ▼
        pravidlo L0/L1/L3    spadlo by do          parse selhal /
        zabralo              "Ostatní"             neznámý formát
              │                     │                      │
              ▼                     ▼                      ▼
        transactions         email_inbox            email_inbox
        (rovnou)             (pending)              (unparsed, raw)
```

### Příjem e-mailu: Cloudflare Email Routing + Email Worker

Zvoleno pro nulové náklady (100 000 requestů/den zdarma — de facto neomezené)
a žádnou třetí stranu kromě Cloudflare, kde stejně poběží DNS pro `spendex.uk`.

- MX záznam `spendex.uk` → Cloudflare Email Routing.
- Email Worker (JS) zachytí příchozí e-mail, ověří odesílatele a `fetch` POST na
  Spendex webhook se sdíleným secretem.
- Worker žije mimo hlavní repo (návrh: `infra/cloudflare-email-worker/`),
  nasazuje se přes Cloudflare dashboard / Wrangler.

Trade-off: jedna komponenta navíc (Worker) výměnou za 0 Kč navždy. Část
bezpečnosti (whitelist) se odbaví už ve Workeru → na Spendex dorazí jen ověřené
e-maily.

### Bezpečnost: 3 vrstvy

1. **Webhook secret** — Worker volá Spendex s `EMAIL_WEBHOOK_SECRET`; bez něj
   endpoint nereaguje (zabrání přímému POST útočníka na veřejný endpoint).
2. **Whitelist odesílatele** — envelope sender = `EMAIL_ALLOWED_SENDER` (tvoje
   Gmail adresa) **a zároveň** původní `From` obsahuje `airbank.cz`.
   POZOR: Gmail auto-forward zachová `From: info@airbank.cz`, tvoje adresa je v
   obálce (envelope/`Return-Path`) → whitelist čte envelope sender, ne `From`.
   `From` lze podvrhnout, proto sám o sobě nestačí.
3. **Strukturální validace** — tělo musí odpovídat AirBank notifikaci (obsahuje
   „Kód transakce", částku). Co nesedí → `unparsed`, ne do dat.

## Komponenty

### `emailParser.js` (`src/utils/`)

Vrací stejnou strukturu transakce jako `csvParser.js`, aby navázala existující
pipeline. Extrakce regexy na české fráze (viz tabulka mapování výše).

**Robustnost — sada matcherů:** parser je seznam matcherů, každý umí jeden
formát e-mailu (odchozí převod, příchozí převod, později karetní platba u
obchodníka, výběr z bankomatu, poplatek). Zkouší se postupně.

**Co žádný matcher nerozpozná nebo z čeho nejde vytáhnout částku/kód, se
NEZAHODÍ** — uloží se jako `unparsed` do `email_inbox` s celým raw textem.
Uživatel to vidí, pošle vzorek, parser se rozšíří. Žádná tichá ztráta dat.

MVP pokryje formát převodu (máme vzorek). Další formáty inkrementálně.

### `emailInbound.js` (`src/routes/`)

Webhook endpoint `POST /api/email/inbound`:

1. Ověří secret a whitelist (vrstvy 1–2).
2. Zavolá `emailParser`.
3. Postaví `external_id` přes `externalId.js`.
4. Hybrid routing:
   - parse OK + `apply-rules` vrátí jistou kategorii (L0/L1/L3) → `INSERT OR
     IGNORE` rovnou do `transactions` (`source = 'airbank-email'`).
   - parse OK + fallback „Ostatní" → `email_inbox` status `pending`.
   - parse selhal / neznámý formát → `email_inbox` status `unparsed` (raw text).
5. Dedup: pokud `external_id` už v `transactions` existuje, položka se zahodí
   (idempotence při opakovaném doručení e-mailu).

Znovupoužívá `externalId.js`, `apply-rules.js` a INSERT logiku z `import.js`
(refaktorovat sdílenou část do utilu, ať se neduplikuje).

### `email_inbox` (nová tabulka)

```
email_inbox
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  received_at TEXT,
  raw_text TEXT,                 -- celý e-mail (audit + rozšiřování parseru)
  parsed_json TEXT,              -- naparsovaná transakce (NULL u unparsed)
  external_id TEXT,              -- dedup vůči už importovaným
  suggested_category_id INTEGER,
  status TEXT,                   -- 'pending' | 'unparsed' | 'imported' | 'rejected'
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id),
  FOREIGN KEY (suggested_category_id)
```

`transactions` se NEMĚNÍ (znovupoužití). Migrace: `CREATE TABLE` na konci
`initSchema()` v `schema.js` (konvence projektu, žádný framework).

### UI

Nová sekce na stávající `ImportPage.jsx` (nahoře, nad CSV uploadem — import na
jednom místě):

- **Badge s počtem** čekajících položek.
- **Pending seznam:** datum · částka · popis · dropdown s navrženou kategorií →
  tlačítka **Zařadit** / **Smazat**. Jeden klik = `INSERT` do `transactions` +
  označení položky `imported`.
- **Unparsed seznam:** zobrazí raw e-mail, možnost ručně doplnit nebo smazat.

Backend route pro frontu (`src/routes/`): list pending/unparsed, akce
zařadit/smazat.

### Env proměnné (Railway, nikdy do gitu)

- `EMAIL_WEBHOOK_SECRET` — sdílené tajemství Worker ↔ Spendex.
- `EMAIL_ALLOWED_SENDER` — Gmail adresa pro whitelist.

## Multi-user

E-maily chodí z Tomovy schránky → vše se přiřadí k jeho `user_id`. Účet se
napáruje podle čísla zdrojového účtu na existující účty uživatele. Martin
případně později vlastní adresu/forward (mimo scope tohoto návrhu).

## Testování

- `emailParser.test.js` — fixture e-maily (odchozí převod, příchozí; karetní
  později), kontrola všech polí.
- **Kritický test:** stejná transakce z e-mailu i z CSV → **identický
  `external_id`** → `INSERT OR IGNORE` zabrání duplicitě. Pojistka koexistence.
- Webhook: chybný/chybějící secret → odmítnuto; e-mail mimo whitelist → zahozeno.
- Hybrid routing: jistá kategorie → `transactions`; fallback → `email_inbox`.
- Idempotence: opakované doručení téhož e-mailu nevytvoří duplicitu.

## Rozsah MVP vs. později

**MVP:**
- Cloudflare Email Worker + webhook endpoint + 3 vrstvy ochrany.
- `emailParser` pro formát převodu (odchozí + příchozí).
- `email_inbox` + hybrid routing.
- UI sekce na ImportPage (pending + unparsed).

**Později (inkrementálně podle reálných e-mailů):**
- Další matchery: karetní platba u obchodníka, výběr z bankomatu, poplatek.
- Případně vlastní forward adresa pro Martina.

## Shrnutí nových/změněných komponent

| Soubor | Účel |
|--------|------|
| `infra/cloudflare-email-worker/` | Email Worker: příjem, whitelist, forward (mimo hlavní app) |
| `src/routes/emailInbound.js` | webhook endpoint, 3 vrstvy ochrany, hybrid routing |
| `src/utils/emailParser.js` | parsování těla e-mailu (sada matcherů) |
| `email_inbox` (schema.js) | review fronta |
| route + sekce v `ImportPage.jsx` | UI fronty + obsluha zařazení |
| `externalId.js`, `apply-rules.js`, INSERT z `import.js` | znovupoužito (sdílený util) |
