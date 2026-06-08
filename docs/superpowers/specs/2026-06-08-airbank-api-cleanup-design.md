# AirBank API cleanup (design)

**Datum:** 2026-06-08
**Stav:** Návrh schválen, čeká na implementační plán
**Backlog:** „AirBank API integrace — z velké části obsolete" ([[spendex-backlog]])

## Cíl

Odstranit mrtvý kód po staré přímé AirBank API integraci (OAuth auto-pull), kterou
nahradil e-mailový import. Inventář (ověřeno grepem) ukázal, že jediné reálně mrtvé
artefakty jsou tabulka `airbank_tokens` a dva env placeholdery — nic z toho se nikde
nečte ani nezapisuje.

## Co je MRTVÉ (odstranit)

1. **Tabulka `airbank_tokens`** — `src/db/schema.js` (`CREATE TABLE IF NOT EXISTS
   airbank_tokens ...`, ~ř. 57–66). Jediný výskyt v celém repu; žádné READ/WRITE.
2. **Env `AIRBANK_CLIENT_ID` / `AIRBANK_CLIENT_SECRET`** + komentář „# Air Bank API"
   — `.env.example` (~ř. 21–23). V kódu nikde nereferencované.

## Co ZŮSTÁVÁ (nedotýkat se)

Veškerá „AirBank" logika kromě OAuth je živá — není to API integrace, je to
zpracování bankovních dat:
- `src/utils/csvParser.js` (`parseAirBankCSV`), `src/utils/emailParser.js`,
  `src/utils/externalId.js`
- `src/services/emailIngest.js`, `src/routes/emailInbound.js`, `src/routes/emailInbox.js`,
  `src/routes/import.js`
- tabulky `airbank_category_mappings`, `email_inbox`; sloupce `ab_category`, `tx_time`,
  `tx_type`, `counterparty_account`, `entered_by`, `place`
- frontend `ImportPage.jsx`, `SettingsPage.jsx` (mappings), `TransactionsPage.jsx`
- `scripts/seed/rules.js` (`abCategoryMap`)
- Cloudflare Email Worker

## Řešení

1. **schema.js:** odebrat `CREATE TABLE IF NOT EXISTS airbank_tokens (...)` z hlavního
   bloku.
2. **schema.js migrace:** přidat `'DROP TABLE IF EXISTS airbank_tokens'` do pole
   migrací (try/catch loop). Důvod: aktivně smazat tabulku i ze stávajících
   prod/staging DB **včetně případných zbylých OAuth tokenů** (security cleanup).
   Na čerstvé DB no-op. Pořadí: DROP běží v migracích po hlavním CREATE bloku, takže
   i kdyby někdo měl starší `CREATE` v historii, výsledný stav je „tabulka neexistuje".
3. **.env.example:** odebrat řádky `# Air Bank API`, `AIRBANK_CLIENT_ID=`,
   `AIRBANK_CLIENT_SECRET=`.
4. **Railway (mimo kód, ruční):** smazat `AIRBANK_CLIENT_ID` a `AIRBANK_CLIENT_SECRET`
   z prod i staging env přes railway CLI (`railway variables delete`).

## Testy

- Nový test (rozšířit/ přidat do `src/db/schema.test.js` nebo nový soubor): po
  `initSchema()` tabulka `airbank_tokens` **neexistuje**
  (`SELECT name FROM sqlite_master WHERE type='table' AND name='airbank_tokens'` → prázdné).
- Celá sada `node --test 'src/**/*.test.js'` musí zůstat zelená (105/105).

## Mimo rozsah

- Jakákoliv změna živých flow (CSV/email import, kategorizace, dedup).
- Odstranění `airbank_category_mappings` nebo `ab_category` — to NENÍ API, zůstává.
