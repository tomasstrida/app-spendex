# Backup heartbeat monitoring (design)

**Datum:** 2026-06-08
**Stav:** Návrh schválen, čeká na implementační plán
**Backlog:** položka „Backup notifikace — heartbeat / dead man's switch" ([[spendex-backlog]])

## Cíl

Dnešní `sendBackupFailureAlert` se spustí jen když zálohovací job **proběhne a chytí
chybu**. Když umře celý cron / proces, žádný e-mail nepřijde = **tiché totální
selhání**. Cíl: odchytit i tento scénář a zároveň zrušit success-spam.

## Princip

- **Úspěšná záloha** → zapíše řádek do nové tabulky `backup_log`. **Žádný success
  e-mail** (zrušit `BACKUP_SUCCESS_EMAIL` flag i `sendBackupSuccessAlert`).
- **Selhání zálohy** → ponechat **okamžitý** `sendBackupFailureAlert` (rychlá
  signalizační cesta) + zapsat `failure` řádek do `backup_log` (audit trail).
- **Nový kontrolní cron (05:00, tj. 2 h po záloze)** → ověří, že v `backup_log`
  je `success` řádek z posledních `BACKUP_MAX_AGE_HOURS` (default 3). Pokud ne →
  **warning e-mail** `sendBackupMissingAlert`.

Defense in depth: okamžitý failure alert + denní heartbeat se doplňují.

## Komponenty

### `src/db/schema.js` — tabulka `backup_log`

```sql
CREATE TABLE IF NOT EXISTS backup_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  status        TEXT NOT NULL,            -- 'success' | 'failure'
  object_key    TEXT,                     -- R2 klíč (jen u success)
  size_bytes    INTEGER,                  -- velikost gzip (jen u success)
  pruned_count  INTEGER,                  -- kolik starých záloh smazáno (jen u success)
  error         TEXT,                     -- chybová hláška (jen u failure)
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_backup_log_created ON backup_log(created_at);
```

`created_at` je UTC (SQLite `datetime('now')`). Heartbeat dotaz porovnává časy
přímo v SQLite, takže žádná JS-timezone matika.

### `src/services/backupLog.js` (nový — testovatelný v izolaci)

```javascript
// recordBackup zapíše výsledek zálohy.
// status='success' → res = { key, sizeBytes, prunedCount }
// status='failure' → err = Error
function recordBackup(db, { status, res, err }) { ... }

// hasRecentSuccess: existuje úspěšná záloha v posledních maxAgeHours hodinách?
// SELECT 1 FROM backup_log WHERE status='success'
//   AND created_at >= datetime('now', '-<maxAgeHours> hours') LIMIT 1
function hasRecentSuccess(db, maxAgeHours) { ...returns boolean }

module.exports = { recordBackup, hasRecentSuccess };
```

Pozn.: `maxAgeHours` se do SQLite modifikátoru vkládá jako `'-' + Number(maxAgeHours) + ' hours'`
po číselné validaci (ne přímá interpolace uživatelského vstupu — hodnota jde z env,
ale stejně ji projedeme `Number()` a fallbackem na 3).

### `src/services/email.js`

- **Přidat** `sendBackupMissingAlert(maxAgeHours)` — předmět např.
  `⚠️ Spendex: nezaznamenána záloha DB`, tělo: za posledních N h nedorazila žádná
  úspěšná záloha; zkontroluj scheduler/Railway. Adresát: `BACKUP_ALERT_EMAIL`
  → fallback `tomas.strida@gmail.com` (shodně s failure alertem).
- **Odstranit** `sendBackupSuccessAlert` (a z exportů).

### `src/services/scheduler.js`

- `runBackupJob`:
  - po úspěchu: `recordBackup(db, { status: 'success', res })` — **bez** success
    e-mailu (smazat celý `BACKUP_SUCCESS_EMAIL` blok).
  - po selhání: `sendBackupFailureAlert(err)` (ponecháno) + `recordBackup(db,
    { status: 'failure', err })`.
- `runBackupCheckJob` (nový): `hasRecentSuccess(db, maxAge)` → pokud `false`,
  `sendBackupMissingAlert(maxAge)`; jinak nic (log).
- `startScheduler`: registruje **dva** crony — zálohu (`BACKUP_CRON`) a kontrolu
  (`BACKUP_CHECK_CRON`). Oba jen když `shouldSchedule()` (R2 env přítomné).

DB handle: scheduler získá singleton `require('../db/connection')` (stejně jako
`passport.js`). `createBackup` zůstává čistý (otevírá vlastní readonly snapshot DB),
logování jde mimo něj přes `backupLog`.

## Konfigurace (env, vše s defaulty)

| Env | Default | Význam |
|---|---|---|
| `BACKUP_CRON` | `0 3 * * *` | čas zálohy (stávající) |
| `BACKUP_CHECK_CRON` | `0 5 * * *` | čas heartbeat kontroly (nový) |
| `BACKUP_MAX_AGE_HOURS` | `3` | okno „čerstvé zálohy" (2 h po záloze + rezerva) |
| ~~`BACKUP_SUCCESS_EMAIL`~~ | — | **odstraněno** |

## Error handling

- `recordBackup` selhání (DB zápis) se loguje, ale nesmí shodit `runBackupJob`
  (záloha na R2 už proběhla — důležitější než log). Try/catch okolo.
- `sendBackupMissingAlert` selhání se loguje (jako stávající alert e-maily).
- Kontrolní cron běží jen při `shouldSchedule()` (R2 env). Bez R2 nemá co kontrolovat.

## Testy

- **`backupLog` (`recordBackup`)**: success řádek má status/object_key/size/pruned;
  failure řádek má status/error.
- **`backupLog` (`hasRecentSuccess`)**: true při čerstvém success; false když je
  jen starý success (>N h, vložený s explicitním `created_at`); false když je jen
  failure řádek.
- **Heartbeat rozhodnutí**: recent success → mailer nevolán; žádný → `sendBackupMissingAlert`
  volán (injektovaný fake mailer).

## Známé omezení (vědomé)

Kontrolní cron běží **ve stejném procesu** jako záloha — neochrání proti úplnému
pádu procesu / Railway (tehdy neběží ani záloha, ani kontrola). Pro tento scénář
by byl potřeba **externí monitor** (UptimeRobot / cron-job.org pingující healthcheck
endpoint). Mimo scope této položky.

## Mimo rozsah

- Externí monitor / healthcheck endpoint.
- UI pro prohlížení `backup_log` (stačí DB dotaz / Railway ssh).
- Změna samotného zálohovacího mechanismu (R2, retence) — beze změny.
