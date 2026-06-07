// Cloudflare Email Worker — příjem AirBank notifikací a forward na Spendex webhook.
// Konfigurace přes Worker Variables/Secrets: WEBHOOK_URL, WEBHOOK_SECRET, ALLOWED_SENDER.
export default {
  async email(message, env) {
    const allowed = (env.ALLOWED_SENDER || '').toLowerCase();
    const envelopeFrom = (message.from || '').toLowerCase();

    // Vrstva 2 (brzká): zahoď cokoli, co nepřišlo z povolené (přeposílací) adresy.
    if (!allowed || envelopeFrom !== allowed) {
      return; // tiše zahodit
    }

    const raw = await new Response(message.raw).text();
    const fromHeader = message.headers.get('from') || '';
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
