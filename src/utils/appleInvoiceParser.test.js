'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { simpleParser } = require('mailparser');
const { parseAppleInvoice } = require('./appleInvoiceParser');

const FIXTURE = path.join(__dirname, '__fixtures__', 'apple-invoice.eml');

async function fixtureBody() {
  const parsed = await simpleParser(fs.readFileSync(FIXTURE, 'utf8'));
  return parsed.text || parsed.html || '';
}

test('parsuje realnou Apple fakturu z fixture', async () => {
  const r = parseAppleInvoice(await fixtureBody());
  assert.ok(r, 'faktura se ma rozpoznat');
  assert.equal(r.order_id, 'MQ9BQ86WV5');
  assert.equal(r.receipt_date, '2026-06-30');
  assert.equal(r.total_amount, 269);
  assert.equal(r.card_last4, '4225');
  assert.equal(r.is_refund, false);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].app, 'YouTube');
  assert.equal(r.items[0].description, 'YouTube Premium (Monthly)');
  assert.equal(r.items[0].amount, 269);
});

test('CSS ze <style> se nesmi dostat do vysledku', async () => {
  const r = parseAppleInvoice(await fixtureBody());
  assert.ok(!/font-family|margin:/.test(JSON.stringify(r)), 'v datech nesmi byt CSS');
});

test('castka se nespoji s predchozim cislem (2026 + 269,00)', async () => {
  const r = parseAppleInvoice(await fixtureBody());
  assert.equal(r.total_amount, 269, 'nesmi vyjit 2026269');
});

test('dobropis podle klicoveho slova', () => {
  const html = '<html><body><h1>Refund</h1><div class="billing-information">'
    + '<p>5 July 2026</p><p>Order ID:</p><p>ABC123XYZ</p></div>'
    + '<div class="payment-information"><p>Visa •••• 1760</p><p>99,00 CZK</p></div>'
    + '</body></html>';
  const r = parseAppleInvoice(html);
  assert.equal(r.is_refund, true);
  assert.equal(r.total_amount, 99, 'castka je vzdy kladna, smer nese is_refund');
  assert.equal(r.card_last4, '1760');
});

test('faktura bez rozpoznatelnych polozek se presto vrati', () => {
  const html = '<html><body><h1>Invoice</h1><div class="billing-information">'
    + '<p>2 July 2026</p><p>Order ID:</p><p>ZZZ999</p></div>'
    + '<div class="payment-information"><p>MasterCard •••• 4225</p><p>1 234,50 CZK</p></div>'
    + '</body></html>';
  const r = parseAppleInvoice(html);
  assert.equal(r.total_amount, 1234.5, 'tisice s mezerou');
  assert.deepEqual(r.items, []);
});

test('cizi text vrati null', () => {
  assert.equal(parseAppleInvoice('Dobrý den, zůstatek na účtu se snížil o 100 CZK.'), null);
  assert.equal(parseAppleInvoice(''), null);
});

// Minor: slovo „refund" v patičce nesmí z faktury udělat dobropis — obrátilo by
// znaménko a doklad by pak nikdy nesedl na výdajovou transakci.
test('slovo refund v paticce nedela z faktury dobropis', () => {
  const html = '<html><body><h1>Invoice</h1><div class="billing-information">'
    + '<p>5 July 2026</p><p>Order ID:</p><p>ABC123XYZ</p></div>'
    + '<div class="payment-information"><p>Visa •••• 1760</p><p>99,00 CZK</p></div>'
    + '<footer><p>All sales are final. See our refund policy for details.</p></footer>'
    + '</body></html>';
  const r = parseAppleInvoice(html);
  assert.equal(r.is_refund, false);
});

// Minor: u ručně přeposlaného mailu je nad fakturou hlavička forwardu s vlastním datem.
test('datum se bere z bloku billing-information, ne z hlavicky forwardu', () => {
  const html = '<html><body><p>---------- Forwarded message ---------</p>'
    + '<p>Date: 3 August 2026</p><p>Subject: Your invoice from Apple.</p>'
    + '<h1>Invoice</h1><div class="billing-information"><p>5 July 2026</p>'
    + '<p>Order ID:</p><p>FWD123</p></div>'
    + '<div class="payment-information"><p>Visa •••• 1760</p><p>99,00 CZK</p></div>'
    + '</body></html>';
  const r = parseAppleInvoice(html);
  assert.equal(r.receipt_date, '2026-07-05');
});

test('bez bloku billing-information se datum vezme z celeho textu (fallback)', () => {
  const r = parseAppleInvoice('<html><body><h1>Invoice</h1><p>Order ID: PLAIN1</p>'
    + '<p>5 July 2026</p><p>99,00 CZK</p></body></html>');
  assert.equal(r.receipt_date, '2026-07-05');
});

test('vytahne Apple Account z faktury', async () => {
  const r = parseAppleInvoice(await fixtureBody());
  assert.equal(r.apple_account, 'user@example.com');
});

test('Apple Account se normalizuje na mala pismena', () => {
  const html = '<html><body><h1>Invoice</h1><div class="billing-information">'
    + '<p>2 July 2026</p><p>Apple Account:</p><p>Tomas.Strida@ICLOUD.com</p></div>'
    + '<div class="payment-information"><p>50,00 CZK</p></div></body></html>';
  assert.equal(parseAppleInvoice(html).apple_account, 'tomas.strida@icloud.com');
});

test('faktura bez Apple Account vraci null', () => {
  const html = '<html><body><h1>Invoice</h1><div class="billing-information">'
    + '<p>2 July 2026</p><p>Order ID:</p><p>ZZZ999</p></div>'
    + '<div class="payment-information"><p>50,00 CZK</p></div></body></html>';
  assert.equal(parseAppleInvoice(html).apple_account, null);
});

test('vice polozek na jedne fakture', () => {
  const html = '<html><body><h1>Invoice</h1><div class="billing-information"><p>9 July 2026</p>'
    + '<p>Order ID:</p><p>MULTI1</p></div>'
    + '<table class="lockup subscription-lockup__container"><tr class="subscription-lockup">'
    + '<td class="subscription-lockup__content"><p>iCloud</p><p>iCloud+ 50GB<br/></p></td>'
    + '<td class="subscription-lockup__bottom-text__col"><p>25,00&nbsp;CZK<br/></p></td></tr></table>'
    + '<table class="lockup subscription-lockup__container"><tr class="subscription-lockup">'
    + '<td class="subscription-lockup__content"><p>OpenAI</p><p>ChatGPT Plus<br/></p></td>'
    + '<td class="subscription-lockup__bottom-text__col"><p>599,00&nbsp;CZK<br/></p></td></tr></table>'
    + '<div class="payment-information"><p>MasterCard •••• 4225</p><p>624,00 CZK</p></div>'
    + '</body></html>';
  const r = parseAppleInvoice(html);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].app, 'iCloud');
  assert.equal(r.items[1].description, 'ChatGPT Plus');
  assert.equal(r.total_amount, 624);
});
