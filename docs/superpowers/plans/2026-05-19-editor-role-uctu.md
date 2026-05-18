# Editor role účtu v Importu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Umožnit změnu role vybraného účtu přímo v Importu (frontend-only, backend PATCH už existuje).

**Architecture:** Do `AccountSelector` v `client/src/pages/ImportPage.jsx` přidat role `<select>` pro vybraný účet, který volá `PATCH /api/accounts/:id` a promítne změnu do `accounts` stavu přes nový `onUpdated` callback.

**Tech Stack:** React + Vite, žádný backend zásah, žádné testy (projekt nemá JSX/route testy; ověření = Vite build).

**Spec:** `docs/superpowers/specs/2026-05-19-editor-role-uctu-design.md`

---

### Task 1: Role editor v AccountSelector

**Files:**
- Modify: `client/src/pages/ImportPage.jsx` (komponenta `AccountSelector` ~ř. 19–130, a `ImportPage` ~ř. 132+)

- [ ] **Step 1: Přidat `onUpdated` prop a stav do `AccountSelector`**

V signatuře `AccountSelector` přidat `onUpdated` k props (vedle `onCreated`). Přidat lokální stav:

```jsx
  const [savingRole, setSavingRole] = useState(false);
  const [roleErr, setRoleErr] = useState('');
```

(`useState` už je v souboru importován — ověřit; pokud ne, doplnit do importu z 'react'.)

- [ ] **Step 2: Přidat handler změny role v `AccountSelector`**

Uvnitř `AccountSelector`, před `return`:

```jsx
  async function handleRoleChange(acc, role) {
    setSavingRole(true); setRoleErr('');
    try {
      const r = await fetch(`/api/accounts/${acc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const d = await r.json();
      if (!r.ok) { setRoleErr(d.error || 'Chyba.'); return; }
      onUpdated(d);
    } catch { setRoleErr('Chyba připojení.'); }
    finally { setSavingRole(false); }
  }
```

- [ ] **Step 3: Vykreslit role select u vybraného účtu**

Najít blok, který renderuje `ROLE_HINTS[acc.role]` pro vybraný účet (IIFE `selectedId && (() => { const acc = accounts.find(...); return acc ? (<p>{ROLE_HINTS[acc.role]}</p>) : null; })()`). Nahradit jeho návratovou hodnotu tak, aby pod hintem byl role select + případná chyba:

```jsx
      {selectedId && (() => {
        const acc = accounts.find(a => a.id === selectedId);
        return acc ? (
          <div style={{ marginBottom: 4 }}>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>
              {ROLE_HINTS[acc.role]}
            </p>
            <select
              className="input"
              value={acc.role}
              disabled={savingRole}
              onChange={e => handleRoleChange(acc, e.target.value)}
              style={{ width: '100%' }}
            >
              {Object.entries(ROLE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l} – {ROLE_HINTS[v]}</option>
              ))}
            </select>
            {roleErr && (
              <div className="alert alert-error" style={{ padding: '6px 10px', fontSize: 12, marginTop: 6 }}>
                {roleErr}
              </div>
            )}
          </div>
        ) : null;
      })()}
```

(Zachovat přesné odsazení okolního JSX v souboru.)

- [ ] **Step 4: Předat `onUpdated` z `ImportPage`**

V `ImportPage` přidat handler vedle místa, kde se řeší `accounts`/`onCreated`:

```jsx
  function handleAccountUpdated(acc) {
    setAccounts(prev => prev.map(a => a.id === acc.id ? acc : a));
  }
```

Najít místo, kde se `<AccountSelector ... onCreated={...} />` renderuje, a přidat prop `onUpdated={handleAccountUpdated}`. Pokud `onCreated` aktuálně nahrazuje/přidává účet do stavu, `handleAccountUpdated` jen mapuje existující záznam (nevkládá nový).

- [ ] **Step 5: Ověřit build a absenci stale referencí**

Run: `npm run build`
Expected: Vite build úspěšný, 0 chyb. Žádné varování o nedefinovaném `onUpdated`/`handleAccountUpdated`/`savingRole`/`roleErr`.

Dále: `grep -n "onUpdated\|handleAccountUpdated\|handleRoleChange" client/src/pages/ImportPage.jsx` — musí vrátit definici i použití (prop předán, handler volán).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/ImportPage.jsx
git commit -m "feat: editor role účtu v Importu (PATCH /api/accounts/:id)"
```
Husky auto-bumpne VERSION/package.json — očekávané.

---

## Self-review

- **Spec coverage:** select role u vybraného účtu (Step 3) ✅; PATCH + onUpdated promítnutí (Step 2+4) ✅; chybová hláška jako u zakládání (Step 2+3) ✅; savingRole disable (Step 1+3) ✅; žádný backend/test zásah ✅; YAGNI (jen role) ✅.
- **Placeholder scan:** žádné TBD; veškerý JSX/handlery jsou konkrétní.
- **Type/název konzistence:** `onUpdated` (prop) ↔ `handleAccountUpdated` (ImportPage) ↔ `onUpdated(d)` (volání); `handleRoleChange`, `savingRole`, `roleErr` konzistentní napříč kroky. PATCH vrací aktualizovaný účet (backend `routes/accounts.js` PATCH vrací `SELECT * FROM accounts WHERE id=?`) → `onUpdated(d)` dostane plný záznam vč. `role`/`name`/`account_number`.
- **Ověření:** projekt nemá JSX testy → build + grep je adekvátní brána (konzistentní s Task 8 původní feature).
