# Zálohy DB na Cloudflare R2 – design

**Datum:** 2026-06-03
**Status:** schváleno k implementaci
**Kontext:** Backlog položka 🔴 KRITICKÁ (eskalace 2026-05-24). Originální CSV výpisy nyní žijí pouze v DB (`csv_archive`). Bez off-site záloh hrozí ztráta celého archivu i transakční historie při selhání Railway volume.

## Cíl

Automatické denní zálohy hlavní databáze mimo Railway volume, s možností obnovy a upozorněním při selhání.

## Rozhodnutí (potvrzená s uživatelem)

| Téma | Volba |
|------|-------|
| Destinace | Cloudflare R2 (S3-kompatibilní API) |
| Frekvence | Denně, 03:00 Europe/Prague |
| Retence | 30 dní (starší se automaticky mažou) |
| Rozsah | Pouze `data.db` (ne `sessions.db` – jen přihlašovací cookies) |
| Šifrování | Bez klientského šifrování; spoléháme na R2 server-side encryption at-rest |
| Trigger | `node-cron` přímo v aplikaci (Railway běží 1 proces) |
| Obnova | Skript s dry-run defaultem + ostrá obnova pod `CONFIRM=1` |
| Alert | E-mail přes stávající Brevo službu při selhání zálohy |

## Architektura

Čtyři komponenty, každá s jednou odpovědností.

### 1. `src/services/backup.js` – jádro zálohování

Veřejné funkce:

- **`createBackup()`** → `Promise<{ key, sizeBytes, prunedCount }>`
  1. Vytvoří konzistentní snapshot pomocí `db.backup(tmpPath)` (better-sqlite3). Toto je jediný správný způsob při WAL módu – prostá kopie souboru za běhu by mohla být nekonzistentní.
  2. Zkomprimuje snapshot gzipem (`zlib.gzipSync` / stream) do `tmpPath.gz`.
  3. Nahraje na R2 pod klíčem `backups/data-YYYY-MM-DD-HHmmss.db.gz`.
  4. Zavolá `pruneOldBackups()`.
  5. Smaže temp soubory (i při chybě – `finally`).
  6. Jakákoli chyba → zavolá `sendBackupFailureAlert(err)` a chybu rethrowne (zaloguje se v scheduleru).

- **`pruneOldBackups()`** → `Promise<number>`
  - `ListObjectsV2` s prefixem `backups/`.
  - Smaže objekty starší než `RETENTION_DAYS` (30) podle `LastModified`.
  - Vrací počet smazaných.

- **`listBackups()`** → `Promise<Array<{ key, lastModified, sizeBytes }>>`
  - Pomocná funkce pro restore skript (seřazené sestupně dle data).

Interní: `getR2Client()` – lazy singleton `S3Client` z `@aws-sdk/client-s3`, konfigurovaný pro R2:
```
endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
region: 'auto'
credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
```

Datum/čas pro název objektu se generuje uvnitř funkce (`new Date()`), nikoli předává zvenčí.

### 2. `src/services/scheduler.js` – cron

- Exportuje `startScheduler()`.
- Pokud nejsou nastavené povinné R2 ENV (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`) → zaloguje varování a **nezaregistruje cron** (lokální dev tím pádem nezálohuje).
- Jinak `cron.schedule(BACKUP_CRON, runBackupJob, { timezone: 'Europe/Prague' })`.
- `runBackupJob()`: zavolá `createBackup()`, výsledek/chybu zaloguje. Chyba se nešíří dál (cron callback nesmí shodit proces); alert už odeslal `createBackup`.
- Volá se z `src/index.js` po `app.listen`.

### 3. `scripts/restore-backup.cjs` – obnova (destruktivní)

Spuštění: `node scripts/restore-backup.cjs [klíč]`

- Bez argumentu nebo `LIST=1`: vypíše dostupné zálohy přes `listBackups()` (klíč, datum, velikost).
- S klíčem v **dry-run** (default): stáhne objekt, rozbalí do temp, vypíše: zdrojový klíč, velikost, počet tabulek/řádků v záloze, kam by se zapsalo (`DB_PATH`). Nic nepřepíše.
- S klíčem a `CONFIRM=1`: 
  1. Vytvoří bezpečnostní kopii stávající `data.db` → `data.db.before-restore-<timestamp>`.
  2. Přepíše `data.db` rozbalenou zálohou.
  3. Vypíše potvrzení a cestu k bezpečnostní kopii.
- Respektuje pravidlo o destruktivních migracích: ostrá operace jen s explicitním `CONFIRM=1`.

### 4. `scripts/backup-now.cjs` – manuální trigger

- Spustí `createBackup()` ručně a vypíše výsledek.
- Účel: první ověření R2 přístupu před spoléháním na cron.

## E-mail alert

`sendBackupFailureAlert(err)` v `src/services/email.js` (nová funkce, využívá stávající `sendEmail`):
- Příjemce: `BACKUP_ALERT_EMAIL` (default `tomas.strida@gmail.com`).
- Předmět: `⚠️ Spendex: záloha DB selhala`.
- Tělo: timestamp, chybová zpráva a stack.

## ENV proměnné

| Proměnná | Povinná | Default | Popis |
|----------|---------|---------|-------|
| `R2_ACCOUNT_ID` | ano (prod) | – | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | ano (prod) | – | R2 API token – key ID |
| `R2_SECRET_ACCESS_KEY` | ano (prod) | – | R2 API token – secret |
| `R2_BUCKET` | ano (prod) | – | Název bucketu |
| `BACKUP_ALERT_EMAIL` | ne | `tomas.strida@gmail.com` | Kam posílat alert |
| `BACKUP_CRON` | ne | `0 3 * * *` | Cron výraz |
| `BACKUP_RETENTION_DAYS` | ne | `30` | Retence ve dnech |

Žádné secrets v repu – vše přes Railway ENV. `.env.example` se rozšíří o nové klíče (bez hodnot).

## Závislosti

- Nová: `@aws-sdk/client-s3` (S3-kompatibilní klient pro R2).
- Stávající využité: `node-cron` (už v deps), Brevo přes `src/services/email.js`, `better-sqlite3` `.backup()` API, `zlib` (Node core).

## Testy

Jednotkové testy na čistou logiku (S3 klient mockován):

- **pruneOldBackups**: dané pole objektů s `LastModified` → správně určí, které jsou starší než 30 dní a zavolá delete jen na ně.
- **název objektu**: formát `backups/data-YYYY-MM-DD-HHmmss.db.gz`.
- **gzip round-trip**: data → gzip → gunzip = původní data.
- **createBackup happy path**: `db.backup()` proti temp DB vytvoří validní SQLite soubor, který jde otevřít a má očekávané tabulky.
- **scheduler bez ENV**: `startScheduler()` nezaregistruje cron, jen zaloguje varování.
- **alert při chybě**: chyba v uploadu → `sendBackupFailureAlert` zavolán.

## Bezpečnostní úvahy

- R2 API token: scope omezit na konkrétní bucket, oprávnění jen Object Read & Write (žádné mazání bucketu, žádný admin). Mazání objektů (prune) Read&Write pokrývá.
- Data nejsou klientsky šifrovaná → kdokoli s R2 klíči vidí finance. Akceptováno pro osobní app; token držet jen v Railway ENV.
- Bucket musí být privátní (žádný veřejný přístup).

## Co je mimo scope (YAGNI)

- Zálohy `sessions.db`.
- GFS rotace (týdenní/měsíční vrstvy).
- Klientské šifrování.
- Automatické testování integrity restoru (restore se ověřuje manuálně přes dry-run).
- UI pro správu záloh (vše přes skripty/cron).
