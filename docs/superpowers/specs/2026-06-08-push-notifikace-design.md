# Push notifikace pro nezařazené platby (PWA + Web Push)

**Datum:** 2026-06-08
**Stav:** Návrh schválen, čeká na implementační plán

## Cíl

Když do Spendexu přijde nová platba z AirBank e-mailu, která čeká na zařazení do
kategorie (`pending` řádek v `email_inbox`), má uživateli **ihned vyskočit push
notifikace na telefonu** s informací o platbě a odkazem do appky.

Volitelně (dle nastavení) push i pro automaticky zařazené platby.

## Rozhodnutí a kontext

- **Cesta:** Vlastní Web Push přes PWA (ne prostředník typu ntfy/Telegram, ne
  nativní app). PWA = ikona na ploše, fullscreen, push — pro tento use-case
  (2 lidé, iPhone, domácnost) plnohodnotné řešení za $0 a beze druhé codebase.
- **Nativní app (Expo/React Native)** vědomě odložena jako budoucí samostatný
  projekt. Backend push vrstva (subscriptions + odesílání) je sdílená, takže to
  není slepá ulička. Apple Developer účet ($99/rok za účet, ne za appku) zatím
  není potřeba.
- **iOS podmínka:** Web Push na iOS (16.4+) funguje **jen ze standalone PWA**
  přidané na plochu — ne z karty v Safari. Součástí dodávky je krátký návod.
- **Platforma:** primárně iPhone (Tom i Martin).

## Rozsah teď vs. později

- **Teď:** push chodí majiteli platby (`user_id` záznamu v `email_inbox`).
  Pro test reálně jen Tomovi (jen on bude mít zaregistrované zařízení).
- **Tabulka subscriptions je per-user**, takže pozdější broadcast oběma =
  malá změna (projít subscriptions více uživatelů místo jednoho).

## Architektura — data flow

### Registrace odběru (jednorázově na každém zařízení)

```
PWA na ploše → uživatel klikne "Zapnout notifikace" v Nastavení
  → Notification.requestPermission()
  → navigator.serviceWorker.register('/sw.js')
  → registration.pushManager.subscribe({ applicationServerKey: VAPID_PUBLIC })
  → POST /api/push/subscribe { endpoint, keys: { p256dh, auth } }
  → uložení řádku do push_subscriptions
```

### Doručení (při příchozí platbě)

```
AirBank e-mail → /api/email/inbound → emailIngest
  ├─ známá kategorie → vloží transakci (auto-zařazeno)
  │     └─ pokud settings.notify_scope = 'all' → pushNotify.sendToUser(...)
  └─ kategorie chybí → vloží pending řádek do email_inbox
        └─ pokud settings.notify_scope ≠ 'off' → pushNotify.sendToUser(userId, payload)   ← hlavní trigger

pushNotify.sendToUser → web-push → APNs (Apple push) → iPhone
  → service worker 'push' event → zobrazí notifikaci
  → uživatel klikne → 'notificationclick' → otevře/fokusne /import
```

## Komponenty

### Frontend

| Soubor | Účel |
|---|---|
| `client/public/manifest.webmanifest` | name, krátké jméno, ikony, `display: standalone`, `theme_color`, `start_url: /` |
| `client/public/sw.js` | Service worker (statický, scope `/`). Handluje `push` (zobrazí notifikaci z payloadu) a `notificationclick` (otevře/fokusne `/import`). |
| `client/public/icon-192.png`, `icon-512.png` | PWA ikony odvozené z `favicon.svg` |
| `client/index.html` | `<link rel="manifest">`, `theme-color` meta, apple-touch ikona |
| Nastavení (stránka) | Sekce „Notifikace": tlačítko **Zapnout notifikace** (stav zapnuto/vypnuto na tomto zařízení) + výběr rozsahu: **Vypnuto / Jen nezařazené / Všechny platby** |
| client helper (např. `client/src/push.js`) | logika: requestPermission → register SW → subscribe → POST na backend; čtení VAPID public key z `/api/push/public-key` |

### Backend

| Soubor | Účel |
|---|---|
| `src/db/schema.js` | Nová tabulka `push_subscriptions`. Nový sloupec `notify_scope` v `settings`. |
| `src/routes/push.js` | `GET /api/push/public-key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `POST /api/push/test` |
| `src/services/pushNotify.js` | `sendToUser(userId, payload)` — projde subscriptions uživatele, odešle přes `web-push`, neplatné (404/410) smaže |
| `src/services/emailIngest.js` | Přidat volání `pushNotify.sendToUser` do obou větví (pending vždy; auto-zařazeno jen když `notify_scope = 'all'`), best-effort v try/catch |
| `src/routes/settings.js` | Rozšířit GET/PUT o `notify_scope` |

### Závislosti a konfigurace

- npm: `web-push`
- env (Railway + lokálně): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:tomas.strida@gmail.com`)
- VAPID klíče se vygenerují jednou (`web-push generate-vapid-keys`) a uloží do env. **Nikdy ne do gitu.**

## Datový model

### Tabulka `push_subscriptions`

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  user_agent  TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);
```

`endpoint` je UNIQUE — re-subscribe stejného zařízení přepíše (ON CONFLICT) místo
duplicity.

### Nastavení `settings.notify_scope`

```sql
ALTER TABLE settings ADD COLUMN notify_scope TEXT DEFAULT 'pending_only';
-- hodnoty: 'off' | 'pending_only' (default) | 'all'
--   off          → žádné push (přepíše i registrovaný odběr na zařízení)
--   pending_only → push jen pro nezařazené platby (default)
--   all          → push i pro automaticky zařazené platby
```

(Přidat v `initSchema()` do try/catch bloku jako ostatní migrace.)

## Obsah notifikace

- **Titulek:** `SPENDEX`
- **Tělo:** `AirBank 349 Kč • Albert — potřebuje kategorii`
  - U auto-zařazených: `AirBank 349 Kč • Albert → Potraviny`
- Částka i obchodník se zobrazují přímo (i na zamčené obrazovce) — vědomě
  schváleno uživatelem.
- `data.url = '/import'` pro deep-link při kliknutí.

## Error handling

- **Push je best-effort.** Selhání odeslání se zaloguje, ale **nikdy neshodí ani
  nezdrží** import platby (try/catch okolo volání v `emailIngest`).
- **Neplatné subscriptions:** odpověď 404/410 z push služby → řádek se smaže
  z `push_subscriptions`.
- **Permission denied:** UI v Nastavení zobrazí stav a návod, jak povolit
  notifikace v nastavení telefonu.
- **iOS mimo PWA:** pokud `Notification`/`PushManager` nejsou dostupné (appka
  není přidaná na plochu), UI zobrazí návod „Přidat na plochu" místo tlačítka.

## Testy

- **Unit** (`pushNotify`): odeslání projde všechny subscriptions uživatele;
  mock `web-push`; 410 → smazání řádku.
- **Unit** (trigger v `emailIngest`): push se zavolá pro `pending`, když
  `notify_scope ≠ 'off'`; pro auto-zařazenou platbu jen při `notify_scope = 'all'`;
  při `'off'` se nezavolá vůbec; selhání push neshodí ingest.
- **Manuální:** `POST /api/push/test` pošle testovací notifikaci na zařízení
  přihlášeného uživatele — ověření reálného doručení na iPhone.

## Návod pro uživatele (součást dodávky)

1. Otevři `spendex.uk` v **Safari** na iPhonu.
2. Tlačítko Sdílet → **Přidat na plochu**.
3. Otevři Spendex **z ikony na ploše** (ne ze Safari).
4. Nastavení → **Zapnout notifikace** → povol.

## Mimo rozsah (vědomě)

- Nativní aplikace (Expo/React Native).
- Broadcast notifikací oběma uživatelům (architektura připravena, zapnutí později).
- Push pro jiné události než příchozí platba (např. překročení budgetu) — možné
  rozšíření na stejné infrastruktuře.
