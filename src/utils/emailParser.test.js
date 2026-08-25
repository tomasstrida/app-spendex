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
  assert.equal(tx.source_account, '1679014023/3030');
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
  assert.equal(tx.source_account, '1679014023/3030');
  assert.equal(tx.description, 'Tomáš Střída');
  assert.equal(tx.counterparty_account, '1679014138/3030');
  assert.equal(tx.note, '15 back');
});

// Inkaso/SIPO: číslo účtu s předčíslím "19-2235210247/0800" (T-Mobile).
// Regrese: bez podpory předčíslí zůstala protistrana i description prázdné a fixní
// platba se nikdy nespárovala (matchuje se jen přes description LIKE).
test('odchozí úhrada na účet s předčíslím: vytáhne protistranu i protiúčet', () => {
  const tx = parseEmailNotification(`zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 2 581,96 CZK. Dostupný zůstatek k 15.06.2026 v 14:26 je 1 000,00 CZK.

Odchozí úhrada na účet T-Mobile Czech Republic a.s. číslo 19-2235210247/0800
Částka: 2 581,96 CZK
Datum zaúčtování: 15.06.2026
Zpráva pro příjemce: T-Mobile
Kód transakce: 160610999999`);
  assert.equal(tx.description, 'T-Mobile Czech Republic a.s.');
  assert.equal(tx.counterparty_account, '19-2235210247/0800');
});

test('odchozí úhrada na účet BEZ jména příjemce v řádku úhrady: protiúčet se stejně vytáhne', () => {
  const tx = parseEmailNotification(`zůstatek na účtu Tom - OSVC číslo 1679014031/3030 se snížil o částku 13 255,00 CZK. Dostupný zůstatek k 25.06.2026 v 01:26 je 5 266,19 CZK.

Odchozí úhrada na účet číslo 1000451009/3500
Částka: 13 255,00 CZK
Datum zaúčtování: 25.06.2026
Variabilní symbol: 200232644
Konstantní symbol: 0308
Zpráva pro plátce: Toyota - RAV4 - splátka
Zpráva pro příjemce: Tomáš Střída
Kód transakce: 162182232012`);
  assert.equal(tx.counterparty_account, '1000451009/3500');
  assert.equal(tx.source_account, '1679014031/3030');
  // jméno chybí v řádku úhrady → description fallbackuje na "Zpráva pro plátce"
  assert.equal(tx.description, 'Toyota - RAV4 - splátka');
  // Variabilní symbol se uloží
  assert.equal(tx.variable_symbol, '200232644');
  // Obě zprávy (plátce i příjemce) se zachovají v note, oddělené " · "
  assert.equal(tx.note, 'Toyota - RAV4 - splátka · Tomáš Střída');
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
  assert.equal(tx.source_account, '1679014023/3030');
  assert.equal(tx.counterparty_account, null);
});

// Převod bez jména protistrany (žádný řádek "úhrada na účet … číslo"), jen "Zpráva pro
// příjemce" → popis (description) zůstával prázdný a v review frontě i Popisu bylo "—".
// Popis se má vzít ze zprávy (note), aby byl vidět, vyhledatelný a braly ho textová pravidla.
const NOTE_ONLY = `Dobrý den,

zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 1 500,00 CZK. Dostupný zůstatek k 29.06.2026 v 16:58 je 1 000,00 CZK.

Datum zaúčtování: 29.06.2026
Zpráva pro příjemce: Locum indiv
Kód transakce: 261234567

Vaše Air Bank`;

test('převod bez jména protistrany: popis se vezme ze zprávy (note)', () => {
  const tx = parseEmailNotification(NOTE_ONLY);
  assert.equal(tx.amount, -1500);
  assert.equal(tx.place, null);
  assert.equal(tx.note, 'Locum indiv');
  assert.equal(tx.description, 'Locum indiv');
});

test('převod nemá kartu ani místo', () => {
  const tx = parseEmailNotification(OUTGOING);
  assert.equal(tx.place, null);
  assert.equal(tx.card_last4, null);
});

// Typ úhrady u převodů: e-mail ho na rozdíl od CSV neuvádí, doplňuje se ze směru.
// Názvosloví je převzaté z CSV od banky, aby stejná platba měla stejný typ bez
// ohledu na to, kterou cestou do Spendexu dorazila.
test('odchozí převod dostane typ „Odchozí úhrada"', () => {
  const tx = parseEmailNotification(OUTGOING);
  assert.equal(tx.tx_type, 'Odchozí úhrada');
});

test('příchozí převod dostane typ „Příchozí úhrada"', () => {
  const tx = parseEmailNotification(`zůstatek na účtu Společný číslo 1679014023/3030 se zvýšil o částku 15,00 CZK. Dostupný zůstatek k 07.06.2026 v 22:21 je 4 890,66 CZK.

Příchozí úhrada z účtu Tomáš Střída číslo 1679014138/3030
Částka: 15,00 CZK
Datum zaúčtování: 07.06.2026
Kód transakce: 160614737162`);
  assert.equal(tx.tx_type, 'Příchozí úhrada');
});

test('platba bez protiúčtu (splátka půjčky) typ nedostane — není to převod', () => {
  const tx = parseEmailNotification(LOAN_PAYMENT);
  assert.equal(tx.tx_type, null);
});

test('převod bez jména protistrany, ale s protiúčtem, typ dostane', () => {
  const tx = parseEmailNotification(`zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 230,00 CZK. Dostupný zůstatek k 25.07.2026 v 12:08 je 1 000,00 CZK.

Pro úplnost uvádíme detaily této úhrady:

Odchozí úhrada na účet číslo 201220675/0600
Částka: 230,00 CZK
Datum zaúčtování: 25.07.2026
Zpráva pro plátce: káva na vodě ve stánku
Kód transakce: 164703698812`);
  assert.equal(tx.tx_type, 'Odchozí úhrada');
});

test('karetní platba si typ „Platba kartou" udrží', () => {
  const tx = parseEmailNotification(CARD);
  assert.equal(tx.tx_type, 'Platba kartou');
});

// Korekce karetní blokace: obchodník při placení zablokuje odhadní/zaokrouhlenou
// částku, po zaúčtování se blokace sníží o rozdíl → zůstatek se "zvýší" (uvolnění).
// Není to příjem, ale korekce už zaúčtovaného nákupu. Merchant je na řádku
// "Snížení/Zvýšení částky blokace, <MERCHANT>, <místo>, 000" — bez vytažení do `place`
// zůstával popis prázdný a položka vypadala jako záhadný příjem.
const BLOCK_CORRECTION = `Dobrý den,

zůstatek na účtu Společný číslo 1679014023/3030 se zvýšil o částku 148,20 CZK. Dostupný zůstatek k 29.06.2026 v 21:10 je 3 880,84 CZK.

Pro úplnost uvádíme detaily této úhrady:

Snížení částky blokace, GLOBUS VAM DEKUJE, Praha - Cakov, 000
Částka: 148,20 CZK
Datum změny částky blokace: 29.06.2026
Kód transakce: 27278506243

Vaše Air Bank`;

test('korekce blokace: vytáhne obchodníka do place/popisu a označí typ', () => {
  const tx = parseEmailNotification(BLOCK_CORRECTION);
  assert.equal(tx.external_id, '27278506243');
  assert.equal(tx.amount, 148.2);
  assert.equal(tx.direction, 'Příchozí');
  assert.equal(tx.place, 'GLOBUS VAM DEKUJE, Praha - Cakov');
  assert.equal(tx.description, 'GLOBUS VAM DEKUJE, Praha - Cakov');
  assert.equal(tx.tx_type, 'Korekce blokace');
  assert.equal(tx.date, '2026-06-29');
  assert.equal(tx.source_account, '1679014023/3030');
});

// Varianta se zvýšením blokace (méně časté: dodatečné dočerpání, zůstatek se sníží)
// a merchant s vnitřní čárkou v názvu (Rohlik) → celý merchant+místo do place.
const BLOCK_CORRECTION_ROHLIK = `Dobrý den,

zůstatek na účtu Společný číslo 1679014023/3030 se zvýšil o částku 64,98 CZK. Dostupný zůstatek k 11.06.2026 v 10:36 je 11 457,20 CZK.

Pro úplnost uvádíme detaily této úhrady:

Snížení částky blokace, DEKUJEME, ROHLIK.CZ, Prague 8, 000
Částka: 64,98 CZK
Datum změny částky blokace: 11.06.2026
Kód transakce: 26960204523

Vaše Air Bank`;

test('korekce blokace: merchant s vnitřní čárkou se zachová celý', () => {
  const tx = parseEmailNotification(BLOCK_CORRECTION_ROHLIK);
  assert.equal(tx.place, 'DEKUJEME, ROHLIK.CZ, Prague 8');
  assert.equal(tx.description, 'DEKUJEME, ROHLIK.CZ, Prague 8');
  assert.equal(tx.tx_type, 'Korekce blokace');
});

// ─────────────────────────────────────────────────────────────────────────────
// Generický fallback: platby bez protiúčtu (inkaso, splátka půjčky, poplatek).
// AirBank u nich neposílá řádek „úhrada na účet … číslo" ani „Platba kartou v …",
// jen holý popisný řádek v bloku detailu → bez fallbacku zůstal popis prázdný,
// transakce spadla do review fronty a nešla spárovat ani textovým pravidlem,
// ani fixní platbou na Schůzce (obě matchují description+note+place).
// ─────────────────────────────────────────────────────────────────────────────
const LOAN_PAYMENT = `Dobrý den,

zůstatek na účtu Tom - OSVC číslo 1679014031/3030 se snížil o částku 15 000,00 CZK. Dostupný zůstatek k 22.07.2026 v 00:58 je 23 617,19 CZK.

Pro úplnost uvádíme detaily této úhrady:

Splátka půjčky Půjčka 1
Částka: 15 000,00 CZK
Datum zaúčtování: 22.07.2026
Kód transakce: 164468245922

Nechceme, aby Vás naše upozornění jakkoliv obtěžovala.

Vaše Air Bank`;

test('splátka půjčky (inkaso bez protiúčtu): popisný řádek detailu → description', () => {
  const tx = parseEmailNotification(LOAN_PAYMENT);
  assert.equal(tx.description, 'Splátka půjčky Půjčka 1');
  assert.equal(tx.amount, -15000);
  assert.equal(tx.direction, 'Odchozí');
  assert.equal(tx.date, '2026-07-22');
  assert.equal(tx.source_account, '1679014031/3030');
  assert.equal(tx.external_id, '164468245922');
  assert.equal(tx.counterparty_account, null);
});

test('fallback přeskočí řádky „Klíč: hodnota" a nebere text mimo blok detailu', () => {
  // Blok detailu začíná řádky s dvojtečkou → fallback nesmí sáhnout na „Dobrý den,"
  // ani na závěrečný text; popisný řádek je až za nimi.
  const tx = parseEmailNotification(`Dobrý den,

zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 349,00 CZK. Dostupný zůstatek k 10.07.2026 v 08:00 je 100,00 CZK.

Pro úplnost uvádíme detaily této úhrady:

Částka: 349,00 CZK
Poplatek za vedení účtu
Datum zaúčtování: 10.07.2026
Kód transakce: 164400000001

Vaše Air Bank`);
  assert.equal(tx.description, 'Poplatek za vedení účtu');
});

test('fallback se NEuplatní u kartové platby (place má přednost)', () => {
  const tx = parseEmailNotification(CARD);
  assert.equal(tx.description, tx.place);
  assert.notEqual(tx.description, '');
});

test('bez bloku „Pro úplnost" zůstane description prázdný (žádné hádání)', () => {
  const tx = parseEmailNotification(`Dobrý den,

zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 12,00 CZK. Dostupný zůstatek k 10.07.2026 v 08:00 je 100,00 CZK.

Datum zaúčtování: 10.07.2026
Kód transakce: 164400000002

Vaše Air Bank`);
  assert.equal(tx.description, '');
});

// Převod bez jména protistrany: hlavičkový řádek „Odchozí úhrada na účet číslo …"
// parser zpracovává strukturovaně (protiúčet → counterparty_account). Když z něj
// nevytáhne jméno, žádné tam není → generický fallback ho NESMÍ vzít jako popis,
// jinak by v Popisu bylo duplicitní číslo účtu místo prázdna.
test('fallback nebere strukturovaně zpracovaný řádek „úhrada na účet … číslo"', () => {
  const tx = parseEmailNotification(`Dobrý den,

zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 230,00 CZK. Dostupný zůstatek k 25.07.2026 v 12:00 je 100,00 CZK.

Pro úplnost uvádíme detaily této úhrady:

Odchozí úhrada na účet číslo 201220675/0600
Částka: 230,00 CZK
Datum zaúčtování: 25.07.2026
Kód transakce: 164400000003

Vaše Air Bank`);
  assert.equal(tx.counterparty_account, '201220675/0600');
  assert.equal(tx.description, '');
});

// Protipól předchozího testu: „úhrada od" se vyskytuje i uprostřed normálního
// popisu (odměny, úroky od banky). Vyloučení se proto váže na konkrétní shodu
// regexu protistrany, ne na volný text — jinak by se tenhle popis zahodil.
test('fallback vezme popisný řádek obsahující „úhrada od" bez čísla účtu', () => {
  const tx = parseEmailNotification(`Dobrý den,

zůstatek na účtu Společný číslo 1679014023/3030 se zvýšil o částku 24,50 CZK. Dostupný zůstatek k 08.06.2026 v 09:00 je 100,00 CZK.

Pro úplnost uvádíme detaily této úhrady:

Odměny za placení - úhrada od Air Bank
Částka: 24,50 CZK
Datum zaúčtování: 08.06.2026
Kód transakce: 164400000004

Vaše Air Bank`);
  assert.equal(tx.description, 'Odměny za placení - úhrada od Air Bank');
  assert.equal(tx.counterparty_account, null);
});

test('balance_after: vytáhne dostupný zůstatek z hlavičky', () => {
  const tx = parseEmailNotification(`Dobrý den,

zůstatek na účtu Spořicí účet 1 číslo 1679014082/3030 se zvýšil o částku 100,00 CZK. Dostupný zůstatek k 02.08.2026 v 14:12 je 111 878,44 CZK.

Pro úplnost uvádíme detaily této úhrady:

Příchozí úhrada z účtu Libor Bísek číslo 1812270019/3030
Částka: 100,00 CZK
Datum zaúčtování: 02.08.2026
Kód transakce: 165368991022
`);
  assert.equal(tx.balance_after, 111878.44);
  assert.equal(tx.source_account, '1679014082/3030');
});

test('balance_after: chybějící věta o zůstatku dá null, parser nespadne', () => {
  const tx = parseEmailNotification(`Dobrý den,

zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 10,00 CZK.

Pro úplnost uvádíme detaily této úhrady:

Odchozí úhrada na účet Tomáš Střída číslo 1679014082/3030
Kód transakce: 123456789
`);
  assert.equal(tx.balance_after, null);
});
