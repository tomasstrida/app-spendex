# Cloudflare Email Worker — Spendex e-mailový import

Přeposílá notifikační e-maily AirBank z Gmailu na Spendex webhook.

## Tok

AirBank → Gmail (auto-forward) → `inbox@spendex.uk` (MX na Cloudflare)
→ tento Email Worker → `POST https://<spendex>/api/email/inbound`

## Nastavení

1. **Doména na Cloudflare:** přidej `spendex.uk` do Cloudflare (nameservery na CF).
2. **Email Routing:** Dashboard → Email → Email Routing → zapni. Ověř doménu
   (Cloudflare přidá MX + TXT záznamy automaticky).
3. **Destination address / catch-all:** vytvoř adresu `inbox@spendex.uk`.
4. **Worker:** Dashboard → Workers & Pages → Create → vlož `worker.js`.
   - Žádný build, žádné npm — čistý ES modul, edituje se přímo v dashboardu.
5. **Worker Variables & Secrets** (Settings → Variables):
   - `WEBHOOK_URL` = `https://<spendex-railway-domain>/api/email/inbound`
   - `WEBHOOK_SECRET` = stejná hodnota jako `EMAIL_WEBHOOK_SECRET` na Railway
     (ukládej jako **Secret**, ne plain text)
   - `EMAIL_APPLE_FORWARDER` = adresa, ze které si ručně přeposíláš Apple faktury
     (stejná hodnota jako `EMAIL_APPLE_FORWARDER` na Railway). Když ji nenastavíš,
     Worker (stejně jako server) spadne na fallback `EMAIL_ALLOWED_SENDER` — nastav
     tedy aspoň jednu z těch dvou, jinak je Apple cesta ve Workeru úplně vypnutá.
     **Nastav vždy stejnou dvojici proměnných na Workeru i na Railway** — pokud
     server má nastavenou adresu, kterou Worker nezná (nebo naopak), Worker fakturu
     zahodí ještě před serverem a v serverovém logu se o tom nic neobjeví (mail se
     k serveru vůbec nedostane).
6. **Routing rule:** Email Routing → Routes → `inbox@spendex.uk` → *Send to a Worker* → tento Worker.
7. **Gmail — ověřovací kód (POZOR na gotchu):** Gmail při přidání přeposílací adresy
   pošle ověřovací e-mail s hlavičkou `From: forwarding-noreply@google.com`
   (ne tvojí Gmail adresou) a bez zmínky o Apple. Tento Worker proto e-mail
   **tiše zahodí** — filtr propustí jen `From` z `airbank.cz` nebo `From` s adresou
   `EMAIL_APPLE_FORWARDER`, takže se k ověřovacímu kódu jinak nedostaneš. Postup:
   1. **Dočasně přepni routing** pro `inbox@spendex.uk` na *Send to an address* a
      nasměruj ho na svou reálnou e-mailovou schránku (tu si v Cloudflare nejdřív
      ověříš). Díky tomu ti Gmail ověřovací e-mail dorazí do reálné schránky.
   2. V Gmailu (Nastavení → Přeposílání) přidej `inbox@spendex.uk`, opiš ověřovací
      kód z e-mailu, který ti přišel do reálné schránky, a potvrď.
   3. **Až poté** přepni routing pro `inbox@spendex.uk` zpět na *Send to a Worker*
      (tento Worker).
   4. Nakonec v Gmailu vytvoř filtr „od info@airbank.cz → přeposlat na
      inbox@spendex.uk".

## Apple faktury

Worker vedle AirBank notifikací propouští i Apple faktury/dobropisy, které si
uživatel RUČNĚ přeposílá ze své vlastní adresy na `inbox@spendex.uk`. Protože
jde o ruční přeposlání, `From` hlavička patří uživateli — původní odesílatel
`no_reply@email.apple.com` zůstává až v těle přeposlaného mailu.

**Whitelist stojí na `From` hlavičce, ne na obsahu těla.** Tělo si odesílatel plně
řídí, takže by stačilo napsat si do něj správné řetězce a projít. `From` naproti tomu
ověřuje Cloudflare Email Routing (SPF/DMARC). Worker i server proto vyžadují:

- AirBank cesta: `From` obsahuje `airbank.cz` (server navíc `EMAIL_ALLOWED_SENDER`
  v raw MIME — důkaz, že mail prošel schránkou uživatele),
- Apple cesta: adresní část `From` (bez display name, viz níže) se PŘESNĚ shoduje
  s `EMAIL_APPLE_FORWARDER` (fallback `EMAIL_ALLOWED_SENDER`; když není nastavená
  ani jedna, je Apple cesta ve Workeru i na serveru **vypnutá**).

**Adresa se porovnává, ne substring celé hlavičky.** `From` může mít tvar
`Jméno <adresa@domena>` — display name („Jméno") si odesílatel volí zcela sám a
SPF/DMARC ho nijak nekryje. Dřívější verze porovnávala `.includes()` přes CELOU
hlavičku, takže hlavička `From: "tomas@icloud.com" <utocnik@evil.example>` prošla,
i když skutečná adresa patřila útočníkovi (povolená adresa byla schovaná v display
name). Worker i server proto vždy vytáhnou jen adresu ze závorek (bez závorek berou
celý řetězec) a porovnávají ji case-insensitive na přesnou shodu — na serveru pomocná
funkce `src/utils/mail-address.js`, ve Workeru stejná logika okopírovaná inline
(Worker je ESM a nemůže importovat z `src/`; při úpravě jedné udržuj i druhou).
Server navíc zkouší i `envelope_from`, které Worker posílá vedle `from` — stačí, aby
sedla adresa v jednom z obou polí.

Stopy v těle (`no_reply@email.apple.com` + celé slovo `invoice`/`refund`/`credit note`,
primárně v předmětu) jsou až DRUHÝ, obsahový filtr — ne autentizace. Worker je testuje
až po `From` kontrole, aby se u spamu vůbec nebufferovalo tělo mailu. Když mail splní
obě cesty zároveň, vyhrává AirBank (stejná precedence na serveru).

Server e-maily, které vypadají jako Apple faktura, ale whitelistem neprojdou, loguje
přes `console.warn` s důvodem (bez obsahu mailu) — jinak by feature mlčky nikdy
nevystřelila a nešlo by zjistit proč.

**Po úpravě `worker.js` je nutné Worker znovu nasadit ručně** přes Cloudflare
dashboard (vlož nový obsah souboru) nebo přes `wrangler deploy` — deploy
Workeru **není** součástí Railway pipeline, žádný push do staging/main ho
nenasadí.

## Bezpečnostní vrstvy

1. `WEBHOOK_SECRET` — posílá se v HLAVIČCE `x-webhook-secret` (ne v URL, aby se
   neobjevil v logu). Server odmítne POST bez správného secretu (HTTP 401).
2. Filtr odesílatele podle `From` hlavičky (ověřuje ji Email Routing přes SPF/DMARC) —
   Worker i server propustí jen `From` z `airbank.cz` NEBO `From` s adresou
   `EMAIL_APPLE_FORWARDER`. Server u AirBank cesty navíc vyžaduje
   `EMAIL_ALLOWED_SENDER` v raw MIME, u Apple cesty stopy Apple faktury v těle
   (obsahový filtr, ne autentizace).
3. Strukturální validace — server uloží jen e-maily s rozpoznatelnou transakcí;
   ostatní jako `unparsed` do review fronty.

## Poznámky

- Worker běží na Cloudflare (ne Railway) — je to nutné, protože MX směruje na
  Cloudflare a Email Worker se spouští při příchozím e-mailu. Edituje se přímo
  v dashboardu, bez build kroku.
- MIME dekódování (diakritika v quoted-printable/base64) řeší server přes
  `mailparser`, takže Worker posílá raw a zůstává triviální.
