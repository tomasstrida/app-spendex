# Push notifikace — nastavení

Web Push notifikace upozorní na telefonu, když přijde platba z AirBank e-mailu,
která čeká na zařazení do kategorie (volitelně i na automaticky zařazené platby).

## 1. Server (jednorázově)

VAPID klíče jsou autentizace serveru vůči push službám (Apple/Google). Vygeneruj je:

```bash
npx web-push generate-vapid-keys
```

Nastav tři proměnné prostředí — **lokálně v `.env`** i **na Railway** (staging i prod):

```
VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:tomas.strida@gmail.com
```

- `VAPID_PUBLIC_KEY` se posílá do prohlížeče (není tajný).
- `VAPID_PRIVATE_KEY` **musí zůstat tajný** — jen na serveru, nikdy ne do gitu ani do frontend kódu.
- Bez těchto proměnných server push prostě neodesílá (best-effort no-op) — appka jinak funguje normálně.

Na Railway: Dashboard → projekt → service → **Variables** → přidej tři proměnné →
redeploy. Stejně pro staging i produkci (každé prostředí má vlastní proměnné).

## 2. Telefon (iPhone, každé zařízení zvlášť)

Web Push na iOS funguje **jen z aplikace přidané na plochu** (od iOS 16.4+).
V kartě Safari push nefunguje.

1. Otevři `https://spendex.uk` v **Safari**.
2. Tlačítko **Sdílet** → **Přidat na plochu**.
3. Otevři Spendex **z ikony na ploše** (ne ze Safari).
4. **Nastavení** → **Zapnout notifikace na tomto zařízení** → povol v systémovém dialogu.
5. Tlačítkem **Poslat testovací notifikaci** ověř doručení.

Na Androidu (Chrome/Firefox) stačí appku otevřít v prohlížeči a zapnout notifikace —
přidání na plochu není nutné.

## 3. Rozsah notifikací

V **Nastavení → Notifikace → Co notifikovat**:

| Volba | Chování |
|---|---|
| **Vypnuto** | Žádné push notifikace. |
| **Jen nezařazené platby** (výchozí) | Push jen u plateb, které čekají na zařazení do kategorie. |
| **Všechny platby** | Push i u plateb, které se zařadily automaticky. |

Nastavení je per-uživatel. Push chodí majiteli platby (uživateli, pod kterým
platba spadla do schránky). Architektura počítá s rozšířením na oba partnery.

## 4. Jak to funguje (stručně)

```
AirBank e-mail → webhook /api/email/inbound → ingestEmail
  → (platba bez kategorie) → záznam do email_inbox + Web Push
  → service worker /sw.js → notifikace na telefonu
  → klik → otevře Spendex na /import
```

Relevantní soubory:
- `src/services/pushNotify.js` — odeslání push + rozhodnutí dle nastavení
- `src/routes/push.js` — `/api/push/{public-key,subscribe,unsubscribe,test}`
- `src/routes/emailInbound.js` — trigger po ingestu (best-effort)
- `client/public/sw.js` — service worker
- `client/src/push.js` — klientská logika (registrace, subscribe)
