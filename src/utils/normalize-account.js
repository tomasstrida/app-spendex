'use strict';
// Identita účtu = kompletní číslo [předčíslí-]číslo/kódbanky; ořezávají se jen mezery.
function normalizeAccount(raw) {
  if (!raw) return '';
  return String(raw).replace(/\s/g, '');
}
module.exports = normalizeAccount;
