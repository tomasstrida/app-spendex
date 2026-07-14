'use strict';

const MATCH_TOLERANCE_PCT = 5;

// Stabilní bankovní fakta (stejný princip jako ownAccountNumbers v scripts/seed/rules.js)
const savingsAccount = '1679014082';
const reserveAccount = '1679014066';
const reservePaidPatterns = ['JANA HRDLIČKOVÁ', 'Pražská energetika'];
const mainAccount = '1679014138';      // Hlavní (transit, zdroj „dotace" pro Nepravidelné)
const variableAccount = '1679014074';  // Nepravidelné (pool, ze kterého se platí roční výdaje)

/**
 * Stav fixní platby: skutečná částka vůči akceptovanému rozmezí [min, max].
 * @returns 'ok' | 'mismatch' | 'missing' | null  (null = rozmezí nedefinováno)
 */
function paymentStatus(min, max, actual, txCount) {
  if (!txCount || txCount === 0) return 'missing';
  if (min == null || max == null) return null;
  return (actual >= min && actual <= max) ? 'ok' : 'mismatch';
}

/**
 * Stav příjmu za období. Na rozdíl od paymentStatus je přebytek (skutečnost
 * nad plán) v pořádku – penalizuje se jen výpadek pod plán.
 * @returns 'ok' | 'mismatch' | 'missing' | null
 */
function incomeStatus(expected, actual, txCount) {
  if (!(expected > 0)) return null;
  if (!txCount || txCount === 0) return 'missing';
  const floor = expected * (1 - MATCH_TOLERANCE_PCT / 100);
  return actual >= floor ? 'ok' : 'mismatch';
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
  mainAccount,
  variableAccount,
  paymentStatus,
  incomeStatus,
  savingsNet,
  reserveBalance,
};
