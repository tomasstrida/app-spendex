// Mapování bankovního čísla účtu na lidský název interního účtu.
// Identita účtu = KOMPLETNÍ číslo "[předčíslí-]číslo/kódbanky" — porovnává se
// celý string, ořezávají se jen mezery. Tabulka accounts drží plná čísla.

export function normalizeAccountNumber(raw) {
  if (!raw) return '';
  return String(raw).replace(/\s/g, '');
}

export function buildAccountNameMap(accounts) {
  const map = new Map();
  for (const a of accounts || []) {
    if (a.account_number) map.set(normalizeAccountNumber(a.account_number), a.name);
  }
  return map;
}

// Vrátí název interního účtu pro dané číslo, nebo null (externí protistrana).
export function accountNameFor(counterpartyAccount, nameMap) {
  if (!counterpartyAccount || !nameMap) return null;
  return nameMap.get(normalizeAccountNumber(counterpartyAccount)) || null;
}
