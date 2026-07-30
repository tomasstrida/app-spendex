// Cloudflare Email Worker — příjem AirBank notifikací a přeposlaných Apple faktur,
// forward na Spendex webhook.
// Konfigurace přes Worker Variables/Secrets: WEBHOOK_URL, WEBHOOK_SECRET,
// EMAIL_APPLE_FORWARDER (adresa, ze které si uživatel přeposílá Apple faktury).
export default {
  async email(message, env) {
    const fromHeader = (message.headers.get('from') || '').toLowerCase();
    const subject = message.headers.get('subject') || '';

    // Vrstva 2 (brzká): obě povolené cesty stojí na `From` hlavičce, kterou ověřuje
    // Email Routing (SPF/DMARC) — obsah těla si odesílatel řídí sám, takže o propuštění
    // rozhodovat nesmí.
    // POZOR: Gmail forward (přes filtr) zachovává PŮVODNÍ obálku — From zůstane
    // info@airbank.cz. U ručně přeposlaných Apple faktur je From adresa uživatele
    // (EMAIL_APPLE_FORWARDER).
    const appleForwarder = (env.EMAIL_APPLE_FORWARDER || '').toLowerCase().trim();
    const isAirBank = fromHeader.includes('airbank.cz');
    const appleFromOk = !!appleForwarder && fromHeader.includes(appleForwarder);

    // Tenhle test je ZÁMĚRNĚ před čtením message.raw — u spamu se tělo vůbec nebufferuje.
    if (!isAirBank && !appleFromOk) {
      return; // tiše zahodit (spam / cizí e-maily na inbox@spendex.uk)
    }

    const rawText = await new Response(message.raw).text();

    // Doplňkový filtr OBSAHU (ne autentizace): u Apple cesty chceme vidět původního
    // odesílatele v těle a klíčové slovo jako CELÉ slovo — jinak by prošlo i „credit
    // card" z patičky. Primárně předmět, tělo je fallback.
    if (!isAirBank) {
      const APPLE_KEYWORD_RE = /\b(invoice|refund|credit note)\b/i;
      const isApple = rawText.toLowerCase().includes('no_reply@email.apple.com')
        && (APPLE_KEYWORD_RE.test(subject) || APPLE_KEYWORD_RE.test(rawText));
      if (!isApple) return;
    }

    const res = await fetch(env.WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': env.WEBHOOK_SECRET,
      },
      body: JSON.stringify({ envelope_from: message.from, from: message.headers.get('from') || '', subject, raw: rawText }),
    });
    if (!res.ok) {
      console.error(`Spendex webhook returned ${res.status}`);
    }
  },
};
