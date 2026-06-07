'use strict';
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { simpleParser } = require('mailparser');
const db = require('../db/connection');
const { ingestEmail } = require('../services/emailIngest');

const inboundLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

// Vrstva 1: sdílený secret (query ?secret= nebo hlavička x-webhook-secret).
function checkSecret(req, res, next) {
  const expected = process.env.EMAIL_WEBHOOK_SECRET;
  const got = req.query.secret || req.get('x-webhook-secret');
  if (!expected || got !== expected) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// POST /api/email/inbound
// Body (JSON od Cloudflare Workeru): { envelope_from, from, subject, raw }
router.post('/inbound', inboundLimiter, checkSecret, async (req, res) => {
  try {
    const { envelope_from = '', from = '', raw = '' } = req.body || {};

    // Vrstva 2: whitelist odesílatele.
    // POZOR: Gmail forward (přes filtr) zachovává PŮVODNÍ obálku (envelope sender zůstane
    // info@airbank.cz), ne přeposílatele. Whitelist proto stavíme na: (a) From je z airbank.cz
    // A (b) e-mail prošel schránkou povoleného uživatele — Gmail forward zanechá jeho adresu
    // v hlavičkách (Delivered-To / X-Forwarded-For), takže ji najdeme v raw MIME.
    const allowed = (process.env.EMAIL_ALLOWED_SENDER || '').toLowerCase();
    const fromHdr = String(from).toLowerCase();
    const rawLower = String(raw).toLowerCase();
    if (!allowed || !fromHdr.includes('airbank.cz') || !rawLower.includes(allowed)) {
      return res.status(202).json({ status: 'ignored' });
    }

    // Dekóduj MIME → plain text (vrstva 3 strukturální validace je v parseru)
    let text = '';
    if (raw) {
      const parsed = await simpleParser(raw);
      text = parsed.text || parsed.html || '';
    }

    const result = ingestEmail(db, { userEmail: allowed, fromHeader: fromHdr, text });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
