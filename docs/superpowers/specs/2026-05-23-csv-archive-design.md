# CSV archiv — Fáze 1

**Datum:** 2026-05-23
**Autor:** Tomas + Claude
**Status:** Schváleno (rozhodnutí 1a/2b/3a), čeká na implementační plán
**Souvislost:** Fáze 2 (auto-Příjmy + always-import) a Fáze 3 (zálohy DB) jsou samostatné specy, navazují.

## Problém

Spendex dnes při importu CSV z AirBank rozparsuje řádky do `transactions` a originální CSV zahodí. Pokud DB selže / je třeba něco vyšetřit / chybí historická data → originál není k dispozici.

Uživatel chce mít **kompletní data z banky navždy** uložená v původní podobě, oddělená od transakční tabulky. Současně to otevírá cestu pro budoucí archivaci OSVČ exportů (které dnes nejsou importované).

## Cíl

Při každém importu uložit originál CSV do trvalého archivu v DB. Nabídnout UI pro přehled archivu se stažením originálu a smazáním záznamu archivu.

**V scope:**
- Tabulka `csv_archive` v DB (SQLite TEXT sloupec s originálem).
- Při confirm importu se originál archivuje.
- Dedup podle SHA-256 hash souboru (per uživatel).
- Sekce „Archiv výpisů" dole na Import stránce — list + Stáhnout + Smazat.

**Mimo scope této fáze (řešíme později):**
- Auto-Příjmy a always-import (Fáze 2).
- Zálohy DB (Fáze 3, eskalace z backlogu).
- Rekonstrukce DB z archivu (deferred — YAGNI dokud nebude potřeba).
- UI pro `note` (sloupec existuje, ale není v UI).
- Samostatný OSVČ upload („jen archivovat") — OSVČ se řeší přes `accounts.role='ignored'`.

## Architektura

### DB tabulka `csv_archive`

```sql
CREATE TABLE IF NOT EXISTS csv_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'airbank',  -- 'airbank' | 'osvc' | 'other' (volný enum)
  account_id INTEGER,                      -- nullable, vazba na účet kam šel import
  uploaded_at TEXT DEFAULT (datetime('now')),
  content TEXT NOT NULL,                   -- originál CSV (UTF-8)
  file_hash TEXT NOT NULL,                 -- SHA-256 hex
  parsed_tx_count INTEGER DEFAULT 0,
  note TEXT,                               -- volné, UI zatím neexponuje
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
  UNIQUE(user_id, file_hash)
);
CREATE INDEX IF NOT EXISTS idx_csv_archive_user ON csv_archive(user_id);
```

Migrace v `src/db/schema.js` v `initSchema()` (existující pattern CREATE TABLE IF NOT EXISTS).

### Backend

**Změna existujícího `POST /api/import/confirm`:**

Payload se rozšíří o `raw_csv` (string — originální text souboru):

```js
{
  transactions: [...],
  category_map: {...},
  skip_incoming: true,
  account_id: 123,
  raw_csv: "...",        // ← nové
  filename: "Pohyby_X.csv", // ← nové
}
```

Po úspěšném importu (uvnitř `db.transaction`, po inserts):

```js
const hash = sha256(raw_csv);
db.prepare(`
  INSERT OR IGNORE INTO csv_archive
    (user_id, filename, source, account_id, content, file_hash, parsed_tx_count)
  VALUES (?, ?, 'airbank', ?, ?, ?, ?)
`).run(req.user.id, filename, resolvedAccountId, raw_csv, hash, imported);
```

`INSERT OR IGNORE` ošetří dedup: pokud hash už existuje pro daného uživatele, archiv se nezduplikuje. Import samotný proběhne normálně (dedup transakcí přes `external_id` je nezávislý).

Návratová hodnota confirm rozšířená o `archive_status`:
```js
{ imported, skipped, archive: 'new' | 'duplicate' }
```

**Nové endpointy:**

- `GET /api/import/archive` — seznam archivu pro uživatele:
  ```json
  [
    {
      "id": 1,
      "filename": "Pohyby_1679014082_202601.csv",
      "source": "airbank",
      "account_id": 69,
      "account_name": "Spořicí-účet-1",
      "uploaded_at": "2026-05-23 12:34:56",
      "parsed_tx_count": 47,
      "size_bytes": 8123,
      "file_hash": "abc123..."
    }, ...
  ]
  ```
  (Vrací metadata; `content` se neposílá v listě.)

- `GET /api/import/archive/:id/download` — vrátí raw CSV s `Content-Type: text/csv` a `Content-Disposition: attachment; filename="..."`. Ověří `user_id`.

- `DELETE /api/import/archive/:id` — smaže záznam archivu. Ověří `user_id`. **Nesmazává transakce** (rozhodnutí 3a).

Vše chráněné `requireAuth`. Modifikace + delete přes `writeLimiter`.

### Frontend (Import stránka)

**Nahrávání:**
- Frontend si při handleFiles už drží `file.text()` — uloží si ho do per-soubor objektu (`fileImports[i].rawCsv = text; fileImports[i].filename = file.name`).
- Při confirm posílá `raw_csv` a `filename` do confirm endpointu (sekvenčně per soubor, jako dnes).

**Nová sekce „Archiv výpisů" na konci stránky** (pod DONE blokem / vždy viditelná):
- Načte `GET /api/import/archive` při mountu (a po každém úspěšném importu / smazání).
- Tabulka:

| Soubor | Zdroj | Účet | Nahráno | #Tx | Velikost | Akce |
|---|---|---|---|---|---|---|
| Pohyby_X.csv | airbank | Spořicí-účet-1 | 2026-05-23 12:34 | 47 | 8 KB | ⬇ Stáhnout · 🗑 Smazat |

- Smazání s confirmem („Smazat záznam z archivu? Transakce zůstanou.").
- Stažení = `window.location = '/api/import/archive/:id/download'` (browser to zpracuje jako download).
- Prázdný stav: „Archiv je prázdný. Po prvním importu se sem ukládají originální CSV."

**Žádné jiné změny v Import flow** — auto-detekce účtu, mapování kategorií, dedup transakcí beze změny.

## Edge cases

- **Stejný hash, jiný název souboru:** dedup vyhrává (originál máme), jen jiné jméno. Frontend dostane `archive: 'duplicate'` → tichá zmínka v Done („originál již archivován"). Tx import normálně.
- **OSVČ accountu chybí v `accounts`:** confirm dnes blokuje import bez account_id. Beze změny — uživatel musí účet vytvořit (jako dnes), případně s rolí `ignored`. Archiv funguje.
- **Velký soubor:** CSV jsou typicky desítky KB, max stovky. Nelimituju ručně. Existující `express.text({ limit: '10mb' })` na preview pokrývá. Confirm bude `express.json` s default 100 KB — **zvýším limit confirm na 10 MB** pro `raw_csv` payload.
- **Manuálně přidané transakce:** mají `source='manual'`, žádný CSV. Nepatří do archivu. (Filtrováno tím, že archivujeme jen v confirm flow z import endpointu.)
- **Smazání účtu (`accounts.id`):** `ON DELETE SET NULL` na `account_id` — archiv zůstává, jen ztratí vazbu na konkrétní účet.

## Datová stopa

CSV ~ 10–100 KB/soubor. Při 24 souborech/rok (2 účty × 12 měsíců) ~ 2 MB/rok. Za 10 let ~ 20 MB. SQLite to bez problému unese. Backup DB (Fáze 3) chytne archiv jedním tahem.

## Bezpečnostní úvahy

- CSV obsahují čísla účtů, popisky transakcí, částky → stejná citlivost jako data v `transactions`. RLS per user_id (existující pattern). Žádné nové attack surface.
- Download endpoint MUSÍ ověřit, že záznam patří `req.user.id` (jinak IDOR).
- Hash je jen pro dedup, ne pro autentizaci — neslouží jako secret.

## Testovací scénář (ruční)

1. Nahraj AirBank CSV → confirm → v archivu se objeví záznam se správným hashem, počtem tx, účtem.
2. Nahraj stejné CSV znovu (i s jiným jménem) → import proběhne (tx už jsou v DB, takže skipped=N), archiv vrátí `duplicate`, žádný druhý záznam.
3. Stáhni archiv → dostaneš identický originál.
4. Smaž archiv → záznam zmizí, **transakce v DB zůstanou**.
5. Smaž účet → `account_id` v archivu se nastaví na NULL (nebo zůstane funkční, jen bez vazby).

## Rizika

- **Velikost confirm payloadu:** s `raw_csv` může mít confirm POST 100 KB+ per soubor. Nutné zvýšit `express.json` limit pro tento endpoint. (Adresováno výše.)
- **Bez záloh DB je archiv ohrožený.** Jakmile Fáze 1 půjde do produkce, doporučuju neodkládat Fázi 3 (zálohy). Backlog položka existuje.
- **Žádný backfill historie:** dosavadní importy nemají originál → archiv začne prázdný. Pokud uživatel chce historii, nahraje minulé CSV znovu (dedup transakcí zabrání duplicitě).
