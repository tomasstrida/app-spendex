// Mapování bankovního čísla účtu na lidský název interního účtu.
// counterparty_account má formát "1679014082/3030" (s kódem banky), případně
// s předčíslím "19-1679014082/3030". V tabulce accounts je holé "1679014082".

export function normalizeAccountNumber(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  s = s.split('/')[0];            // odřízni /kód banky
  if (s.includes('-')) s = s.split('-').pop(); // odřízni předčíslí (19-…)
  return s.trim();
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
