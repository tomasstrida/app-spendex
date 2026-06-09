'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEmailNotification } = require('./emailParser');

// Reálný vzorek: odchozí převod (BOM/zero-width znak za kódem schválně ponechán)
const OUTGOING = `Dobrý den,

zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 10,00 CZK. Dostupný zůstatek k 07.06.2026 v 17:47 je 4 934,46 CZK.

Pro úplnost uvádíme detaily této úhrady:

Odchozí úhrada na účet Tomáš Střída číslo 1679014138/3030
Částka: 10,00 CZK
Datum zaúčtování: 07.06.2026
Zpráva pro plátce: test 10 Kč
Kód transakce: 160610143222

Vaše Air Bank`;

test('odchozí převod: vytáhne všechna pole', () => {
  const tx = parseEmailNotification(OUTGOING);
  assert.equal(tx.external_id, '160610143222');
  assert.equal(tx.amount, -10);
  assert.equal(tx.direction, 'Odchozí');
  assert.equal(tx.currency, 'CZK');
  assert.equal(tx.source_account, '1679014023');
  assert.equal(tx.counterparty_account, '1679014138/3030');
  assert.equal(tx.description, 'Tomáš Střída');
  assert.equal(tx.note, 'test 10 Kč');
  assert.equal(tx.date, '2026-06-07');
  assert.equal(tx.tx_time, '17:47');
  assert.equal(tx.ab_category, '');
});

// Reálný AirBank formát příchozí úhrady: "Příchozí úhrada z účtu <jméno> číslo ..."
// (POZOR: NE "od" — to byl dřív špatný předpoklad, kvůli kterému se nevytáhl protiúčet
//  a interní převody spadaly do "Ostatní" místo "Převody".)
test('příchozí úhrada (reálný formát "z účtu"): kladná částka, protiúčet vytažen', () => {
  const incoming = `zůstatek na účtu Společný číslo 1679014023/3030 se zvýšil o částku 15,00 CZK. Dostupný zůstatek k 07.06.2026 v 22:21 je 4 890,66 CZK.

Příchozí úhrada z účtu Tomáš Střída číslo 1679014138/3030
Částka: 15,00 CZK
Datum zaúčtování: 07.06.2026
Zpráva pro příjemce: 15 back
Kód transakce: 160614737162`;
  const tx = parseEmailNotification(incoming);
  assert.equal(tx.amount, 15);
  assert.equal(tx.direction, 'Příchozí');
  assert.equal(tx.source_account, '1679014023');
  assert.equal(tx.description, 'Tomáš Střída');
  assert.equal(tx.counterparty_account, '1679014138/3030');
  assert.equal(tx.note, '15 back');
});

test('bez kódu transakce → null (unparsed)', () => {
  assert.equal(parseEmailNotification('nějaký marketingový e-mail bez transakce'), null);
});

test('bez částky → null', () => {
  assert.equal(parseEmailNotification('Kód transakce: 123\nžádná částka tu není'), null);
});

const CARD = `Dobrý den,

zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 482,00 CZK. Dostupný zůstatek k 08.06.2026 v 21:15 je 3 678,16 CZK.

Pro úplnost uvádíme detaily této úhrady:

Platba kartou (nezaúčtováno) v HAMR - BRANIK,RESTAURA, PRAHA 4, 000
Částka: 482,00 CZK
Karta: 516844******6062
Datum provedení: 08.06.2026
Kód transakce: 26918903543`;

test('platba kartou: vytáhne místo, poslední 4 karty, typ a datum provedení', () => {
  const tx = parseEmailNotification(CARD);
  assert.equal(tx.external_id, '26918903543');
  assert.equal(tx.amount, -482);
  assert.equal(tx.direction, 'Odchozí');
  assert.equal(tx.place, 'HAMR - BRANIK,RESTAURA, PRAHA 4');
  // kartová platba nemá řádek "úhrada na účet" → description fallbackuje na place (obchodníka)
  assert.equal(tx.description, 'HAMR - BRANIK,RESTAURA, PRAHA 4');
  assert.equal(tx.card_last4, '6062');
  assert.equal(tx.tx_type, 'Platba kartou');
  assert.equal(tx.date, '2026-06-08');
  assert.equal(tx.source_account, '1679014023');
  assert.equal(tx.counterparty_account, null);
});

test('převod nemá kartu ani místo', () => {
  const tx = parseEmailNotification(OUTGOING);
  assert.equal(tx.place, null);
  assert.equal(tx.card_last4, null);
  assert.equal(tx.tx_type, null);
});
