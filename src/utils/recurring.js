'use strict';

const MATCH_TOLERANCE_PCT = 5;

// Stabilní bankovní fakta (stejný princip jako ownAccountNumbers v scripts/seed/rules.js)
const savingsAccount = '1679014082';
const reserveAccount = '1679014066';
const reservePaidPatterns = ['JANA HRDLIČKOVÁ', 'Pražská energetika'];

/**
 * Stav fixní platby za období.
 * @returns 'ok' | 'mismatch' | 'missing' | null  (null = bez stavu)
 */
function paymentStatus(expected, actual, txCount) {
  if (!(expected > 0)) return null;
  if (!txCount || txCount === 0) return 'missing';
  const diffPct = (Math.abs(actual - expected) / expected) * 100;
  return diffPct <= MATCH_TOLERANCE_PCT ? 'ok' : 'mismatch';
}

function savingsNet({ deposits, withdrawals }) {
  return deposits - withdrawals;
}

function reserveBalance({ envelopeDeposits, najemSum, preSum, envelopeReturns }) {
  return envelopeDeposits - najemSum - preSum - envelopeReturns;
}

module.exports = {
  MATCH_TOLERANCE_PCT,
  savingsAccount,
  reserveAccount,
  reservePaidPatterns,
  paymentStatus,
  savingsNet,
  reserveBalance,
};
