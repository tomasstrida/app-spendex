# Kategorie ve sloupcích podle typu – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zobrazit kategorie v `CategoriesPage` ve sloupcích podle pole `type` — každý neprázdný typ vlastní sloupec.

**Architecture:** Čistě prezentační, frontend-only. `CategoriesPage` seskupí načtené kategorie podle `type` a vyrenderuje sloupec na každý přítomný typ; řádkový markup (tečka, název, badge, edit/delete, inline edit) se extrahuje do lokální funkce `renderItem` a znovupoužije v každém sloupci (DRY). CSS grid `auto-fit` zajistí responsivitu bez JS. Žádná změna API/DB.

**Tech Stack:** React + Vite (`client/`), CSS. Build přes `npm run build`. Žádné nové závislosti, žádný backend test (presentational).

**Spec:** `docs/superpowers/specs/2026-05-17-categories-columns-by-type-design.md`

**Kontext pro implementátora:**
- Branch `staging` — commit, NEPUSHOVAT (push až v poslední úloze).
- Pre-commit hook auto-bumpne verzi + stage VERSION/package.json — normální, nech být.
- Commit zprávy: česky, conventional prefix, trailing `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` přes HEREDOC.
- Žádný frontend test runner; ověření = `npm run build` (musí projít) + statická grep kontrola + poctivé sdělení, že interaktivní browser klik-test dělá člověk po deployi (toto prostředí ho neumí).
- `TYPE_OPTIONS` v `client/src/pages/CategoriesPage.jsx` (pořadí 1 Měsíční, 2 Roční / sezónní, 3 Drahé věci) je zdroj labelů a pořadí sloupců.
- `.category-row` styl je samostatný (bg2/border/padding); `.category-list` (max-width:640px, flex column) bude nahrazen novým grid wrapperem `.category-columns`. `.category-list` CSS pravidlo se nemaže (mimo rozsah, neškodí).

## File Structure

| Soubor | Změna | Odpovědnost |
|---|---|---|
| `client/src/pages/CategoriesPage.jsx` | modify | `renderItem` helper + seskupení dle type + render sloupců (nahrazení `.category-list` bloku) |
| `client/src/App.css` | modify | 3 nové třídy: `.category-columns`, `.category-column`, `.category-column-head` |

---

## Task 1: CategoriesPage – seskupení do sloupců dle typu

**Files:**
- Modify: `client/src/pages/CategoriesPage.jsx`

- [ ] **Step 1: Přidej `renderItem` helper do komponenty**

V `client/src/pages/CategoriesPage.jsx` najdi přesně:
```javascript
  async function handleDelete(cat) {
    if (!confirm(t.categories.deleteConfirm)) return;
    const r = await fetch(`/api/categories/${cat.id}`, { method: 'DELETE' });
    if (r.ok) setCategories(prev => prev.filter(c => c.id !== cat.id));
  }
```
Vlož BEZPROSTŘEDNĚ ZA tento blok (nový řádek za uzavírací `}` funkce `handleDelete`):
```javascript

  const renderItem = (cat) => (
    editItem?.id === cat.id ? (
      <div key={cat.id} className="card" style={{ maxWidth: 480 }}>
        <CategoryForm
          initial={cat}
          onSave={handleSaved}
          onCancel={() => setEditItem(null)}
        />
      </div>
    ) : (
      <div key={cat.id} className="category-row">
        <div className="category-row-info">
          <span className="budget-dot" style={{ background: cat.color, width: 14, height: 14 }} />
          <span className="category-row-name">{cat.name}</span>
          <span className={`cat-type-badge cat-type-badge--${cat.type || 1}`}>
            {TYPE_OPTIONS.find(o => o.value === (cat.type || 1))?.label}
          </span>
        </div>
        <div className="category-row-actions">
          <button className="btn btn-ghost btn-icon" onClick={() => { setShowForm(false); setEditItem(cat); }}>
            <Pencil size={15} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={() => handleDelete(cat)}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    )
  );
```

- [ ] **Step 2: Nahraď plochý `.category-list` blok seskupením do sloupců**

Najdi přesně tento blok:
```javascript
        <div className="category-list">
          {categories.map(cat => (
            editItem?.id === cat.id ? (
              <div key={cat.id} className="card" style={{ maxWidth: 480 }}>
                <CategoryForm
                  initial={cat}
                  onSave={handleSaved}
                  onCancel={() => setEditItem(null)}
                />
              </div>
            ) : (
              <div key={cat.id} className="category-row">
                <div className="category-row-info">
                  <span className="budget-dot" style={{ background: cat.color, width: 14, height: 14 }} />
                  <span className="category-row-name">{cat.name}</span>
                  <span className={`cat-type-badge cat-type-badge--${cat.type || 1}`}>
                    {TYPE_OPTIONS.find(o => o.value === (cat.type || 1))?.label}
                  </span>
                </div>
                <div className="category-row-actions">
                  <button className="btn btn-ghost btn-icon" onClick={() => { setShowForm(false); setEditItem(cat); }}>
                    <Pencil size={15} />
                  </button>
                  <button className="btn btn-ghost btn-icon" onClick={() => handleDelete(cat)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )
          ))}
        </div>
```
Nahraď celý tento blok za:
```javascript
        <div className="category-columns">
          {TYPE_OPTIONS
            .filter(opt => categories.some(c => (c.type || 1) === opt.value))
            .map(opt => {
              const items = categories.filter(c => (c.type || 1) === opt.value);
              return (
                <div key={opt.value} className="category-column">
                  <div className="category-column-head">
                    {opt.label} <span className="text-muted">({items.length})</span>
                  </div>
                  {items.map(renderItem)}
                </div>
              );
            })}
        </div>
```

- [ ] **Step 3: Build check**

Run: `cd /Users/tomas/app-spendex/client && npm run build 2>&1 | tail -3`
Expected: build úspěšný (`✓ built in ...`), vznikne `dist/`. Pokud chybí `node_modules`, nejdřív `npm install` v `client/`. Paste poslední řádky.

- [ ] **Step 4: Statická verifikace**

Run:
```bash
cd /Users/tomas/app-spendex && grep -n "renderItem\|category-columns\|category-column\b\|category-column-head" client/src/pages/CategoriesPage.jsx
```
Expected: `renderItem` definováno (1×) a použito (`items.map(renderItem)`), `category-columns` wrapper, `category-column` per typ, `category-column-head`. Žádný zbylý `<div className="category-list">` (ověř `grep -n "category-list" client/src/pages/CategoriesPage.jsx` → 0 výskytů). Paste výstup.

- [ ] **Step 5: Honest UI note**

Do reportu uveď doslova: „Interaktivní browser klik-test jsem z prostředí neprovedl; ověřeno build + statická inspekce. Vizuální klik-test (sloupce dle typu, edit/delete/add, responsivní zalomení) dělá člověk po deployi." Nepřeháněj úspěch, který jsi neviděl.

- [ ] **Step 6: Commit**

```bash
cd /Users/tomas/app-spendex && git add client/src/pages/CategoriesPage.jsx && git commit -m "$(cat <<'EOF'
feat: kategorie ve sloupcích dle typu (renderItem helper, seskupení)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
Pak `git log --oneline -1` a `git status --short`.

---

## Task 2: CSS – grid sloupců

**Files:**
- Modify: `client/src/App.css`

- [ ] **Step 1: Přidej 3 nové třídy za blok `.category-list`**

V `client/src/App.css` najdi přesně:
```css
.category-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 640px;
}
```
Vlož BEZPROSTŘEDNĚ ZA tento blok:
```css

.category-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
  align-items: start;
}

.category-column {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.category-column-head {
  font-size: 13px;
  font-weight: 600;
  color: var(--text2);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0 2px 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
```

- [ ] **Step 2: Build check**

Run: `cd /Users/tomas/app-spendex/client && npm run build 2>&1 | tail -3`
Expected: build úspěšný; CSS bundle mírně naroste. Paste poslední řádky.

- [ ] **Step 3: Statická verifikace**

Run: `cd /Users/tomas/app-spendex && grep -n "category-columns\|category-column\b\|category-column-head" client/src/App.css`
Expected: 3 nové třídy přítomné. Paste výstup.

- [ ] **Step 4: Commit**

```bash
cd /Users/tomas/app-spendex && git add client/src/App.css && git commit -m "$(cat <<'EOF'
feat: CSS grid sloupců kategorií (.category-columns/.category-column)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
Pak `git log --oneline -1`.

---

## Task 3: Finalizace

**Files:** žádné

- [ ] **Step 1: Git stav + regrese build**

Run: `cd /Users/tomas/app-spendex && git status --short && git log --oneline -3 && cd client && npm run build 2>&1 | tail -2`
Expected: čistý strom vůči této práci (2 commity + spec/plán), build OK.

- [ ] **Step 2: Push na staging**

```bash
cd /Users/tomas/app-spendex && git push origin staging 2>&1 | tail -1
```

- [ ] **Step 3: Hlášení uživateli**

Shrň: verzi (z hooku), že je na `staging`, frontend-only změna. **Zdůrazni:** projeví se v produkčním UI až po deployi (`staging`→`main`) na výslovný pokyn „push do prod"; po deployi ať člověk vizuálně ověří sloupce dle typu (Měsíční / Roční / sezónní), edit/delete/add a responsivní zalomení.

---

## Self-Review (autor plánu)

**Spec coverage:**
- „Seskupit dle `c.type || 1`, sloupec na neprázdný typ, pořadí dle TYPE_OPTIONS" → Task 1 Step 2 (`TYPE_OPTIONS.filter(...some...).map`) ✓
- „Striktně dle type, žádné podsekce; type 1 vše v jednom sloupci" → filtr čistě `(c.type||1)===opt.value` ✓
- „V rámci sloupce dle názvu" → `categories.filter` zachovává pořadí z API (name ASC) ✓
- „Zachovat řádek/inline edit/delete/add/empty/loading beze změny" → `renderItem` je 1:1 extrakce původního markupu; loading/empty větve a add-form card mimo nahrazovaný blok, nedotčeny ✓
- „CSS grid auto-fit, hlavička s labelem + počtem" → Task 2 + Task 1 `category-column-head` `{opt.label} ({items.length})` ✓
- „Soubory: CategoriesPage.jsx + App.css 3 třídy; bez API/DB" → Tasks 1–2, žádný backend ✓
- „Mimo rozsah: badge removal, drag-drop, prázdné sloupce, mazání `.category-list` CSS" → nezahrnuto ✓
- Testy/ověření: build + statická grep + honest note → Task 1 Steps 3–5, Task 2 Steps 2–3 ✓

**Placeholder scan:** žádné TBD/TODO; veškerý kód a přesné old/new stringy doslovné.

**Type consistency:** `renderItem` definováno v Task 1 Step 1, voláno v Step 2 (`items.map(renderItem)`) — shodný název. Třídy `.category-columns`/`.category-column`/`.category-column-head` shodné mezi JSX (Task 1) a CSS (Task 2). `TYPE_OPTIONS` má `value`/`label` (existující tvar, ověřeno v souboru). `renderItem` používá `key={cat.id}` (klíč na vnějším elementu) — správně pro `.map`.

**Pozn.:** Žádný unit test — logika je triviální prezentační seskupení (3řádkový filter/map); samostatný modul + test by byl over-engineering (YAGNI). Ověření buildem + statickou inspekcí + lidským klik-testem, konzistentní s předchozími přijatými frontend úlohami v tomto repu.
