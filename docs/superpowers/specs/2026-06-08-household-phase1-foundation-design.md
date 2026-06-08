# Household sharing — Fáze 1: Foundation (data-owner resolution)

**Datum:** 2026-06-08
**Stav:** Návrh, čeká na schválení
**Backlog:** „Broadcast push oběma" → odhaleno, že vyžaduje household sharing (separátní loginy, sdílená data).

## Kontext a rozhodnutí

Cíl uživatele: Martin má **vlastní Google login**, ale **sdílí finanční data** domácnosti
(sdílená fronta zařazování + push pro oba). Aplikace je dnes plně scoped per `user_id`.
Zvolený přístup: **data-owner resolution** (varianta A) — sdílená data zůstávají fyzicky
pod jedním vlastníkem, členové domácnosti se na něj resolvují. Buduje se **po fázích**.

**Tato fáze (1) je čistě foundation: BEZ změny chování.** Dokud nikdo není členem cizí
domácnosti, každý se resolvuje sám na sebe → aplikace funguje přesně jako dnes. Smysl: položit
bezpečný základ (resolution + sdílené scoping) a velký mechanický refactor odbavit izolovaně.

**Roadmapa dalších fází (vlastní specy později):**
- Fáze 2: invite flow (vlastník vygeneruje kód, člen se připojí) + household UI v Nastavení.
- Fáze 3: fan-out notifikací na členy domácnosti + reálné připojení Martina.

## Datový model

```sql
CREATE TABLE IF NOT EXISTS household_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  data_owner_id INTEGER NOT NULL,           -- čí domácnost (= user_id vlastníka)
  user_id       INTEGER NOT NULL UNIQUE,    -- člen; UNIQUE = každý je nejvýš v 1 domácnosti
  created_at    TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (data_owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)       REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_household_members_owner ON household_members(data_owner_id);
```

**Sémantika řádku:** „`user_id` je členem domácnosti `data_owner_id`."
- **Vlastník nemá řádek** → resolvuje se na sebe (fallback). Tedy stávající jediný uživatel
  funguje bez jakéhokoliv bootstrapu.
- Připojení člena (Fáze 2) = INSERT řádku `(data_owner_id=vlastník, user_id=člen)`. `UNIQUE(user_id)`
  zaručí max. jednu domácnost na člověka.
- **Žádný bootstrap self-řádků** — vyhneme se nejednoznačnosti (člen by jinak měl self-řádek
  i member-řádek). Fan-out ve Fázi 3 bude `{dataUserId} ∪ {členové}`.

## Resolution

Rozšířit `src/middleware/auth.js` `requireAuth` tak, aby po ověření nastavil `req.dataUserId`:
```javascript
function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const row = db.prepare('SELECT data_owner_id FROM household_members WHERE user_id = ?').get(req.user.id);
  req.dataUserId = row ? row.data_owner_id : req.user.id;
  next();
}
```
`requireAuth` tím získá závislost na `db` (import). Každá chráněná routa pak má `req.dataUserId`
k dispozici. (Webhook `emailInbound` requireAuth nepoužívá — řeší se ve Fázi 3.)

## Klasifikace: SHARED vs PERSONAL (z inventury)

**SHARED → `req.dataUserId`** — refactor `req.user.id` → `req.dataUserId` ve VŠECH datových
dotazech (vč. IDOR checků `WHERE id=? AND user_id=?`):

| Soubor | Endpointy |
|---|---|
| `accounts.js` | GET/POST/PATCH/DELETE |
| `annual-budgets.js` | GET/PUT/DELETE |
| `budget-items.js` | GET/POST/PATCH/DELETE |
| `budgets.js` | GET/PUT/DELETE (vč. `getUserBillingDay(db, dataUserId)`) |
| `categories.js` | GET /fund-status, GET/POST/PATCH/DELETE |
| `emailInbox.js` | GET, GET /history, POST /:id/approve, DELETE /:id |
| `fixed-expenses.js` | GET/POST/PATCH/DELETE |
| `import.js` | /preview, /confirm, /mappings (GET/PUT/DELETE), archive |
| `income.js` | GET/POST/PATCH/DELETE (vč. period + resolveAccountId) |
| `stats.js` | GET /overview (~12 dotazů + billing_day) |
| `transactions.js` | GET, /duplicates, /duplicates/dismiss, POST/PATCH/DELETE, bulk DELETE |

**PERSONAL → zůstává `req.user.id`** (NEMĚNIT):
- `push.js` — subscribe/unsubscribe/test (odběry per zařízení/login; `sendToUser(req.user.id)`).
- `auth.js` — `/me`, `/local` vrací identitu volajícího.

**MIXED — `settings.js`:**
- `billing_day` = SHARED → čte/zapisuje **vlastníkův** řádek (`req.dataUserId`).
- `notify_scope` = PERSONAL → čte/zapisuje **volajícího** řádek (`req.user.id`).
- GET vrátí `billing_day` z `dataUserId` řádku + `notify_scope` z `req.user.id` řádku.
- PUT zapíše `billing_day` do `dataUserId` řádku, `notify_scope` do `req.user.id` řádku.
  (Member smí měnit household billing_day — je to společné období.)

## Bezpečnost (kritické)

`req.dataUserId` se odvozuje **výhradně server-side** z `household_members` (ne z klientského
vstupu) → IDOR checky zůstávají platné, jen scopují na domácnost místo na jednotlivce. Nutné
ověřit: člen domácnosti A se nikdy nedostane k datům domácnosti B. Refactor nesmí omylem nechat
některý dotaz na `req.user.id` tam, kde má být `dataUserId` (jinak by člen viděl prázdno místo
sdílených dat — funkční bug; opačně by mohl být únik — proto testy izolace).

## Testy

- **resolveDataUserId (requireAuth):** s membership řádkem (owner=1, member=2) → request uživatele 2
  má `req.dataUserId === 1`; bez řádku → `req.dataUserId === req.user.id`.
- **Sdílení napříč routami (reprezentativní vzorek, ne všech 55 dotazů):** vlastník (user 1) vytvoří
  kategorii/transakci; člen (user 2, member of 1) je přes API **vidí**; uživatel 3 (jiná/žádná
  domácnost) je **nevidí** (izolace). Pokrýt aspoň `transactions`, `categories`, `email-inbox`,
  `settings` (billing_day sdílený, notify_scope osobní).
- **Regrese:** celá stávající sada zelená (single-user chování beze změny — `dataUserId == self`).
- **Bezpečnost:** člen domácnosti A nemůže přes `:id` editovat/mazat řádek domácnosti B (IDOR
  scoped na dataUserId).

## Mimo rozsah Fáze 1

- Invite flow, household UI (Fáze 2).
- Fan-out notifikací, připojení Martina, webhook dataUserId (Fáze 3).
- Žádná změna frontendu (server resolvuje; UI dostává stejná data jako dnes). Výjimka: žádná —
  settings GET/PUT kontrakt zůstává stejný (billing_day + notify_scope), jen zdroj billing_day
  je vlastníkův řádek.

## Pořadí implementace

1. Schema `household_members`.
2. `requireAuth` resolution + test.
3. Refactor po doménách (transactions, categories, budgets, accounts, income, fixed, annual,
   budget-items, emailInbox, import, stats) — každá doména malý commit + ověření.
4. `settings.js` split.
5. Cross-household izolační testy + plná sada.
