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

// Zobrazované "Obchodní místo". Parsery plní `place` jen u kartových plateb —
// u QR plateb a převodů zůstává prázdné, i když z transakce víme, komu peníze šly.
// Fallback je čistě zobrazovací: DB se nemění, aby se nerozšířil haystack
// textových pravidel (apply-rules) ani matcheru fixních plateb.
// Vrací null, když není co zobrazit — volající vykreslí „—".
export function placeDisplay(tx, nameMap) {
  if (!tx) return null;
  const place = (tx.place || '').trim();
  if (place) return { text: place, derived: false };

  const cp = normalizeAccountNumber(tx.counterparty_account);
  if (!cp) return null;

  const name = accountNameFor(cp, nameMap);
  return { text: name ? `${cp} · ${name}` : cp, derived: true };
}
