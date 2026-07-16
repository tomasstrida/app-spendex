'use strict';

// Kompletní číslo bankovního účtu: [předčíslí-]číslo/kódbanky.
// Aplikace pracuje VŽDY s kompletním číslem (porovnává se celý string),
// proto vstupy matcherů musí obsahovat i kód banky.
const FULL_ACCOUNT_RE = /^(?:\d{1,6}-)?\d{2,10}\/\d{4}$/;

/**
 * Normalizuje a zvaliduje vstup čísla účtu z formuláře.
 * '' / null / undefined → { value: null } (pole nevyplněno).
 * Mezery se ořežou; nekompletní/nevalidní formát → { error }.
 */
function parseAccountNumberField(raw, label = 'Číslo účtu') {
  if (raw == null || String(raw).trim() === '') return { value: null };
  const v = String(raw).replace(/\s/g, '');
  if (!FULL_ACCOUNT_RE.test(v)) {
    return { error: `${label} musí být kompletní včetně kódu banky, např. 123456789/0300 nebo 51-123456789/8060.` };
  }
  return { value: v };
}

module.exports = { FULL_ACCOUNT_RE, parseAccountNumberField };
