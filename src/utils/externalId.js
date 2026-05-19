'use strict';

/**
 * Kanonické external_id pro transakci: <ref>-<čísloúčtu>.
 * Suffix čísla účtu odlišuje dvě nohy interního převodu (stejné AirBank ref
 * číslo na obou účtech) kvůli UNIQUE(user_id, external_id).
 * @param {string|null|undefined} ref  AirBank referenční číslo (t.external_id z parseru)
 * @param {string|number|null|undefined} accountNumber  číslo zdrojového účtu
 * @returns {string|null}
 */
function buildExternalId(ref, accountNumber) {
  if (!ref) return null;
  if (accountNumber === null || accountNumber === undefined || accountNumber === '') return String(ref);
  return `${ref}-${accountNumber}`;
}

module.exports = { buildExternalId };
