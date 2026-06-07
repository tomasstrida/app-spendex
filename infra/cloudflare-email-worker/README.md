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
   - `ALLOWED_SENDER` = tvoje Gmail adresa (envelope sender přeposílaných e-mailů)
6. **Routing rule:** Email Routing → Routes → `inbox@spendex.uk` → *Send to a Worker* → tento Worker.
7. **Gmail — ověřovací kód (POZOR na gotchu):** Gmail při přidání přeposílací adresy
   pošle ověřovací e-mail s envelope senderem `forwarding-noreply@google.com`
   (ne tvojí Gmail adresou). Tento Worker proto e-mail **tiše zahodí** — podmínka
   `envelopeFrom !== ALLOWED_SENDER` propustí jen e-maily z povolené adresy, takže
   se k ověřovacímu kódu jinak nedostaneš. Postup:
   1. **Dočasně přepni routing** pro `inbox@spendex.uk` na *Send to an address* a
      nasměruj ho na svou reálnou e-mailovou schránku (tu si v Cloudflare nejdřív
      ověříš). Díky tomu ti Gmail ověřovací e-mail dorazí do reálné schránky.
   2. V Gmailu (Nastavení → Přeposílání) přidej `inbox@spendex.uk`, opiš ověřovací
      kód z e-mailu, který ti přišel do reálné schránky, a potvrď.
   3. **Až poté** přepni routing pro `inbox@spendex.uk` zpět na *Send to a Worker*
      (tento Worker).
   4. Nakonec v Gmailu vytvoř filtr „od info@airbank.cz → přeposlat na
      inbox@spendex.uk".

## Bezpečnostní vrstvy

1. `WEBHOOK_SECRET` — posílá se v HLAVIČCE `x-webhook-secret` (ne v URL, aby se
   neobjevil v logu). Server odmítne POST bez správného secretu (HTTP 401).
2. `ALLOWED_SENDER` — Worker i server ověří envelope sender; server navíc
   vyžaduje `From` z `airbank.cz`.
3. Strukturální validace — server uloží jen e-maily s rozpoznatelnou transakcí;
   ostatní jako `unparsed` do review fronty.

## Poznámky

- Worker běží na Cloudflare (ne Railway) — je to nutné, protože MX směruje na
  Cloudflare a Email Worker se spouští při příchozím e-mailu. Edituje se přímo
  v dashboardu, bez build kroku.
- MIME dekódování (diakritika v quoted-printable/base64) řeší server přes
  `mailparser`, takže Worker posílá raw a zůstává triviální.
