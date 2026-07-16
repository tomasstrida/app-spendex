'use strict';

/**
 * Kanonické external_id pro transakci: <ref>-<čísloúčtu>.
 * Suffix čísla účtu odlišuje dvě nohy interního převodu (stejné AirBank ref
 * číslo na obou účtech) kvůli UNIQUE(user_id, external_id).
 *
 * POZOR: external_id je PERZISTENTNÍ dedup klíč — historické řádky ho mají
 * s číslem účtu BEZ kódu banky. I když aplikace jinak pracuje s kompletními
 * čísly (vč. /kódu), tady se kód banky záměrně odřezává, aby nové importy
 * dedupovaly proti existujícím transakcím. NEMĚNIT bez migrace external_id.
 * @param {string|null|undefined} ref  AirBank referenční číslo (t.external_id z parseru)
 * @param {string|number|null|undefined} accountNumber  číslo zdrojového účtu
 * @returns {string|null}
 */
function buildExternalId(ref, accountNumber) {
  if (!ref) return null;
  if (accountNumber === null || accountNumber === undefined || accountNumber === '') return String(ref);
  const legacyNum = String(accountNumber).replace(/\s/g, '').split('/')[0];
  return `${ref}-${legacyNum}`;
}

module.exports = { buildExternalId };
