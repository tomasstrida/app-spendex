// Cloudflare Email Worker — příjem AirBank notifikací a forward na Spendex webhook.
// Konfigurace přes Worker Variables/Secrets: WEBHOOK_URL, WEBHOOK_SECRET.
// (Worker sám žádnou "povolenou adresu" nekontroluje — to dělá až server, viz níže.)
export default {
  async email(message, env) {
    const fromHeader = message.headers.get('from') || '';

    // Vrstva 2 (brzká): propustit notifikace od AirBank a přeposlané Apple faktury.
    // POZOR: Gmail forward (přes filtr) zachovává PŮVODNÍ obálku — message.from zůstane
    // info@airbank.cz, NE přeposílatel. U ručně přeposlaných Apple faktur je to naopak:
    // From je adresa uživatele, původní Apple odesílatel zůstane až v těle. Server pak
    // v obou případech ověří, že e-mail prošel schránkou povoleného uživatele.
    const rawText = await new Response(message.raw).text();
    const subject = message.headers.get('subject') || '';
    // Klíčové slovo jako celé slovo — jinak by prošlo i „credit card" schované v patičce.
    // Testujeme primárně proti předmětu, tělo je jen fallback.
    const APPLE_KEYWORD_RE = /\b(invoice|refund|credit note)\b/i;
    const isAirBank = fromHeader.toLowerCase().includes('airbank.cz');
    const isApple = rawText.toLowerCase().includes('no_reply@email.apple.com')
      && (APPLE_KEYWORD_RE.test(subject) || APPLE_KEYWORD_RE.test(rawText));
    // Precedence: při shodě obou podmínek vyhrává AirBank (viz server, stejná logika).
    if (!isAirBank && !isApple) {
      return; // tiše zahodit (spam / cizí e-maily na inbox@spendex.uk)
    }

    const res = await fetch(env.WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': env.WEBHOOK_SECRET,
      },
      body: JSON.stringify({ envelope_from: message.from, from: fromHeader, subject, raw: rawText }),
    });
    if (!res.ok) {
      console.error(`Spendex webhook returned ${res.status}`);
    }
  },
};
