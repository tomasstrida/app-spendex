'use strict';

// Párování Apple faktury s bankovní transakcí. Čistá logika bez DB, aby šla testovat
// samostatně; kandidáty vybírá volající (viz services/appleReceipts.js).

const DEFAULTS = { windowDays: 3, amountTolerance: 0.5 };

function daysApart(a, b) {
  const ms = Math.abs(new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`));
  return Math.round(ms / 86400000);
}

// Znaménko je součást klíče: nákup a jeho pozdější vrácení mají stejnou částku
// i blízké datum, takže bez něj by dobropis sedl na původní platbu.
function matchesReceipt(tx, receipt, opts = {}) {
  const { windowDays, amountTolerance } = { ...DEFAULTS, ...opts };
  if (!receipt || receipt.total_amount == null || !receipt.receipt_date) return false;
  if (!tx || tx.amount == null || !tx.date) return false;

  const wantsIncoming = !!receipt.is_refund;
  if (wantsIncoming ? !(tx.amount > 0) : !(tx.amount < 0)) return false;

  if (Math.abs(Math.abs(tx.amount) - receipt.total_amount) > amountTolerance) return false;
  if (daysApart(tx.date, receipt.receipt_date) > windowDays) return false;

  // Karta rozhoduje jen když ji mají obě strany — transakce z doby před v2.0.208
  // `card_last4` nemají a přišly by jinak o možnost spárování.
  if (tx.card_last4 && receipt.card_last4 && String(tx.card_last4) !== String(receipt.card_last4)) {
    return false;
  }
  return true;
}

function pickMatch(txs, receipt, opts = {}) {
  const candidates = (txs || []).filter(tx => matchesReceipt(tx, receipt, opts));
  if (candidates.length === 1) return { status: 'matched', transaction: candidates[0] };
  if (candidates.length === 0) return { status: 'pending', transaction: null };

  // Víc kandidátů: shoda na kartě je silnější signál než pouhá částka a datum.
  if (receipt.card_last4) {
    const byCard = candidates.filter(tx => String(tx.card_last4 || '') === String(receipt.card_last4));
    if (byCard.length === 1) return { status: 'matched', transaction: byCard[0] };
  }
  return { status: 'ambiguous', transaction: null };
}

module.exports = { daysApart, matchesReceipt, pickMatch };
