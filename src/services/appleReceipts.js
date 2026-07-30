'use strict';
const { parseAppleInvoice } = require('../utils/appleInvoiceParser');
const { pickMatch } = require('../utils/appleMatch');
const loadUserRules = require('../utils/load-user-rules');
const { appleCandidateTransactions, transactionAlreadyTaken } = require('../utils/apple-candidates');
const { ownsSubcategory } = require('../utils/subcategory-ownership');

// Text, proti kterému se zkoušejí uživatelská pravidla („YouTube YouTube Premium (Monthly)").
function itemText(item) {
  return [item.app, item.description].filter(Boolean).join(' ');
}

// Subkategorie z prvního sedícího pravidla — ale jen když patří kategorii cílové
// transakce. Bez té kontroly by platba v Y_Licence dostala subkategorii ze Zábavy
// a rozpad `by_subcategory` (JOIN subcategories, sc.category_id) by přestal sedět.
// Stejný guard používá i PATCH transakce a CRUD pravidel.
function subcategoryForItem(db, userId, item, categoryId) {
  const text = itemText(item).toUpperCase();
  if (!text || categoryId == null) return null;
  for (const rule of loadUserRules(db, userId)) {
    if (rule.subcategory_id == null) continue;
    if (!text.includes(String(rule.pattern).toUpperCase())) continue;
    // Pravidlo sedí, ale míří jinam → chováme se, jako by žádné nesedlo.
    return ownsSubcategory(db, userId, rule.subcategory_id, categoryId) ? rule.subcategory_id : null;
  }
  return null;
}

// Poznámka se rozšiřuje, nikdy nepřepisuje — a nikdy nezdvojuje už přítomný text.
function appendNote(existing, addition) {
  const base = String(existing || '').trim();
  if (!addition) return base;
  if (base.includes(addition)) return base;
  return base ? `${base} · ${addition}` : addition;
}

function applyReceiptToTransaction(db, userId, receipt, transactionId) {
  const items = receipt.items || [];
  const label = items.length
    ? items.map(i => itemText(i)).filter(Boolean).join(' + ')
    : null;

  const tx = db.prepare('SELECT note, subcategory_id, category_id FROM transactions WHERE id = ? AND user_id = ?')
    .get(transactionId, userId);
  if (!tx) return { subcategory_id: null, note: null };

  // Subkategorii měníme jen u jednopoložkové faktury — u víc položek by jedna
  // subkategorie zamlčela zbytek, takže tam zůstane jen rozpis v poznámce.
  let subId = tx.subcategory_id;
  if (items.length === 1) {
    const found = subcategoryForItem(db, userId, items[0], tx.category_id);
    if (found != null) subId = found;
  }

  // Stejný strop jako PATCH transakce — poznámka je sloupec, ne archiv mailu.
  const note = appendNote(tx.note, label).slice(0, 500);
  db.prepare('UPDATE transactions SET subcategory_id = ?, note = ? WHERE id = ? AND user_id = ?')
    .run(subId ?? null, note, transactionId, userId);
  return { subcategory_id: subId ?? null, note };
}

function finishMatch(db, userId, receiptId, receipt, transactionId) {
  applyReceiptToTransaction(db, userId, receipt, transactionId);
  db.prepare("UPDATE apple_receipts SET status = 'matched', transaction_id = ?, matched_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(transactionId, receiptId, userId);
}

function ingestAppleInvoice(db, userId, rawBody) {
  const receipt = parseAppleInvoice(rawBody);

  if (!receipt) {
    const ins = db.prepare(`INSERT INTO apple_receipts (user_id, raw_text, status) VALUES (?, ?, 'unparsed')`)
      .run(userId, String(rawBody || ''));
    return { status: 'unparsed', receiptId: Number(ins.lastInsertRowid), transactionId: null };
  }

  // Idempotence: primárně přes order_id, u dokladů bez něj přes trojici
  // datum + částka + karta, ať opakované přeposlání nezaloží druhý záznam.
  //
  // Zahozené (`rejected`) faktury se do dedupu NEPOČÍTAJÍ — jinak by uživatel neměl
  // cestu zpět: zahozená faktura je v UI neviditelná a přeposlání by skončilo jako
  // „duplicate". Platí pro obě větve stejně.
  const existing = receipt.order_id
    ? db.prepare("SELECT id FROM apple_receipts WHERE user_id = ? AND order_id = ? AND status != 'rejected'")
        .get(userId, receipt.order_id)
    : db.prepare(`SELECT id FROM apple_receipts
                  WHERE user_id = ? AND order_id IS NULL AND status != 'rejected'
                    AND receipt_date IS ? AND total_amount IS ? AND card_last4 IS ?`)
        .get(userId, receipt.receipt_date, receipt.total_amount, receipt.card_last4);
  if (existing) return { status: 'duplicate', receiptId: existing.id, transactionId: null };

  // Zahozený záznam se stejným order_id nelze obejít INSERTem (UNIQUE index
  // user_id+order_id), takže ho oživíme na místě — přeposlání pak funguje jako nové.
  const revived = receipt.order_id
    ? db.prepare("SELECT id FROM apple_receipts WHERE user_id = ? AND order_id = ? AND status = 'rejected'")
        .get(userId, receipt.order_id)
    : null;

  const { status, transaction } = pickMatch(appleCandidateTransactions(db, userId, receipt), receipt);

  let receiptId;
  if (revived) {
    db.prepare(`
      UPDATE apple_receipts
      SET receipt_date = ?, total_amount = ?, is_refund = ?, card_last4 = ?, items_json = ?,
          raw_text = ?, status = ?, transaction_id = NULL, matched_at = NULL
      WHERE id = ? AND user_id = ?
    `).run(receipt.receipt_date, receipt.total_amount, receipt.is_refund ? 1 : 0, receipt.card_last4,
      JSON.stringify(receipt.items || []), String(rawBody || ''), status, revived.id, userId);
    receiptId = revived.id;
  } else {
    const ins = db.prepare(`
      INSERT INTO apple_receipts
        (user_id, order_id, receipt_date, total_amount, is_refund, card_last4, items_json, raw_text, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, receipt.order_id, receipt.receipt_date, receipt.total_amount,
      receipt.is_refund ? 1 : 0, receipt.card_last4, JSON.stringify(receipt.items || []),
      String(rawBody || ''), status);
    receiptId = Number(ins.lastInsertRowid);
  }

  if (status === 'matched') finishMatch(db, userId, receiptId, receipt, transaction.id);
  return { status, receiptId, transactionId: status === 'matched' ? transaction.id : null };
}

// Po importu Apple platby zkusí dorovnat faktury, které na ni čekaly.
function matchPendingForTransaction(db, userId, transactionId) {
  const tx = db.prepare('SELECT id, amount, date, card_last4 FROM transactions WHERE id = ? AND user_id = ?')
    .get(transactionId, userId);
  if (!tx) return 0;

  // Transakci, kterou už zabrala jiná spárovaná faktura, nepřepisujeme.
  if (transactionAlreadyTaken(db, userId, tx.id)) return 0;

  // Jen 'pending'. `ambiguous` znamená „víc kandidátů, rozhodne uživatel" — tady
  // by pickMatch dostal jediného kandidáta a stav by se sám tiše vyřešil.
  const rows = db.prepare("SELECT * FROM apple_receipts WHERE user_id = ? AND status = 'pending'")
    .all(userId);
  let matched = 0;
  for (const row of rows) {
    const receipt = {
      receipt_date: row.receipt_date,
      total_amount: row.total_amount,
      card_last4: row.card_last4,
      is_refund: !!row.is_refund,
      items: row.items_json ? JSON.parse(row.items_json) : [],
    };
    const r = pickMatch([tx], receipt);
    if (r.status !== 'matched') continue;
    finishMatch(db, userId, row.id, receipt, tx.id);
    matched++;
    break; // jedna platba = jedna faktura; další čekající zůstanou pending
  }
  return matched;
}

module.exports = { ingestAppleInvoice, applyReceiptToTransaction, matchPendingForTransaction };
