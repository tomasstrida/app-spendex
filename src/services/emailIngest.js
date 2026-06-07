'use strict';
const { parseEmailNotification } = require('../utils/emailParser');
const { buildExternalId } = require('../utils/externalId');
const applyRules = require('../utils/apply-rules');
const seedRules = require('../../scripts/seed/rules');

/**
 * Zpracuje jeden notifikační e-mail. Čistá vůči HTTP — dostává už dekódovaný text.
 * @param {import('better-sqlite3').Database} db
 * @param {{userEmail: string, fromHeader: string, text: string}} input
 * @returns {{status: 'imported'|'pending'|'unparsed'|'duplicate'|'ignored', external_id?: string}}
 */
function ingestEmail(db, { userEmail, text }) {
  // Whitelist je vrstva 2: e-mail musí patřit existujícímu uživateli (dle login e-mailu).
  const user = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(userEmail || '');
  if (!user) return { status: 'ignored' };
  const userId = user.id;

  const tx = parseEmailNotification(text);

  // Nerozpoznáno → unparsed, ulož raw (žádná ztráta dat)
  if (!tx) {
    db.prepare(`INSERT INTO email_inbox (user_id, received_at, raw_text, parsed_json, external_id, suggested_category_id, status)
                VALUES (?, datetime('now'), ?, NULL, NULL, NULL, 'unparsed')`).run(userId, text || '');
    return { status: 'unparsed' };
  }

  // Párování zdrojového účtu (číslo bez /kódbanky)
  const account = tx.source_account
    ? db.prepare('SELECT id, account_number FROM accounts WHERE user_id = ? AND account_number = ?')
        .get(userId, tx.source_account)
    : null;

  const extId = buildExternalId(tx.external_id, tx.source_account);

  // Dedup proti transactions i čekajícím pending položkám
  if (extId) {
    const inTx = db.prepare('SELECT 1 FROM transactions WHERE user_id = ? AND external_id = ?').get(userId, extId);
    if (inTx) return { status: 'duplicate', external_id: extId };
    const inPending = db.prepare("SELECT 1 FROM email_inbox WHERE user_id = ? AND external_id = ? AND status = 'pending'").get(userId, extId);
    if (inPending) return { status: 'duplicate', external_id: extId };
  }

  // Kategorizace: applyRules vrací jméno (L0>L3>L1>L2>fallback). ab_category z e-mailu
  // chybí, takže L2 nikdy nezabere. seedRules bez user-override (e-mail nemá UI mapping).
  const catName = applyRules(tx, account ? { account_number: account.account_number } : null, seedRules);
  const catIdByName = Object.fromEntries(
    db.prepare('SELECT id, name FROM categories WHERE user_id = ?').all(userId).map(r => [r.name, r.id])
  );
  const categoryId = catIdByName[catName] || null;
  const confident = catName !== seedRules.fallbackCategory && categoryId != null;

  if (confident) {
    db.prepare(`INSERT OR IGNORE INTO transactions
        (user_id, category_id, amount, currency, date, description, note, source, external_id,
         tx_time, tx_type, counterparty_account, entered_by, place, account_id, ab_category)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank-email', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, categoryId, tx.amount, tx.currency, tx.date, tx.description, tx.note || '',
           extId || null, tx.tx_time || null, tx.tx_type || null,
           tx.counterparty_account || null, tx.entered_by || null, tx.place || null,
           account ? account.id : null, tx.ab_category || null);
    return { status: 'imported', external_id: extId };
  }

  // fallback / kategorie chybí → review fronta
  db.prepare(`INSERT INTO email_inbox (user_id, received_at, raw_text, parsed_json, external_id, suggested_category_id, status)
              VALUES (?, datetime('now'), ?, ?, ?, ?, 'pending')`)
    .run(userId, text || '', JSON.stringify({ ...tx, account_id: account ? account.id : null }),
         extId || null, categoryId);
  return { status: 'pending', external_id: extId };
}

module.exports = { ingestEmail };
