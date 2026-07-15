# Příjmy bez tolerance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sekce Příjmy na Schůzce ukáže u každého zdroje přesný rozdíl proti plánu (schodek/přebytek) bez 5% tolerance a bez alarmu.

**Architecture:** Backend `incomeStatus` ztratí toleranci (status jen `missing`/`ok`), konstanta `MATCH_TOLERANCE_PCT` se odstraní. Frontend `ReportPage.jsx` vždy zobrazí rozdíl `actual − planned_amount` na řádku i v souhrnu „Příjmy celkem".

**Tech Stack:** Node.js + better-sqlite3 (backend, `node:test`), React + Vite (frontend, vlastní CSS).

## Global Constraints

- **Sémantika:** zdroj co přišel = ✅ `ok` (bez ohledu na výši), vždy vedle přesný rozdíl proti plánu. Žádný ⚠️ podle výše schodku — signál nese jen barva čísla.
- **Barvy (POZOR, invertované vůči výdajům):** u PŘÍJMŮ schodek `diff < 0` → `text-danger` (červená), přebytek `diff > 0` → `text-success` (zelená). Opačně než souhrn výdajů na `ReportPage.jsx:642`. Obě CSS třídy existují (`App.css:816-817`).
- **Nedotýkat:** fixní platby (`ReportPage.jsx:504-514`, `paymentStatus` má vlastní min/max `mismatch`), sdílenou mapu `FIXED_STATUS` (klíč `mismatch` drží fixní platby), Bilanci „Skutečně naspořeno" (`ReportPage.jsx:271-276`), `totalIncome` výpočet.
- Čeština v UI. VERSION/package.json needitovat ručně (husky bumpne sám — správné chování).
- Deploy: commit + push `staging`, merge do `main` na pokyn, hlásit verzi.

---

### Task 1: Backend — `incomeStatus` bez tolerance

**Files:**
- Modify: `src/utils/recurring.js` (`incomeStatus` ~ř. 27-32; konstanta `MATCH_TOLERANCE_PCT` ř. 3; export ř. 43)
- Test: `src/utils/recurring.test.js` (import ř. 4; test „MATCH_TOLERANCE_PCT je 5" ř. 45-47; income testy ř. 51-72)

**Interfaces:**
- Consumes: nic.
- Produces: `incomeStatus(expected, actual, txCount)` → `null` (plán ≤ 0) / `'missing'` (0 tx) / `'ok'` (jinak). `MATCH_TOLERANCE_PCT` už neexistuje. Konzumenti `src/utils/income.js:134,152` volají beze změny (signatura zachována).

- [ ] **Step 1: Přepsat income testy v `recurring.test.js`**

V `src/utils/recurring.test.js`:

(a) Řádek 4 — odeber `MATCH_TOLERANCE_PCT` z destrukturace:
```js
const { paymentStatus, savingsNet, reserveBalance } = require('./recurring');
```

(b) Smaž celý test „MATCH_TOLERANCE_PCT je 5" (ř. 45-47):
```js
test('MATCH_TOLERANCE_PCT je 5', () => {
  assert.equal(MATCH_TOLERANCE_PCT, 5);
});
```

(c) Nahraď dva tolerance testy (přesně 5 % → ok; těsně pod 5 % → mismatch, ř. 63-69) tímto:
```js
test('incomeStatus: pod plán, ale přišlo → ok (bez tolerance)', () => {
  assert.equal(incomeStatus(140000, 133400, 1), 'ok');
});

test('incomeStatus: výrazně pod plán, ale přišlo → ok (žádný mismatch)', () => {
  assert.equal(incomeStatus(140000, 50000, 1), 'ok');
});
```

Ostatní income testy (missing, přesně plán → ok, víc než plán → ok, plán ≤ 0 → null) nech beze změny.

- [ ] **Step 2: Spustit testy — musí selhat**

Run: `node --test src/utils/recurring.test.js`
Expected: FAIL — starý `incomeStatus` vrací pro `(140000, 50000, 1)` `mismatch`, test čeká `ok`; navíc `MATCH_TOLERANCE_PCT` už není importované (ReferenceError ve smazaném testu je pryč, ale nový očekává novou logiku).

- [ ] **Step 3: Zjednodušit `incomeStatus` a odstranit konstantu**

V `src/utils/recurring.js`:

(a) Smaž řádek 3 `const MATCH_TOLERANCE_PCT = 5;`.

(b) Nahraď funkci `incomeStatus` (ř. 27-32):
```js
function incomeStatus(expected, actual, txCount) {
  if (!(expected > 0)) return null;      // není plán → bez statusu
  if (!txCount || txCount === 0) return 'missing';
  return 'ok';                            // přišlo cokoli → ok (rozdíl řeší UI)
}
```
Pozn.: `actual` zůstává v signatuře kvůli volajícím, logika ho nečte.

(c) V `module.exports` (~ř. 42-49) odeber řádek `MATCH_TOLERANCE_PCT,`.

- [ ] **Step 4: Spustit testy — musí projít**

Run: `node --test src/utils/recurring.test.js`
Expected: PASS (všechny testy recurring vč. přepsaných income).

- [ ] **Step 5: Ověřit, že `MATCH_TOLERANCE_PCT` už nikde není**

Run: `grep -rn "MATCH_TOLERANCE_PCT" src/ client/`
Expected: žádný výstup (0 výskytů). Pokud něco vyskočí, oprav to místo.

- [ ] **Step 6: Regresní kontrola income route testů**

Run: `node --test src/utils/income.test.js`
Expected: PASS (income.test.js neočekává status `mismatch` — aliasované zdroje pod plánem dřív mohly být `ok` i tak; ověř zeleně).

- [ ] **Step 7: Commit**

```bash
git add src/utils/recurring.js src/utils/recurring.test.js
git commit -m "feat(income): incomeStatus bez 5% tolerance (missing/ok), odstraněn MATCH_TOLERANCE_PCT"
```

---

### Task 2: Frontend — přesný rozdíl na řádku i v souhrnu

**Files:**
- Modify: `client/src/pages/ReportPage.jsx` (řádek zdroje ~391-427; souhrn statusů ~430-439; subtotal „Příjmy celkem" ~486-489; `totalIncome` ~218)

**Interfaces:**
- Consumes: `incomeStatus` z Tasku 1 (status řádku je `ok`/`missing`/`null`). Řádek `row` má `planned_amount` i `actual`. `aliasedSources` je pole těchto řádků.
- Produces: nic.

- [ ] **Step 1: Odvodit `totalPlanned` a `totalDiff`**

V `client/src/pages/ReportPage.jsx` k řádku `const totalIncome = aliasedSources.reduce((s, i) => s + (i.actual || 0), 0);` (~ř. 218) přidej pod něj:

```js
  const totalPlanned = aliasedSources.reduce((s, i) => s + (i.planned_amount || 0), 0);
  const totalDiff    = Math.round(totalIncome - totalPlanned);
```

- [ ] **Step 2: Nahradit mismatch blok na řádku zdroje vždy-zobrazeným rozdílem**

V mapě `aliasedSources.map` nahraď blok `row.status === 'mismatch'` (~ř. 407-412):
```jsx
                      {row.status === 'mismatch' && (
                        <span className="text-muted" style={{ fontSize: 12 }}>
                          o {formatCurrency(Math.max(0, row.planned_amount - row.actual))} méně, než plán
                          {row.tx_count > 1 ? ` · ${row.tx_count} platby` : ''}
                        </span>
                      )}
```
tímto (vždy ukázat rozdíl u přijatého zdroje s plánem):
```jsx
                      {row.status === 'ok' && row.planned_amount > 0 && Math.round(row.actual - row.planned_amount) !== 0 && (
                        <span
                          className={row.actual - row.planned_amount > 0 ? 'text-success' : 'text-danger'}
                          style={{ fontSize: 12 }}
                        >
                          {row.actual - row.planned_amount > 0 ? '+' : '−'}
                          {formatCurrency(Math.abs(Math.round(row.actual - row.planned_amount)))}
                          {row.tx_count > 1 ? ` · ${row.tx_count} platby` : ''}
                        </span>
                      )}
```
Blok `row.status === 'missing'` („nepřišlo", hned pod tím) nech beze změny. Ikona `FIXED_STATUS[row.status].icon` (✅ pro `ok`) zůstává.

- [ ] **Step 3: Odebrat mismatch ze souhrnu statusů**

V souhrnu (~ř. 430-439) odeber řádek s `mismatch`:
```jsx
                  {c('mismatch') > 0 && <span>⚠️ {c('mismatch')} nižší částka</span>}
```
Ponech `✅ {c('ok')} přišlo` a `❌ {c('missing')} nepřišlo`. Zbytek bloku (výpočet `c`, wrapper) beze změny.

- [ ] **Step 4: Přidat celkový rozdíl do „Příjmy celkem"**

V subtotal řádku sekce Příjmy (~ř. 486-489):
```jsx
            <div className="report-subtotal">
              <span>Příjmy celkem</span>
              <span>{formatCurrency(totalIncome)}</span>
            </div>
```
nahraď za (přidá rozdíl vedle částky; ⚠️ toto je subtotal V SEKCI Příjmy, NE „Příjmy celkem" v Bilanci na ř. 274-276 — tu nech být):
```jsx
            <div className="report-subtotal">
              <span>Příjmy celkem</span>
              <span>
                {formatCurrency(totalIncome)}
                {totalDiff !== 0 && (
                  <span className={totalDiff > 0 ? 'text-success' : 'text-danger'} style={{ marginLeft: 8, fontSize: 12 }}>
                    ({totalDiff > 0 ? '+' : '−'}{formatCurrency(Math.abs(totalDiff))})
                  </span>
                )}
              </span>
            </div>
```

- [ ] **Step 5: Build — musí projít**

Run: `cd client && npm run build`
Expected: OK bez chyb. `formatCurrency`, `text-danger`, `text-success` jsou dostupné (App.css:816-817, funkce už importovaná).

- [ ] **Step 6: Sebekontrola**

- Řádek Tom (actual 133 400, plán 140 000): ✅ + červeně „−6 600 Kč".
- Přebytek → zeleně „+X". Přesně plán → jen ✅ bez čísla.
- Souhrn: „✅ X přišlo / ❌ X nepřišlo", žádné „nižší částka".
- „Příjmy celkem": 174 400 + červeně „(−6 600)".
- Sekce fixních plateb (fixedExpenses) i Bilance nedotčené.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/ReportPage.jsx
git commit -m "feat(income): Schůzka ukazuje přesný rozdíl příjmů proti plánu (řádek + souhrn)"
```

## Závěrečné kroky

- [ ] **Celá backend sada:** `node --test 'src/**/*.test.js'` → vše PASS.
- [ ] **Client build:** `cd client && npm run build` → OK.
- [ ] **Push do staging:** `git push origin staging`. Nahlásit verzi. Po vizuální kontrole na pokyn merge do `main`.

## Self-Review

**Spec coverage:**
- `incomeStatus` bez tolerance (missing/ok) → Task 1 ✓
- odstranění `MATCH_TOLERANCE_PCT` + test → Task 1 (Step 1a/3a/3c/5) ✓
- řádek: vždy rozdíl, ✅ zůstává, barvy invertované → Task 2 Step 2 ✓
- souhrn bez „nižší částka" → Task 2 Step 3 ✓
- „Příjmy celkem" + celkový rozdíl → Task 2 Step 1+4 ✓
- non-goals (fixní platby, Bilance, totalIncome, whitelist) → nedotčeno (explicitně v Global Constraints) ✓

**Placeholder scan:** žádné TBD/TODO; každý krok má konkrétní kód nebo příkaz s očekávaným výstupem.

**Type consistency:** status `'ok'`/`'missing'`/`null` konzistentní Task 1↔2. `totalPlanned`/`totalDiff` definované v Task 2 Step 1, použité ve Step 4. `row.planned_amount`/`row.actual` shodné s tvarem z `income.js`. Barevná konvence (schodek červená / přebytek zelená) konzistentní na řádku i v souhrnu.
