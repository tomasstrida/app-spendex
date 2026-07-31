'use strict';

// Parser Apple faktur (a dobropisů) z e-mailu. Vstupem je tělo mailu (HTML nebo text),
// jak ho vrátí `simpleParser` z mailparser.
//
// POZOR na dvě věci, na kterých parser stojí:
// 1. CSS třídy typu `custom-460tp8` jsou generované emotion hashe a mění se mezi verzemi
//    mailu — vážeme se jen na sémantické třídy (billing-information, subscription-lockup,
//    payment-information) a na textové kotvy („Order ID:", „MasterCard •••• ").
// 2. Blok <style> musí ven DŘÍV, než se strhnou tagy — jinak se CSS text promíchá s daty.
// 3. Mail je ručně přeposlaný, takže nad fakturou bývá hlavička forwardu s vlastním
//    datem a patička s vlastním textem. Datum proto hledáme primárně v bloku
//    `billing-information` a příznak dobropisu jen v nadpisu <h1> — ne v celém textu.

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

// Skupiny tisíců oddělené mezerou nebo nedělitelnou mezerou. Úvodní [^\d] brání
// slepení s předchozím číslem („2026" + „269,00" → „2026269,00").
const AMOUNT_RE = /(?:^|[^\d])(\d{1,3}(?:[\s ]\d{3})*,\d{2})\s* ?CZK/g;

function stripToText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/ /g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(raw) {
  return parseFloat(String(raw).replace(/[\s ]/g, '').replace(',', '.'));
}

function amountsIn(text) {
  return [...text.matchAll(AMOUNT_RE)].map(m => toNumber(m[1]));
}

const DATE_RE = /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i;

function matchDate(text) {
  const m = String(text).match(DATE_RE);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  return `${m[3]}-${mm}-${String(m[1]).padStart(2, '0')}`;
}

// Datum hledáme PRIMÁRNĚ v bloku „billing-information" — u ručně přeposlaného mailu
// je nad fakturou ještě hlavička forwardu („Date: 3 July 2026"), a ta by jinak jako
// první dlouhé datum v dokumentu vyhrála. Celý text je až fallback (plain-text mail
// nebo jiná verze šablony bez sémantické třídy).
function parseDate(html, text) {
  const block = String(html).match(/class="[^"]*billing-information[\s\S]{0,4000}/i);
  return (block ? matchDate(stripToText(block[0])) : null) || matchDate(text);
}

// Položky: každý <tr class="...subscription-lockup..."> je jedna služba.
// Název a popis jsou v buňce `subscription-lockup__content`, cena v
// `subscription-lockup__bottom-text__col`. Řádek „Renews …" se zahazuje.
function parseItems(html) {
  const rows = [...String(html).matchAll(/<tr[^>]*class="[^"]*subscription-lockup[^"]*"[\s\S]*?<\/tr>/gi)];
  const items = [];
  for (const [row] of rows) {
    const contentCell = (row.match(/subscription-lockup__content[\s\S]*?<\/td>/i) || [''])[0];
    const texts = [...contentCell.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(m => stripToText(m[1]))
      .filter(s => s && !/^Renews\b/i.test(s));
    const priceCell = (row.match(/subscription-lockup__bottom-text__col[\s\S]*?<\/td>/i) || [''])[0];
    const priceAmounts = amountsIn(stripToText(priceCell));
    if (!texts.length && !priceAmounts.length) continue;
    items.push({
      app: texts[0] || null,
      description: texts[1] || texts[0] || null,
      amount: priceAmounts.length ? priceAmounts[0] : null,
    });
  }
  return items;
}

// Celková částka je poslední částka v bloku „Billing and Payment" (za mezisoučtem,
// DPH a kartou). Když blok chybí, bereme poslední částku v celém dokumentu.
function parseTotal(html, text) {
  const payBlock = String(html).match(/class="payment-information[\s\S]*/i);
  const inPay = payBlock ? amountsIn(stripToText(payBlock[0])) : [];
  const pool = inPay.length ? inPay : amountsIn(text);
  return pool.length ? pool[pool.length - 1] : null;
}

const REFUND_RE = /\brefund\b|\bcredit note\b|\bdobropis\b/i;

// Dobropis poznáme z NADPISU dokumentu (<h1>Refund</h1>), ne z celého textu — slovo
// „refund" v patičce („refund policy") by jinak obrátilo znaménko a faktura by pak
// nikdy nesedla na výdajovou transakci a zůstala navždy pending.
// Fallback pro plain-text mail bez <h1>: první řádek textu.
function isRefund(html, text) {
  const h1 = String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return REFUND_RE.test(stripToText(h1[1]));
  return REFUND_RE.test(String(text).slice(0, 120));
}

// Účet, ze kterého byl nákup zaplacen („Apple Account: user@icloud.com").
// Uživatel může mít víc Apple ID a chce vidět, kolik utratil který — proto se
// hodnota normalizuje na malá písmena, ať se dva zápisy téhož účtu nerozejdou.
function parseAppleAccount(html, text) {
  const billBlock = String(html).match(/class="billing-information[\s\S]{0,4000}/i);
  const pool = billBlock ? stripToText(billBlock[0]) : text;
  const m = pool.match(/Apple Account:\s*([^\s<]+@[^\s<]+)/i)
    || text.match(/Apple Account:\s*([^\s<]+@[^\s<]+)/i);
  return m ? m[1].trim().toLowerCase() : null;
}

function parseAppleInvoice(source) {
  const html = String(source || '');
  if (!html.trim()) return null;
  const text = stripToText(html);

  const order = text.match(/Order ID:\s*([A-Z0-9-]+)/i);
  const total = parseTotal(html, text);
  // Bez čísla objednávky i bez částky to není doklad, se kterým umíme pracovat.
  if (!order && total == null) return null;

  const card = text.match(/(?:MasterCard|Visa|American Express|Amex|Maestro)[^0-9]{0,20}(\d{4})/i);

  return {
    receipt_date: parseDate(html, text),
    order_id: order ? order[1] : null,
    total_amount: total != null ? Math.abs(total) : null,
    card_last4: card ? card[1] : null,
    is_refund: isRefund(html, text),
    items: parseItems(html),
    apple_account: parseAppleAccount(html, text),
  };
}

module.exports = { parseAppleInvoice };
