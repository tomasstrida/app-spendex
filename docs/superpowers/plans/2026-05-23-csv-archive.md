# CSV archiv (Fáze 1) – implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Při importu CSV uložit originální text souboru do nové DB tabulky `csv_archive`. Přidat sekci „Archiv výpisů" do Import stránky se stažením a smazáním.

**Architecture:** SQLite tabulka `csv_archive` s TEXT sloupcem pro originál + SHA-256 hash pro dedup. Backend rozšiřuje stávající `POST /api/import/confirm` (přijímá `raw_csv` + `filename`, archivuje po úspěšném importu) a přidává tři endpointy (GET list, GET download, DELETE). Frontend si drží raw text per soubor a posílá ho v confirm, plus nová sekce dole na Import stránce.

**Tech Stack:** SQLite (better-sqlite3), Express, Node crypto, React (Vite). Žádné nové dependence. Žádné FE testy (projekt nemá FE test framework — backend má `node --test` pro utils, ale pro tuhle změnu spoléháme na manuální ověření přes lokální dev + curl).

**Spec:** `docs/superpowers/specs/2026-05-23-csv-archive-design.md`

---

## File structure

**Vytvořit:** —

**Upravit:**
- `src/db/schema.js` — `CREATE TABLE csv_archive` + index.
- `src/routes/import.js` — JSON limit, rozšíření confirm, tři nové endpointy.
- `client/src/pages/ImportPage.jsx` — uložit raw text per soubor, poslat v confirm, sekce „Archiv výpisů" + handlery.

---

## Task 1: DB schema – tabulka `csv_archive`

**Files:**
- Modify: `src/db/schema.js`

- [ ] **Step 1: Přidej CREATE TABLE do `initSchema()`**

V `src/db/schema.js` najdi blok `CREATE INDEX IF NOT EXISTS idx_dup_dismiss_user ON duplicate_dismissals(user_id);` (poslední `CREATE INDEX` před uzávěrkou `\`\`\``). Hned před tento `CREATE INDEX` přidej:

```sql
    CREATE TABLE IF NOT EXISTS csv_archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'airbank',
      account_id INTEGER,
      uploaded_at TEXT DEFAULT (datetime('now')),
      content TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      parsed_tx_count INTEGER DEFAULT 0,
      note TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
      UNIQUE(user_id, file_hash)
    );
```

A přidej index hned za `idx_dup_dismiss_user`:

```sql
    CREATE INDEX IF NOT EXISTS idx_csv_archive_user ON csv_archive(user_id);
```

- [ ] **Step 2: Aplikuj migraci na lokální `data.db`**

```bash
cd /Users/tomas/app-spendex && node -e "require('./src/db/schema').initSchema(); console.log('ok');"
```

Expected output: `ok`

- [ ] **Step 3: Ověř, že tabulka existuje a má správné sloupce**

```bash
cd /Users/tomas/app-spendex && node -e "
const db=require('better-sqlite3')('data.db');
console.table(db.prepare('PRAGMA table_info(csv_archive)').all().map(c=>({name:c.name,type:c.type,notnull:c.notnull,dflt:c.dflt_value})));
console.log('indexes:', db.prepare('PRAGMA index_list(csv_archive)').all());
"
```

Expected: 10 sloupců (id, user_id, filename, source, account_id, uploaded_at, content, file_hash, parsed_tx_count, note), indexes obsahují UNIQUE constraint na (user_id, file_hash) + idx_csv_archive_user.

- [ ] **Step 4: Commit**

```bash
cd /Users/tomas/app-spendex && git add src/db/schema.js && git commit -m "feat: DB schema – tabulka csv_archive

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Backend confirm – přijmout `raw_csv` + archivovat, zvýšit JSON limit

**Files:**
- Modify: `src/routes/import.js`

- [ ] **Step 1: Přidej `crypto` import na vrch souboru**

V `src/routes/import.js` na řádku 1 přidej před `const express = require('express');`:

```js
const crypto = require('crypto');
```

- [ ] **Step 2: Zvyš JSON limit pro confirm endpoint**

Express používá globální `express.json()` (mountovaný v `src/index.js`), defaultní limit 100 KB nestačí pro raw CSV. Najdi řádek s definicí confirm endpointu:

```js
// POST /api/import/confirm
router.post('/confirm', requireAuth, (req, res) => {
```

a změň na:

```js
// POST /api/import/confirm
router.post('/confirm', requireAuth, express.json({ limit: '10mb' }), (req, res) => {
```

(Lokální middleware na této route přepíše globální limit jen pro tenhle endpoint.)

- [ ] **Step 3: Rozšiř handler o `raw_csv` + `filename` a archivaci**

V confirm handleru najdi destrukturaci `const { transactions, category_map = {}, skip_incoming = true, account_id = null } = req.body;` a změň na:

```js
  const { transactions, category_map = {}, skip_incoming = true, account_id = null, raw_csv = null, filename = null } = req.body;
```

V téže funkci, v `db.transaction(() => { ... })`, **na konec bloku** (po smyčce `for (const [abCat, catId] of Object.entries(category_map))`) přidej archivaci. Najdi:

```js
    // Ulož mapování pro všechny AB kategorie kde bylo přiřazení
    for (const [abCat, catId] of Object.entries(category_map)) {
      if (catId) upsertMapping.run(req.user.id, abCat, parseInt(catId));
    }
  })();
```

a přepiš na:

```js
    // Ulož mapování pro všechny AB kategorie kde bylo přiřazení
    for (const [abCat, catId] of Object.entries(category_map)) {
      if (catId) upsertMapping.run(req.user.id, abCat, parseInt(catId));
    }

    // Archivace originálu CSV (per soubor, dedup přes UNIQUE(user_id, file_hash))
    if (raw_csv && filename) {
      const hash = crypto.createHash('sha256').update(raw_csv).digest('hex');
      const result = db.prepare(`
        INSERT OR IGNORE INTO csv_archive
          (user_id, filename, source, account_id, content, file_hash, parsed_tx_count)
        VALUES (?, ?, 'airbank', ?, ?, ?, ?)
      `).run(req.user.id, filename, resolvedAccountId, raw_csv, hash, imported);
      archiveStatus = result.changes > 0 ? 'new' : 'duplicate';
    }
  })();
```

A nad `db.transaction(()...)` (po deklaracích `let imported = 0; let skipped = 0;`) přidej:

```js
  let archiveStatus = null; // 'new' | 'duplicate' | null (když chybí raw_csv)
```

A na konci handleru změň `res.json({ imported, skipped });` na:

```js
  res.json({ imported, skipped, archive: archiveStatus });
```

- [ ] **Step 4: Restart dev serveru (pokud běží) a manuálně ověř pomocí curl**

V jednom terminálu spusť backend:
```bash
cd /Users/tomas/app-spendex && npm run dev
```

V druhém terminálu otestuj (po přihlášení v prohlížeči si zkopíruj cookie z DevTools):

Pokud nemáš snadno přístup k cookie, přeskoč ručně-curl a ověř až ve Frontend tasku 4 přes prohlížeč.

Minimálně ověř, že server startuje bez syntax chyby:

```bash
cd /Users/tomas/app-spendex && node -c src/routes/import.js && echo "syntax OK"
```

Expected: `syntax OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/tomas/app-spendex && git add src/routes/import.js && git commit -m "feat: import confirm – archivuje raw CSV (SHA-256 dedup) + zvýšený JSON limit

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Backend archive endpoints – list, download, delete

**Files:**
- Modify: `src/routes/import.js`

- [ ] **Step 1: Přidej tři endpointy na konec souboru (před `module.exports`)**

V `src/routes/import.js` před řádek `module.exports = router;` (úplně dole) přidej:

```js
// GET /api/import/archive – seznam archivovaných CSV pro uživatele
router.get('/archive', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.filename, a.source, a.account_id, a.uploaded_at,
           a.file_hash, a.parsed_tx_count, LENGTH(a.content) AS size_bytes,
           acc.name AS account_name
    FROM csv_archive a
    LEFT JOIN accounts acc ON acc.id = a.account_id
    WHERE a.user_id = ?
    ORDER BY a.uploaded_at DESC, a.id DESC
  `).all(req.user.id);
  res.json(rows);
});

// GET /api/import/archive/:id/download – stáhne originál CSV
router.get('/archive/:id/download', requireAuth, (req, res) => {
  const row = db.prepare('SELECT filename, content FROM csv_archive WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${row.filename.replace(/"/g, '')}"`);
  res.send(row.content);
});

// DELETE /api/import/archive/:id – smaže záznam archivu (transakce zůstávají)
router.delete('/archive/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT id FROM csv_archive WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Záznam nenalezen.' });
  db.prepare('DELETE FROM csv_archive WHERE id = ?').run(row.id);
  res.json({ ok: true });
});
```

- [ ] **Step 2: Ověř syntax**

```bash
cd /Users/tomas/app-spendex && node -c src/routes/import.js && echo "syntax OK"
```

Expected: `syntax OK`

- [ ] **Step 3: Commit**

```bash
cd /Users/tomas/app-spendex && git add src/routes/import.js && git commit -m "feat: archiv CSV – endpointy GET list, GET download, DELETE

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Frontend – ImportPage si drží raw text + filename a posílá ho v confirm

**Files:**
- Modify: `client/src/pages/ImportPage.jsx`

- [ ] **Step 1: Při `handleFiles` ulož raw text a filename na každý fileImport objekt**

V `client/src/pages/ImportPage.jsx` najdi blok v `handleFiles`:

```jsx
      // Parsuj každý soubor zvlášť přes stávající preview endpoint
      const previews = [];
      for (const file of files) {
        const text = await file.text();
        const r = await fetch('/api/import/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: text,
        });
        const d = await r.json();
        if (!r.ok) { setError(`${file.name}: ${d.error}`); return; }
        previews.push(d);
      }
```

a změň na (přidání paralelního pole `rawTexts`):

```jsx
      // Parsuj každý soubor zvlášť přes stávající preview endpoint
      const previews = [];
      const rawTexts = [];
      for (const file of files) {
        const text = await file.text();
        rawTexts.push(text);
        const r = await fetch('/api/import/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: text,
        });
        const d = await r.json();
        if (!r.ok) { setError(`${file.name}: ${d.error}`); return; }
        previews.push(d);
      }
```

A v sestavení `imports` (kousek níže), přidej `rawCsv` a `filename` na každý objekt. Najdi:

```jsx
      const imports = previews.map((p, i) => {
        const detected = p.detected_account_ids || [];
        const byFilename = guessAccountByFilename(files[i].name, mergedAccounts);
        const accountId = byFilename ?? (detected.length === 1 ? detected[0] : null);
        const detectedIds = byFilename
          ? [...new Set([byFilename, ...detected])]
          : detected;
        return {
          name: files[i].name,
          transactions: p.transactions || [],
          detectedIds,
          accountId,
        };
      });
```

a změň na:

```jsx
      const imports = previews.map((p, i) => {
        const detected = p.detected_account_ids || [];
        const byFilename = guessAccountByFilename(files[i].name, mergedAccounts);
        const accountId = byFilename ?? (detected.length === 1 ? detected[0] : null);
        const detectedIds = byFilename
          ? [...new Set([byFilename, ...detected])]
          : detected;
        return {
          name: files[i].name,
          rawCsv: rawTexts[i],
          transactions: p.transactions || [],
          detectedIds,
          accountId,
        };
      });
```

- [ ] **Step 2: Pošli `raw_csv` a `filename` v confirm requestu**

V téže komponentě v `handleConfirm` najdi smyčku:

```jsx
      for (const f of fileImports) {
        if (!f.accountId) continue;
        const r = await fetch('/api/import/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactions: f.transactions,
            category_map: map,
            skip_incoming: skipIncoming,
            account_id: f.accountId,
          }),
        });
        const d = await r.json();
        if (!r.ok) { setError(`${f.name}: ${d.error}`); return; }
        imported += d.imported;
        skipped += d.skipped;
      }
```

a změň `body` na (přidání `raw_csv` + `filename`):

```jsx
      for (const f of fileImports) {
        if (!f.accountId) continue;
        const r = await fetch('/api/import/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactions: f.transactions,
            category_map: map,
            skip_incoming: skipIncoming,
            account_id: f.accountId,
            raw_csv: f.rawCsv,
            filename: f.name,
          }),
        });
        const d = await r.json();
        if (!r.ok) { setError(`${f.name}: ${d.error}`); return; }
        imported += d.imported;
        skipped += d.skipped;
      }
```

- [ ] **Step 3: Build pro kontrolu syntaxe**

```bash
cd /Users/tomas/app-spendex/client && npm run build
```

Expected: vite build success.

- [ ] **Step 4: Commit**

```bash
cd /Users/tomas/app-spendex && git add client/src/pages/ImportPage.jsx && git commit -m "feat: import – posílá raw CSV a filename do confirm (pro archivaci)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend – sekce „Archiv výpisů" na Import stránce

**Files:**
- Modify: `client/src/pages/ImportPage.jsx`

- [ ] **Step 1: Přidej import ikony `Download` z lucide-react**

V `client/src/pages/ImportPage.jsx` najdi import lucide:

```jsx
import { Upload, Check, AlertCircle, Plus, Pencil, Trash2, X } from 'lucide-react';
```

a změň na (přidej `Download`):

```jsx
import { Upload, Check, AlertCircle, Plus, Pencil, Trash2, X, Download } from 'lucide-react';
```

- [ ] **Step 2: Přidej state pro archiv a funkci `loadArchive`**

V `ImportPage` komponentě (uvnitř `export default function ImportPage() { ... }`) najdi blok useState:

```jsx
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();
```

a hned za něj přidej:

```jsx
  const [archive, setArchive] = useState([]);

  const loadArchive = useCallback(() => {
    fetch('/api/import/archive')
      .then(r => r.ok ? r.json() : [])
      .then(setArchive)
      .catch(() => setArchive([]));
  }, []);
```

A do importu z `'react'` (řádek 1) přidej `useCallback`:

```jsx
import { useState, useEffect, useRef, useCallback } from 'react';
```

- [ ] **Step 3: Načti archiv při mountu a po úspěšném importu**

V `ImportPage` najdi `useEffect`:

```jsx
  useEffect(() => {
    fetch('/api/categories').then(r => r.json()).then(setCategories);
    fetch('/api/accounts').then(r => r.json()).then(setAccounts);
  }, []);
```

a změň na:

```jsx
  useEffect(() => {
    fetch('/api/categories').then(r => r.json()).then(setCategories);
    fetch('/api/accounts').then(r => r.json()).then(setAccounts);
    loadArchive();
  }, [loadArchive]);
```

A v `handleConfirm`, po úspěšném importu (po `setResult({ imported, skipped });`), přidej `loadArchive();`. Najdi:

```jsx
      setResult({ imported, skipped });
      setStep(STEP.DONE);
```

a změň na:

```jsx
      setResult({ imported, skipped });
      loadArchive();
      setStep(STEP.DONE);
```

- [ ] **Step 4: Přidej handler na smazání archivu**

V `ImportPage` (vedle `reset` funkce, např. před `reset`) přidej:

```jsx
  async function handleDeleteArchive(item) {
    if (!confirm(`Smazat archiv „${item.filename}"? Transakce zůstanou.`)) return;
    try {
      const r = await fetch(`/api/import/archive/${item.id}`, { method: 'DELETE' });
      if (r.ok) loadArchive();
    } catch { /* tichá */ }
  }
```

- [ ] **Step 5: Vykresli sekci „Archiv výpisů" dole na Import stránce**

V `ImportPage` najdi konec `return (` JSX bloku — uzávěrku posledního STEP a `</Layout>`:

```jsx
      {/* STEP 3 — Výsledek */}
      {step === STEP.DONE && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 400 }}>
          <div className="alert alert-success">
            <strong>Import dokončen.</strong><br />
            Importováno: {result.imported} transakcí<br />
            Přeskočeno: {result.skipped} (duplicity / příchozí)
          </div>
          <button className="btn btn-primary" onClick={reset}>
            Importovat další soubor
          </button>
        </div>
      )}
    </Layout>
  );
}
```

a vlož sekci `Archiv výpisů` přímo před `</Layout>`:

```jsx
      {/* STEP 3 — Výsledek */}
      {step === STEP.DONE && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 400 }}>
          <div className="alert alert-success">
            <strong>Import dokončen.</strong><br />
            Importováno: {result.imported} transakcí<br />
            Přeskočeno: {result.skipped} (duplicity / příchozí)
          </div>
          <button className="btn btn-primary" onClick={reset}>
            Importovat další soubor
          </button>
        </div>
      )}

      {/* Archiv výpisů — vždy viditelný */}
      <section style={{ marginTop: 40 }}>
        <h2 className="page-title" style={{ fontSize: 18, marginBottom: 12 }}>Archiv výpisů</h2>
        {archive.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13 }}>
            Archiv je prázdný. Po prvním importu se sem ukládají originální CSV.
          </p>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text2)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Soubor</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Zdroj</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Účet</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Nahráno</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px' }}>#Tx</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px' }}>Velikost</th>
                  <th style={{ padding: '10px 12px' }} />
                </tr>
              </thead>
              <tbody>
                {archive.map(item => (
                  <tr key={item.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px', wordBreak: 'break-all' }}>{item.filename}</td>
                    <td style={{ padding: '8px 12px' }} className="text-muted">{item.source}</td>
                    <td style={{ padding: '8px 12px' }} className="text-muted">{item.account_name || '—'}</td>
                    <td style={{ padding: '8px 12px' }} className="text-muted">{item.uploaded_at}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{item.parsed_tx_count}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }} className="text-muted">
                      {(item.size_bytes / 1024).toFixed(1)} KB
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <a className="btn btn-ghost btn-icon" href={`/api/import/archive/${item.id}/download`}
                         title="Stáhnout originál CSV">
                        <Download size={14} />
                      </a>
                      <button className="btn btn-ghost btn-icon" onClick={() => handleDeleteArchive(item)}
                        title="Smazat z archivu (transakce zůstanou)">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Layout>
  );
}
```

- [ ] **Step 6: Build**

```bash
cd /Users/tomas/app-spendex/client && npm run build
```

Expected: vite build success.

- [ ] **Step 7: Commit**

```bash
cd /Users/tomas/app-spendex && git add client/src/pages/ImportPage.jsx && git commit -m "feat: Import – sekce „Archiv výpisů\" se stažením a smazáním

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Ruční ověření + push na staging

**Files:** —

- [ ] **Step 1: Spusť dev server lokálně**

```bash
cd /Users/tomas/app-spendex && npm run dev
```

V druhém terminálu:
```bash
cd /Users/tomas/app-spendex/client && npm run dev
```

(Pokud projekt má jediný dev příkaz, použij ten — viz CLAUDE.md.)

- [ ] **Step 2: Projdi scénář v prohlížeči**

1. Otevři `/import`. Sekce „Archiv výpisů" je viditelná dole, prázdná (nebo s tím, co je v lokální DB).
2. Nahraj jeden AirBank CSV → preview → vyber účet → confirm.
3. Po Done klikni „Importovat další soubor". Sekce „Archiv výpisů" obsahuje **nový záznam** se správným filename, account_name, count tx a velikostí.
4. Stáhni přes ikonu Download → prohlížeč stáhne originál CSV. Otevři ho — obsah je identický s tím, co jsi nahrál.
5. Nahraj **stejný CSV znovu** → import projde (skipped=N, imported=0), sekce archivu **nezískala druhý záznam** (dedup podle hash).
6. Smaž archivní záznam přes ikonu Trash → záznam zmizí z tabulky, ale **transakce v sekci Transakce zůstávají** (ověř na `/transactions`).
7. Nahraj **víc CSV najednou** (multi-file): v archivu přibydou všechny.

Pokud cokoli selže, vrať se k problémovému kroku, oprav, nový commit.

- [ ] **Step 3: Push na staging**

```bash
cd /Users/tomas/app-spendex && git push origin staging
```

Railway nasadí staging. Po deployi proveď stejný scénář na staging URL.

- [ ] **Step 4: Po úspěšném testu na stagingu počkej na uživatele pro merge do prod**

Sdělit uživateli číslo verze (z `package.json`) a žádost o pokyn k nasazení na produkci.

---

## Self-review notes

- **Spec coverage:**
  - Tabulka `csv_archive` → Task 1.
  - Archivace v confirm + JSON limit → Task 2.
  - Tři endpointy (GET list / download / DELETE) → Task 3.
  - Frontend posílá raw_csv + filename → Task 4.
  - UI sekce „Archiv výpisů" se stažením + smazáním → Task 5.
  - Dedup přes UNIQUE(user_id, file_hash) + INSERT OR IGNORE → Task 1 + Task 2.
  - `note` jen DB field, žádné UI → Task 1 ano, Task 5 nezahrnuje → OK.
  - Smazání archivu nemaže transakce → Task 3 (jen DELETE z `csv_archive`), Task 5 confirm text.
  - Manuální scénář (vč. dedup + dedup neduplikuje archiv) → Task 6 step 2.
  - Pokryto.

- **Placeholder check:** žádné TBD/TODO. Veškerý kód v krocích je konkrétní.

- **Type consistency:** field `archiveStatus` (backend) je vrácen jako `archive` v JSON, frontend zatím nezobrazuje (spec mluví o tiché zmínce — necháváme jako informaci v response, UI pozdější iterace; archiv se zaktualizuje přes `loadArchive()` v Done po importu). Žádná inconsistency.

- **Rizika:**
  - `express.json({ limit: '10mb' })` musí být uvnitř route handleru, jinak nepřepíše globální parser. (Task 2 step 2 to dělá správně — middleware před handlerem.)
  - Filename v `Content-Disposition` může obsahovat nestandardní znaky (české diakritiky). Pro jednoduchost necháváme jak je; moderní prohlížeče to zvládnou (jen escapuju uvozovky). Pokud někdy bude problém, použít RFC 5987 `filename*=`.
  - `LENGTH(content)` v SQLite vrací počet bytů (pro TEXT je to znaky? — v SQLite `LENGTH()` na TEXT je počet znaků, ne bajtů; `LENGTH(CAST(content AS BLOB))` by dal bajty). Pro účely UI „velikost v KB" stačí znaky / 1024 (pro ASCII identické, pro UTF-8 podhodnocené o ~10 %). Akceptovatelné.
