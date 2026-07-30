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
const { extractAddress } = require('../utils/mail-address');

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

    // Vrstva 2: whitelist odesílatele — dvě povolené cesty. OBĚ stojí na VNĚJŠÍ
    // `from` hlavičce, kterou ověřuje Cloudflare Email Routing (SPF/DMARC).
    // Nic, co si píše odesílatel do TĚLA mailu, nesmí o propuštění rozhodovat.
    //
    // (a) AirBank notifikace: Gmail forward přes filtr zachovává PŮVODNÍ obálku, takže
    //     From zůstane info@airbank.cz. Navíc ověříme, že e-mail prošel schránkou
    //     povoleného uživatele (jeho adresa zůstane v hlavičkách raw MIME).
    //
    // (b) Apple faktury: uživatel je přeposílá RUČNĚ, takže From je jeho vlastní adresa.
    //     Vyžadujeme proto `EMAIL_APPLE_FORWARDER` (fallback `EMAIL_ALLOWED_SENDER`)
    //     jako PŘESNOU adresu (ne substring) ve `from` hlavičce NEBO v `envelope_from`.
    //     Stopy uvnitř mailu (no_reply@email.apple.com, klíčové slovo) jsou jen
    //     DOPLŇKOVÝ filtr obsahu, ne autentizace — kdokoli si je do těla napíše.
    //     Bez nastavené adresy je Apple cesta úplně vypnutá.
    //     POZOR (C1): substring přes CELOU `From` hlavičku (vč. display name) byl
    //     obejitelný hlavičkou typu `From: "tomas@icloud.com" <utocnik@evil.example>`
    //     — proto se porovnává jen adresní část vytažená ze závorek, na přesnou shodu.
    const allowed = (process.env.EMAIL_ALLOWED_SENDER || '').toLowerCase();
    const appleForwarder = (process.env.EMAIL_APPLE_FORWARDER || process.env.EMAIL_ALLOWED_SENDER || '')
      .toLowerCase().trim();
    const fromHdr = String(from).toLowerCase();
    const rawLower = String(raw).toLowerCase();
    const fromAddr = extractAddress(from);
    const envelopeFromAddr = extractAddress(envelope_from);

    // Klíčové slovo hledáme jako celé slovo — jinak by prošlo i „credit card"
    // nebo „accredited" schované v patičce/CSS mailu. Testujeme primárně proti
    // předmětu, tělo je jen fallback (tělo bývá zaplavené nesouvisejícím textem).
    const APPLE_KEYWORD_RE = /\b(invoice|refund|credit note)\b/i;
    const hasAppleSender = rawLower.includes('no_reply@email.apple.com');
    const hasAppleKeyword = APPLE_KEYWORD_RE.test(String(subject || '')) || APPLE_KEYWORD_RE.test(rawLower);
    const appleFromOk = !!appleForwarder
      && (fromAddr === appleForwarder || envelopeFromAddr === appleForwarder);

    // Precedence: když mail splní obě podmínky, vyhrává AirBank.
    const isAirBank = fromHdr.includes('airbank.cz') && !!allowed && rawLower.includes(allowed);
    const isApple = !isAirBank && appleFromOk && hasAppleSender && hasAppleKeyword;

    if (!isAirBank && !isApple) {
      // Diagnostika: bez logu by uživatel neměl jak zjistit, proč mu faktura „mizí".
      // Logujeme JEN důvod, nikdy obsah mailu.
      if (hasAppleSender || hasAppleKeyword) {
        const reason = !appleForwarder ? 'neni nastaveno EMAIL_APPLE_FORWARDER ani EMAIL_ALLOWED_SENDER'
          : !appleFromOk ? 'from hlavicka neodpovida EMAIL_APPLE_FORWARDER'
          : !hasAppleSender ? 'v tele chybi no_reply@email.apple.com'
          : 'chybi klicove slovo invoice/refund/credit note';
        console.warn(`[apple] mail neprosel whitelistem: ${reason}`);
      }
      return res.status(202).json({ status: 'ignored' });
    }

    // Dekóduj MIME (vrstva 3 strukturální validace je v parseru).
    // AirBank notifikace jsou plain text → text/plain má přednost.
    // Apple faktury jsou HTML e-maily (parser čte CSS třídy jako subscription-lockup,
    // payment-information) → text/html má přednost, jinak parser nenajde položky ani částku.
    let parsed = null;
    if (raw) parsed = await simpleParser(raw);

    if (isAirBank) {
      const text = parsed ? (parsed.text || parsed.html || '') : '';
      const result = ingestEmail(db, { userEmail: allowed, fromHeader: fromHdr, text });
      // Push je best-effort: případné selhání nesmí ovlivnit odpověď webhooku ani import.
      notifyForResult(db, result).catch((e) => console.error('[push] notifyForResult:', e && e.message));
      return res.json(result);
    } else if (isApple) {
      const html = parsed ? (parsed.html || parsed.text || '') : '';
      // Vlastník dat = uživatel Spendexu s povolenou adresou; když EMAIL_ALLOWED_SENDER
      // není nastavená, zkusíme adresu přeposílatele.
      const ownerEmail = allowed || appleForwarder;
      const user = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(ownerEmail);
      if (!user) {
        console.warn('[apple] mail prosel whitelistem, ale k adrese neexistuje uzivatel');
        return res.status(202).json({ status: 'ignored' });
      }
      const result = ingestAppleInvoice(db, user.id, html);
      return res.json(result);
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
