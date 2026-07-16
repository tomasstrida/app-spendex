'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAirBankCSV } = require('./csvParser');

// Postaví AirBank CSV řádek (45 sloupců) z mapy {index: hodnota}.
function buildRow(vals) {
  const f = Array(45).fill('');
  for (const [i, v] of Object.entries(vals)) f[Number(i)] = v;
  return f.map(x => `"${x}"`).join(';');
}
// Hlavička – parser jen ověřuje, že sl. 0 obsahuje "Datum".
const HEADER = buildRow({ 0: 'Datum provedení' });

test('CSV: variabilní symbol (sl. 12) se mapuje', () => {
  const row = buildRow({
    0: '10/06/2026', 4: 'CZK', 5: '-1 234,56', 9: 'GLOBUS',
    12: '200232644', 32: '162182232012',
  });
  const [tx] = parseAirBankCSV(`${HEADER}\n${row}`);
  assert.equal(tx.variable_symbol, '200232644');
});

test('CSV: číslo karty (sl. 21) → card_last4 (poslední 4 číslice)', () => {
  const row = buildRow({
    0: '10/06/2026', 4: 'CZK', 5: '-1 234,56', 9: 'GLOBUS',
    21: '515735******0987', 32: '162182232013',
  });
  const [tx] = parseAirBankCSV(`${HEADER}\n${row}`);
  assert.equal(tx.card_last4, '0987');
});

test('CSV: prázdné číslo karty → card_last4 null', () => {
  const row = buildRow({ 0: '10/06/2026', 4: 'CZK', 5: '-1 234,56', 9: 'GLOBUS', 32: '162182232014' });
  const [tx] = parseAirBankCSV(`${HEADER}\n${row}`);
  assert.equal(tx.card_last4, null);
});

test('CSV: datum bere "Datum zaúčtování" (sl. 31), fallback "Datum provedení" (sl. 0)', () => {
  const settled = buildRow({
    0: '10/06/2026', 4: 'CZK', 5: '-100,00', 9: 'X', 31: '11/06/2026', 32: 'A1',
  });
  const [txSettled] = parseAirBankCSV(`${HEADER}\n${settled}`);
  assert.equal(txSettled.date, '2026-06-11', 'má být datum zaúčtování');

  // Nezaúčtováno (sl. 31 prázdný) → fallback na provedení
  const pending = buildRow({ 0: '10/06/2026', 4: 'CZK', 5: '-100,00', 9: 'X', 32: 'A2' });
  const [txPending] = parseAirBankCSV(`${HEADER}\n${pending}`);
  assert.equal(txPending.date, '2026-06-10', 'fallback na datum provedení');
});
