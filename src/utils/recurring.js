'use strict';


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
 * Stav příjmu za období. Bez tolerance — jakmile přijde cokoli, je to ok.
 * @returns 'ok' | 'missing' | null  (null = plán ≤ 0, missing = 0 tx)
 */
function incomeStatus(expected, actual, txCount) {
  if (!(expected > 0)) return null;      // není plán → bez statusu
  if (!txCount || txCount === 0) return 'missing';
  return 'ok';                            // přišlo cokoli → ok (rozdíl řeší UI)
}

function savingsNet({ deposits, withdrawals }) {
  return deposits - withdrawals;
}

function reserveBalance({ envelopeDeposits, najemSum, preSum, envelopeReturns }) {
  return envelopeDeposits - najemSum - preSum - envelopeReturns;
}

module.exports = {
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
