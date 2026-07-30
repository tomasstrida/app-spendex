'use strict';
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { simpleParser } = require('mailparser');
const db = require('../db/connection');
const { ingestEmail } = require('../services/emailIngest');
const { notifyForResult } = require('../services/pushNotify');
const { ingestAppleInvoice } = require('../services/appleReceipts');

const inboundLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

// Vrstva 1: sdílený secret (query ?secret= nebo hlavička x-webhook-secret).
function checkSecret(req, res, next) {
  const expected = process.env.EMAIL_WEBHOOK_SECRET;
  const got = req.query.secret || req.get('x-webhook-secret') || '';
  if (!expected) return res.status(401).json({ error: 'unauthorized' });
  const a = Buffer.from(String(got));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// POST /api/email/inbound
// Body (JSON od Cloudflare Workeru): { envelope_from, from, subject, raw }
router.post('/inbound', inboundLimiter, checkSecret, async (req, res) => {
  try {
    const { envelope_from = '', from = '', subject = '', raw = '' } = req.body || {};

    if (typeof raw === 'string' && raw.length > 1_000_000) {
      return res.status(413).json({ error: 'Příliš velká zpráva.' });
    }

    // Vrstva 2: whitelist odesílatele — dvě povolené cesty.
    //
    // (a) AirBank notifikace: Gmail forward přes filtr zachovává PŮVODNÍ obálku, takže
    //     From zůstane info@airbank.cz. Navíc ověříme, že e-mail prošel schránkou
    //     povoleného uživatele (jeho adresa zůstane v hlavičkách raw MIME).
    //
    // (b) Apple faktury: uživatel je přeposílá RUČNĚ, takže From je jeho vlastní adresa
    //     a whitelist musí stát na původním Apple odesílateli uvnitř mailu. Vědomý
    //     kompromis: hlavičku uvnitř přeposlaného mailu lze zfalšovat, ale faktura nikdy
    //     nezaloží transakci ani nezmění částku — nejhorší následek je špatná poznámka.
    const allowed = (process.env.EMAIL_ALLOWED_SENDER || '').toLowerCase();
    const fromHdr = String(from).toLowerCase();
    const rawLower = String(raw).toLowerCase();
    if (!allowed || !rawLower.includes(allowed)) {
      return res.status(202).json({ status: 'ignored' });
    }

    // Klíčové slovo hledáme jako celé slovo — jinak by prošlo i „credit card"
    // nebo „accredited" schované v patičce/CSS mailu. Testujeme primárně proti
    // předmětu, tělo je jen fallback (tělo bývá zaplavené nesouvisejícím textem).
    const APPLE_KEYWORD_RE = /\b(invoice|refund|credit note)\b/i;
    const isAirBank = fromHdr.includes('airbank.cz');
    const isApple = rawLower.includes('no_reply@email.apple.com')
      && (APPLE_KEYWORD_RE.test(String(subject || '')) || APPLE_KEYWORD_RE.test(rawLower));
    if (!isAirBank && !isApple) {
      return res.status(202).json({ status: 'ignored' });
    }

    // Dekóduj MIME (vrstva 3 strukturální validace je v parseru).
    // AirBank notifikace jsou plain text → text/plain má přednost.
    // Apple faktury jsou HTML e-maily (parser čte CSS třídy jako subscription-lockup,
    // payment-information) → text/html má přednost, jinak parser nenajde položky ani částku.
    let parsed = null;
    if (raw) parsed = await simpleParser(raw);

    // Precedence: když mail splní obě podmínky (např. AirBank notifikace, která
    // náhodou zmíní slovo „invoice"), vyhrává AirBank — je to důvěryhodnější cesta
    // (From skutečně z airbank.cz), Apple whitelist je jen záložní pro ruční forward.
    if (isAirBank) {
      const text = parsed ? (parsed.text || parsed.html || '') : '';
      const result = ingestEmail(db, { userEmail: allowed, fromHeader: fromHdr, text });
      // Push je best-effort: případné selhání nesmí ovlivnit odpověď webhooku ani import.
      notifyForResult(db, result).catch((e) => console.error('[push] notifyForResult:', e && e.message));
      return res.json(result);
    } else if (isApple) {
      const html = parsed ? (parsed.html || parsed.text || '') : '';
      const user = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(allowed);
      if (!user) return res.status(202).json({ status: 'ignored' });
      const result = ingestAppleInvoice(db, user.id, html);
      return res.json(result);
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
