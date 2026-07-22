'use strict';
const { parseEmailNotification } = require('../utils/emailParser');
const { buildExternalId } = require('../utils/externalId');
const applyRules = require('../utils/apply-rules');
const seedRules = require('../../scripts/seed/rules');
const loadUserRules = require('../utils/load-user-rules');
const transferCategoryName = require('../utils/transfer-category');

const TX_INSERT = `INSERT OR IGNORE INTO transactions
    (user_id, category_id, subcategory_id, amount, currency, date, description, note, source, external_id,
     tx_time, tx_type, counterparty_account, entered_by, place, account_id, ab_category, variable_symbol, card_last4)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'airbank-email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertTx(db, userId, tx, categoryId, extId, subcategoryId) {
  return db.prepare(TX_INSERT).run(
    userId, categoryId || null, subcategoryId ?? null, tx.amount, tx.currency, tx.date, tx.description, tx.note || '',
    extId || null, tx.tx_time || null, tx.tx_type || null,
    tx.counterparty_account || null, tx.entered_by || null, tx.place || null,
    tx.account_id ?? null, tx.ab_category || null, tx.variable_symbol || null, tx.card_last4 || null);
}

// Rozhodne kategorii. account = řádek accounts ({id, account_number}) nebo null.
function categorize(db, userId, tx, account) {
  const rules = { ...seedRules, textOverrides: loadUserRules(db, userId) };
  // Kategorie interních převodů se identifikuje přes type=4, ne přes název —
  // aby přejmenování kategorie v UI nerozbilo L0 detekci převodů.
  const transferName = transferCategoryName(db, userId);
  if (transferName) rules.internalTransferCategory = transferName;
  const { category: catName, subcategory_id } = applyRules(tx, account ? { account_number: account.account_number } : null, rules);
  const row = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ?').get(userId, catName);
  const categoryId = row ? row.id : null;
  const confident = catName !== rules.fallbackCategory && categoryId != null;
  return { catName, categoryId, subcategory_id, confident };
}

// Uloží transakci (jisté) nebo do review fronty (nejisté). Vrací result vč. notifyUserId.
function classifyAndStore(db, userId, tx, account, extId, notifyUserId, text) {
  const accId = account ? account.id : null;
  const { catName, categoryId, subcategory_id, confident } = categorize(db, userId, tx, account);
  if (confident) {
    const r = insertTx(db, userId, { ...tx, account_id: accId }, categoryId, extId, subcategory_id);
    const transactionId = r.changes > 0
      ? Number(r.lastInsertRowid)
      : (db.prepare('SELECT id FROM transactions WHERE user_id = ? AND external_id = ?').get(userId, extId)?.id ?? null);
    return {
      status: 'imported', external_id: extId, userId, notifyUserId,
      transactionId, txDate: tx.date,
      notify: { amount: tx.amount, currency: tx.currency, merchant: tx.place || tx.description || null, categoryName: catName },
    };
  }
  const ins = db.prepare(`INSERT INTO email_inbox (user_id, received_at, raw_text, parsed_json, external_id, suggested_category_id, status)
              VALUES (?, datetime('now'), ?, ?, ?, ?, 'pending')`)
    .run(userId, text || '', JSON.stringify({ ...tx, account_id: accId }), extId || null, categoryId);
  return {
    status: 'pending', external_id: extId, userId, notifyUserId,
    inboxId: Number(ins.lastInsertRowid),
    notify: { amount: tx.amount, currency: tx.currency, merchant: tx.place || tx.description || null, categoryName: null },
  };
}

function ingestEmail(db, { userEmail, text }) {
  const user = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(userEmail || '');
  if (!user) return { status: 'ignored' };
  const userId = user.id;

  const tx = parseEmailNotification(text);
  if (!tx) {
    db.prepare(`INSERT INTO email_inbox (user_id, received_at, raw_text, parsed_json, external_id, suggested_category_id, status)
                VALUES (?, datetime('now'), ?, NULL, NULL, NULL, 'unparsed')`).run(userId, text || '');
    return { status: 'unparsed' };
  }

  const account = tx.source_account
    ? db.prepare('SELECT id, account_number FROM accounts WHERE user_id = ? AND account_number = ?').get(userId, tx.source_account)
    : null;

  const extId = buildExternalId(tx.external_id, tx.source_account);
  if (extId) {
    if (db.prepare('SELECT 1 FROM transactions WHERE user_id = ? AND external_id = ?').get(userId, extId))
      return { status: 'duplicate', external_id: extId };
    if (db.prepare("SELECT 1 FROM email_inbox WHERE user_id = ? AND external_id = ? AND status IN ('pending','awaiting_card')").get(userId, extId))
      return { status: 'duplicate', external_id: extId };
  }

  // Routing podle karty
  let notifyUserId = userId; // fallback: vlastník dat
  if (tx.card_last4) {
    let card = db.prepare('SELECT assigned_user_id FROM cards WHERE data_owner_id = ? AND last4 = ?').get(userId, tx.card_last4);
    if (!card) {
      const hasMembers = db.prepare('SELECT 1 FROM household_members WHERE data_owner_id = ? LIMIT 1').get(userId);
      const assignTo = hasMembers ? null : userId; // solo → auto-přiřaď vlastníkovi
      db.prepare('INSERT OR IGNORE INTO cards (data_owner_id, last4, assigned_user_id) VALUES (?, ?, ?)').run(userId, tx.card_last4, assignTo);
      card = { assigned_user_id: assignTo };
    }
    if (card.assigned_user_id == null) {
      // Neznámá / nepřiřazená karta → drž transakci
      const ins = db.prepare(`INSERT INTO email_inbox (user_id, received_at, raw_text, parsed_json, external_id, suggested_category_id, status)
                  VALUES (?, datetime('now'), ?, ?, ?, NULL, 'awaiting_card')`)
        .run(userId, text || '', JSON.stringify({ ...tx, account_id: account ? account.id : null }), extId || null);
      return {
        status: 'awaiting_card', external_id: extId, userId,
        inboxId: Number(ins.lastInsertRowid),
        notify: {
          amount: tx.amount, currency: tx.currency,
          merchant: tx.place || tx.description || null,
          unknownCard: true, last4: tx.card_last4,
        },
        broadcast: true,
      };
    }
    notifyUserId = card.assigned_user_id;
  }

  return classifyAndStore(db, userId, tx, account, extId, notifyUserId, text);
}

// Uvolní zadržené platby pro nově přiřazenou kartu. Vrací počet zpracovaných.
function releaseHeldCard(db, dataOwnerId, last4) {
  const rows = db.prepare("SELECT * FROM email_inbox WHERE user_id = ? AND status = 'awaiting_card'").all(dataOwnerId);
  let released = 0;
  for (const row of rows) {
    if (!row.parsed_json) continue;
    const tx = JSON.parse(row.parsed_json);
    if (String(tx.card_last4) !== String(last4)) continue;
    const account = tx.account_id != null
      ? db.prepare('SELECT id, account_number FROM accounts WHERE id = ?').get(tx.account_id)
      : null;
    const { categoryId, subcategory_id, confident } = categorize(db, dataOwnerId, tx, account);
    if (confident) {
      insertTx(db, dataOwnerId, tx, categoryId, row.external_id, subcategory_id);
      db.prepare("UPDATE email_inbox SET status = 'imported' WHERE id = ?").run(row.id);
    } else {
      db.prepare("UPDATE email_inbox SET status = 'pending', suggested_category_id = ? WHERE id = ?").run(categoryId, row.id);
    }
    released++;
  }
  return released;
}

// Znovu projede pending frontu a co je nově „jisté" (např. po zavedení type=4
// u kategorie převodů, nebo po doplnění pravidla) přesune do transactions.
// Nejisté položky nechá pending, jen zpřesní suggested_category_id. Vrací počet
// přesunutých. Idempotentní: OR IGNORE na external_id chrání před duplikáty.
function recategorizePending(db, dataOwnerId) {
  const rows = db.prepare("SELECT * FROM email_inbox WHERE user_id = ? AND status = 'pending'").all(dataOwnerId);
  let moved = 0;
  for (const row of rows) {
    if (!row.parsed_json) continue;
    const tx = JSON.parse(row.parsed_json);
    const account = tx.account_id != null
      ? db.prepare('SELECT id, account_number FROM accounts WHERE id = ?').get(tx.account_id)
      : null;
    const { categoryId, subcategory_id, confident } = categorize(db, dataOwnerId, tx, account);
    if (confident) {
      insertTx(db, dataOwnerId, tx, categoryId, row.external_id, subcategory_id);
      db.prepare("UPDATE email_inbox SET status = 'imported' WHERE id = ?").run(row.id);
      moved++;
    } else if (categoryId !== row.suggested_category_id) {
      db.prepare('UPDATE email_inbox SET suggested_category_id = ? WHERE id = ?').run(categoryId, row.id);
    }
  }
  return moved;
}

module.exports = { ingestEmail, releaseHeldCard, categorize, recategorizePending };
