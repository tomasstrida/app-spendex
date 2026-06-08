# Security hardening batch (design)

**Datum:** 2026-06-08
**Stav:** Návrh schválen (rozsah „bezpečné fixy bez CSP"), čeká na implementační plán
**Backlog:** „Ověřit bezpečnost — Security Baseline" ([[spendex-backlog]])
**Podklad:** 3-doménový audit (secrets/auth/session, IDOR/SQLi, rate-limit/validace/webhook/XSS).

## Kontext

Audit nenašel žádný Critical, žádnou SQL injection, žádný row-level IDOR. Tento batch
opravuje ověřené nálezy nižší–střední závažnosti. **Mimo rozsah (vědomě):** helmet CSP
(může rozbít Vite build/SW — zvlášť, s testem), npm audit vulnerabilit (breaking upgrady,
zůstává v backlogu).

Hlavní omezení návrhu: nesmí rozbít stávající flow — zejména Google OAuth redirect
(cookie `sameSite`) a Cloudflare Email Worker (webhook secret).

## Fixy (každý s konkrétním rozhodnutím)

### 1. Kategorie — ověření vlastníka na transakci (IDOR na FK)
`src/routes/transactions.js` POST (`:126`) a PATCH (`:139`). Když `category_id` není
null/undefined, ověřit `SELECT 1 FROM categories WHERE id=? AND user_id=?`; jinak 400
„Neplatná kategorie." (stejný pattern jako `budgets.js:62`). Platí pro POST i PATCH.

### 2. Cookie sameSite
`src/index.js` session cookie: přidat `sameSite: 'lax'`. **Ne 'strict'** — strict by
rozbil návrat z Google OAuth (top-level GET navigace přijde bez cookie → uživatel by
se vrátil odhlášený). Lax tuto navigaci povolí a přitom blokuje cross-site POST.

### 3. Validace vstupu transakce
`src/routes/transactions.js` POST + PATCH:
- `amount`: musí být `Number.isFinite(Number(amount))` → jinak 400. (Povolit i 0 a
  záporné — znaménko nese sémantiku výdaj/příjem. Současné `!amount` chybně odmítá 0.)
- `date`: musí matchovat `^\d{4}-\d{2}-\d{2}$` → jinak 400 (period math to předpokládá).
- `currency`: cap délky (≤ 8) nebo whitelist `['CZK','EUR','USD']`; default `'CZK'`.
- `description`/`note`: cap délky (≤ 500) — ořezat nebo 400.
PATCH validuje jen pole, která přišla (partial update zachován).

### 4. Rate-limit auth e-mailových endpointů + /verify
`src/routes/auth.js`:
- Nový `emailLimiter = rateLimit({ windowMs: 60*60*1000, max: 5 })` na `/register`
  a `/forgot` (omezí email-bombing přes Brevo). `authLimiter` (10/15min) tam zůstává
  taky pro brute-force; aplikovat oba.
- Přidat `authLimiter` na `/verify` (dnes bez limitu).

### 5. Helmet (bez CSP)
`src/index.js`: `app.use(helmet({ contentSecurityPolicy: false }))` hned po `trust proxy`.
Zapne X-Frame-Options (clickjacking), HSTS, X-Content-Type-Options atd. CSP vědomě
vypnuté (zvlášť, s testem proti buildu). Dependency: `helmet`.

### 6. Import — rate-limit + stropy
`src/routes/import.js`:
- Přidat `writeLimiter` (60/min) na `/preview` a `/confirm`.
- `/preview`: snížit `express.text` limit na `'2mb'`; po parse odmítnout > 5000 řádků
  (400 „Příliš velký výpis.").
- `/confirm`: odmítnout `transactions.length > 5000` (400). (Globální json limit nechat,
  viz #10.)

### 7. Webhook secret — constant-time + preferovat hlavičku
`src/routes/emailInbound.js` `checkSecret`: porovnat `crypto.timingSafeEqual` nad buffery
stejné délky (nejdřív délková guard, jinak `===` na délce → fail). Podpora `?secret=`
i `x-webhook-secret` zůstává (Worker používá hlavičku — zpětná kompatibilita), ale do
docs/README dopsat „preferuj hlavičku, query se může logovat".

### 8. Webhook — strop velikosti raw MIME
`src/routes/emailInbound.js`: před `simpleParser(raw)` odmítnout `raw.length > 1_000_000`
(1 MB) → 413 „Příliš velká zpráva." (anti MIME-bomb).

### 9. Verify token — expirace
Schema: nový sloupec `users.verify_expires INTEGER` (migrace ALTER). `auth.js`:
- `/register`: uložit `verify_expires = Date.now() + 24*60*60*1000`.
- `/verify`: odmítnout, pokud `verify_expires < Date.now()` (jako reset).
Konzistentní s textem e-mailu („24 h").

### 10. Drobná hardening
- `src/index.js`: `express.urlencoded({ extended: true, limit: '100kb' })` (explicitní limit).
- `src/services/email.js`: HTML-escape `name` před interpolací do `htmlContent`
  (verifikace + reset). Malý helper `escapeHtml(s)` (`& < > " '`).
- `src/routes/import.js`: sanitizovat `filename` v Content-Disposition (strip control
  chars + cap délky) nebo `encodeURIComponent`.

## Co se NEdělá

- **CSP** — zvlášť, vyžaduje test proti Vite/SW.
- **npm audit upgrady** (bcrypt/express/node-cron) — breaking, backlog.
- Per-email keying rate-limitu (IP-based stačí pro 2-user app).
- CSRF tokeny (sameSite=lax + JSON body je pro tento threat model dostatečné).

## Testy

- **transactions**: POST/PATCH s cizí `category_id` → 400; s nevalidním `amount`/`date`
  → 400; s `amount=0` → projde (regrese fix); validní → OK.
- **auth**: `/verify` s prošlým `verify_expires` → redirect invalid_token; emailLimiter
  zablokuje 6. request (lze ověřit voláním handleru/limiteru).
- **emailInbound**: raw > 1 MB → 413; špatný secret → 401 (timingSafeEqual cesta).
- **email.js**: `escapeHtml` escapuje `<script>` apod.
- Celá sada zůstává zelená.

## Pořadí / izolace

Fixy jsou nezávislé; implementovat po doménách (transactions, auth+schema, index/helmet,
import, emailInbound, email.js). Každý malý commit + test.
