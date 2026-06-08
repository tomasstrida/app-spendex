# Household sharing — Fáze 2: Invite flow + household UI

**Datum:** 2026-06-08
**Stav:** Návrh schválen, čeká na implementační plán
**Navazuje na:** Fáze 1 (foundation) — `household_members` + `req.dataUserId` resolution už v produkci ([[spendex-household-sharing]]).

## Cíl

Umožnit, aby Martin (vlastní Google login) **vznikl jako člen** Tomovy domácnosti přes
**invite kód** + správa členství v UI. Po připojení mu Fáze 1 už zajistí, že vidí sdílená
data. (Push pro oba = Fáze 3.)

## Rozhodnutí (z brainstormingu)

- **Pozvánka = kód** (ne odkaz). Vlastník vygeneruje kód v Nastavení, pošle ho mimo aplikaci,
  člen ho vloží. Žádná landing routa.
- **Kód: single-use + regenerovatelný, bez tvrdé expirace.** Spotřebuje se při úspěšném
  připojení. Přegenerování nahradí starý. (Expirace vědomě mimo rozsah — pro 2 lidi stačí.)
- **Správa: odejít (člen) + odebrat člena (vlastník).** Oboje = smazání membership řádku.
- **Generovat pozvánku smí `solo` i `owner`** (ne `member` — zveš do SVÉ domácnosti).

## Datový model

```sql
CREATE TABLE IF NOT EXISTS household_invites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  data_owner_id INTEGER NOT NULL UNIQUE,   -- max. 1 aktivní pozvánka na vlastníka
  token         TEXT NOT NULL UNIQUE,
  created_at    TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (data_owner_id) REFERENCES users(id) ON DELETE CASCADE
);
```
`token` = `crypto.randomBytes(24).toString('base64url')` (neuhádnutelný). `UNIQUE(data_owner_id)`
→ přegenerování přes `INSERT … ON CONFLICT(data_owner_id) DO UPDATE SET token=…, created_at=…`.

## Role (odvození)

- **member** — existuje `household_members` řádek s `user_id = req.user.id` → vlastník = jeho `data_owner_id`.
- **owner** — někdo má `household_members.data_owner_id = req.user.id` (má členy).
- **solo** — nic z výše (žádný vztah).

Pozvánku smí generovat jen `solo`/`owner`. `member` ne.

## Backend — `src/routes/household.js` (`/api/household`), všechny `requireAuth`

| Endpoint | Chování | Chyby |
|---|---|---|
| `GET /` | `{ role, owner?, members?, invite_code? }`. owner/solo dostane `invite_code` (aktuální token nebo null); member dostane `owner` (id+jméno+email). owner dostane `members` (seznam). | — |
| `POST /invite` | vygeneruje/přegeneruje token pro `req.user.id` (jako data_owner). Vrátí `{ code }`. | 403 pokud je volající `member` |
| `POST /join` `{ code }` | najde invite dle tokenu; INSERT `household_members(data_owner_id=invite.data_owner_id, user_id=req.user.id)`; DELETE invite (spotřeba). | 400 neplatný kód; 400 vlastní domácnost (`invite.data_owner_id === req.user.id`); 409 už člen (UNIQUE) nebo už owner s členy |
| `POST /leave` | DELETE `household_members WHERE user_id = req.user.id`. | 400 pokud není člen |
| `DELETE /members/:userId` | DELETE `household_members WHERE user_id = :userId AND data_owner_id = req.user.id`. | 404 pokud takový člen v MÉ domácnosti není |

Mount v `src/index.js`: `app.use('/api/household', require('./routes/household'))`.

### Důležité guardy
- Nelze připojit do vlastní domácnosti (`invite.data_owner_id === req.user.id` → 400).
- Nelze připojit dvakrát (`UNIQUE(user_id)` → zachytit → 409).
- Nelze se připojit, pokud volající SÁM má členy (je owner) → 409 (nejdřív by je musel odebrat).
- `DELETE /members/:userId` scopováno na `data_owner_id = req.user.id` (vlastník odebírá jen ze své domácnosti).
- `:userId` validovat jako integer.

## Frontend — sekce „Domácnost" v Nastavení (SettingsPage)

Načte `GET /api/household`, vykreslí dle role:
- **solo:** text „Nejsi ve sdílené domácnosti." + [Vytvořit pozvánku] → po vytvoření zobrazí
  `invite_code` (kopírovatelný) + [Přegenerovat]. Vždy také input „Připojit se kódem" + [Připojit].
- **owner:** zobrazí `invite_code` + [Přegenerovat] + seznam členů (jméno/e-mail) s [Odebrat] u každého.
- **member:** „Jsi ve sdílené domácnosti — vlastník: <jméno/e-mail>." + [Odejít].
- Po akcích (invite/join/leave/remove) re-fetch `GET /api/household` a aktualizace UI.
- i18n texty do `client/src/i18n.js` (`cs.settings.household_*`).

## Bezpečnost

- Token neuhádnutelný (`crypto.randomBytes(24)`), `UNIQUE`. Sdílí se mimo aplikaci (vlastník → člen).
- Všechny endpointy `requireAuth` + rate-limit na write (`writeLimiter` jako jinde).
- Připojení je **deliberátní** (člověk zadá kód) → vlastník kontroluje, komu kód předá.
- Po `leave`/remove se členova data resolvují zpět na sebe; jeho push odběry (osobní) zůstávají.

## Edge / poznámky

- **Připojením se členova vlastní data „schovají"** (resolvují se na vlastníka; zůstávají v DB pod
  jeho user_id, jen je jako člen nevidí). Pro Martina (nový účet bez dat) bezpředmětné. Po `leave`
  se zase objeví. Žádná migrace dat.
- Generování pozvánky `solo` uživatelem nevytvoří domácnost — ta vznikne až `join`em někoho jiného.

## Testy

- `household.js` (express-app + fetch, fake auth s `req.user`/`req.dataUserId` jako v Phase 1 testech;
  pro role-odvození stačí req.user.id):
  - invite: solo vygeneruje kód; přegenerování nahradí token; member dostane 403.
  - join: platný kód → membership vznikne + invite smazán; neplatný kód → 400; vlastní domácnost → 400;
    druhý join téhož uživatele → 409.
  - leave: člen → smaže; ne-člen → 400.
  - remove: vlastník odebere svého člena → smaže; odebrání cizího/neexistujícího → 404.
- Schema test: `household_invites` sloupce + `UNIQUE(data_owner_id)`.
- Celá sada zelená.

## Mimo rozsah

- Expirace pozvánek, odkazové pozvánky, e-mailové rozeslání pozvánky.
- Push fan-out na oba (Fáze 3).
- Migrace/„přenos" členových existujících dat do domácnosti.
