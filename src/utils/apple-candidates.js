'use strict';

// Kandidáti na spárování Apple faktury s bankovní platbou.
//
// Sdílené místo pro službu (automatické párování) i router (ruční výběr v UI).
// Kdyby dotaz existoval ve dvou kopiích, oprava pravidel by se udělala jen v jedné
// z nich — proto je tady jen jednou.
//
// Pravidla: Apple platby uživatele v širším okně ±10 dní (vlastní rozhodnutí dělá
// pickMatch/matchesReceipt) a NIKDY transakce, kterou už zabrala jiná spárovaná
// faktura — jinak by se na jednu platbu pověsilo víc faktur a jejich popisy by se
// slepily do jedné poznámky.

const SELECT_COLS = 't.id, t.date, t.amount, t.description, t.card_last4, t.note, t.subcategory_id, t.category_id';

// Predikát „je to Apple platba" — description NEBO place ZAČÍNÁ (ne obsahuje)
// 'APPLE.COM'. Prefix, ne substring: platba „PLATBA KARTOU APPLE.COM/BILL" nebo
// poznámka obsahující „apple.com" tímhle NEPROJDE. Používá se na třech místech
// (tady, routes/budget-items.js agregát „Apple bez faktury", routes/transactions.js
// filtr apple_merchant=1 pro proklik) — musí zůstat JEDNA definice, jinak se
// agregát a proklik rozejdou (viz feedback_link_aggregate_parity).
const APPLE_MERCHANT_SQL = "(UPPER(COALESCE(t.description,'')) LIKE 'APPLE.COM%' OR UPPER(COALESCE(t.place,'')) LIKE 'APPLE.COM%')";

// Vrátí true, když na transakci už ukazuje jiná faktura ve stavu 'matched'.
// `exceptReceiptId` vynechá vlastní fakturu (re-match téže faktury je v pořádku).
function transactionAlreadyTaken(db, userId, transactionId, exceptReceiptId = null) {
  return !!db.prepare(`
    SELECT 1 FROM apple_receipts
    WHERE user_id = ? AND transaction_id = ? AND status = 'matched'
      AND (? IS NULL OR id != ?)
  `).get(userId, transactionId, exceptReceiptId, exceptReceiptId);
}

function appleCandidateTransactions(db, userId, receipt, opts = {}) {
  if (!receipt || !receipt.receipt_date) return [];
  const except = opts.exceptReceiptId ?? null;
  return db.prepare(`
    SELECT ${SELECT_COLS}
    FROM transactions t
    WHERE t.user_id = ?
      AND ${APPLE_MERCHANT_SQL}
      AND t.date >= date(?, '-10 days') AND t.date <= date(?, '+10 days')
      AND NOT EXISTS (
        SELECT 1 FROM apple_receipts ar
        WHERE ar.user_id = t.user_id AND ar.transaction_id = t.id
          AND ar.status = 'matched' AND (? IS NULL OR ar.id != ?)
      )
    ORDER BY t.date DESC, t.id DESC
  `).all(userId, receipt.receipt_date, receipt.receipt_date, except, except);
}

module.exports = { appleCandidateTransactions, transactionAlreadyTaken, APPLE_MERCHANT_SQL };
