import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savingsTransferView } from './savingsTransfer.js';

// Interní převod: transakce je zaúčtovaná na běžném účtu a spořicí je protistrana,
// takže `amount` je z pohledu běžného účtu (záporné = na spořicí přibylo).
test('interní vklad: záporná částka na běžném účtu = přírůstek na spořicím', () => {
  const v = savingsTransferView({ external: 0, amount: -5000, account_name: 'Hlavní', description: 'Spořicí účet 1' });
  assert.equal(v.onSavings, 5000);
  assert.equal(v.flow, 'Hlavní → Spořicí účet 1');
});

test('interní výběr: kladná částka na běžném účtu = úbytek ze spořicího', () => {
  const v = savingsTransferView({ external: 0, amount: 5000, account_name: 'Hlavní', description: 'Spořicí účet 1' });
  assert.equal(v.onSavings, -5000);
  assert.equal(v.flow, 'Spořicí účet 1 → Hlavní');
});

// Externí pohyb: transakce je zaúčtovaná přímo na spořicím účtu, druhou nohu nemá,
// takže `amount` je z pohledu spořicího účtu a strany toku jsou obrácené.
test('externí vklad zvenku: kladná částka = přírůstek, tok od protistrany', () => {
  const v = savingsTransferView({ external: 1, amount: 100, account_name: 'Spořicí-účet-1', description: 'Libor Bísek' });
  assert.equal(v.onSavings, 100);
  assert.equal(v.flow, 'Libor Bísek → Spořicí-účet-1');
});

test('připsaný úrok: popis transakce je protistranou toku', () => {
  const v = savingsTransferView({ external: 1, amount: 164.1, account_name: 'Spořicí-účet-1', description: 'Kreditní úrok od Air Bank' });
  assert.equal(v.onSavings, 164.1);
  assert.equal(v.flow, 'Kreditní úrok od Air Bank → Spořicí-účet-1');
});

test('externí odchozí platba ze spořicího: úbytek, tok ke protistraně', () => {
  const v = savingsTransferView({ external: 1, amount: -250, account_name: 'Spořicí-účet-1', description: 'Cizí příjemce' });
  assert.equal(v.onSavings, -250);
  assert.equal(v.flow, 'Spořicí-účet-1 → Cizí příjemce');
});

test('externí pohyb bez popisu použije číslo protiúčtu', () => {
  const v = savingsTransferView({ external: 1, amount: 50, account_name: 'Spořicí-účet-1', description: '', counterparty_account: '2222222222/0800' });
  assert.equal(v.flow, '2222222222/0800 → Spořicí-účet-1');
});

test('nespárovaný vlastní účet: zobrazí se jen známá strana', () => {
  const v = savingsTransferView({ external: 0, amount: -1000, account_name: null, description: 'Spořicí účet 1' });
  assert.equal(v.onSavings, 1000);
  assert.equal(v.flow, 'Spořicí účet 1');
});

test('interní převod bez popisu protistrany použije obecný název spořicího účtu', () => {
  const v = savingsTransferView({ external: 0, amount: -2000, account_name: 'Hlavní', description: '' });
  assert.equal(v.flow, 'Hlavní → Spořicí účet');
});
