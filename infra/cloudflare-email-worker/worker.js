// Cloudflare Email Worker — příjem AirBank notifikací a forward na Spendex webhook.
// Konfigurace přes Worker Variables/Secrets: WEBHOOK_URL, WEBHOOK_SECRET, ALLOWED_SENDER.
export default {
  async email(message, env) {
    const fromHeader = message.headers.get('from') || '';

    // Vrstva 2 (brzká): propustit jen notifikace od AirBank.
    // POZOR: Gmail forward (přes filtr) zachovává PŮVODNÍ obálku — message.from zůstane
    // info@airbank.cz, NE přeposílatel. Whitelist proto stavíme na From hlavičce; server
    // pak navíc ověří, že e-mail prošel schránkou povoleného uživatele (EMAIL_ALLOWED_SENDER).
    if (!fromHeader.toLowerCase().includes('airbank.cz')) {
      return; // tiše zahodit (spam / cizí e-maily na inbox@spendex.uk)
    }

    const raw = await new Response(message.raw).text();
    const subject = message.headers.get('subject') || '';

    const res = await fetch(env.WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': env.WEBHOOK_SECRET,
      },
      body: JSON.stringify({ envelope_from: message.from, from: fromHeader, subject, raw }),
    });
    if (!res.ok) {
      console.error(`Spendex webhook returned ${res.status}`);
    }
  },
};
