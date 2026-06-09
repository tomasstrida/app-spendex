'use strict';
/**
 * Parser notifikačních e-mailů AirBank (plain text, už dekódovaný z MIME).
 * Vrací stejnou strukturu transakce jako csvParser.js + navíc `source_account`
 * (číslo zdrojového účtu, bez /kódbanky) pro stavbu external_id a párování účtu.
 * Při nerozpoznání (chybí kód transakce nebo částka) vrací null → webhook uloží
 * položku jako 'unparsed' (žádná tichá ztráta dat).
 */

function parseAmount(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseCzDate(str) {
  // "07.06.2026" → "2026-06-07"
  const m = str && String(str).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function parseEmailNotification(text) {
  if (!text) return null;
  // nbsp (U+00A0) → obyčejná mezera, ať \s a literály mezer v regexech spolehlivě sedí
  // Také odstraníme BOM/zero-width znaky (U+FEFF, U+200B apod.) které mohou být v textu
  const body = String(text)
    .replace(/ /g, ' ')
    .replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '');

  // Kód transakce — povinné (= AirBank referenční číslo, shodné s CSV)
  const codeM = body.match(/Kód transakce:\s*(\d+)/i);
  if (!codeM) return null;
  const external_id = codeM[1];

  // Hlavička: "se snížil/zvýšil o částku 10,00 CZK"
  const headM = body.match(/se\s+(sní[zž]il|zvý[sš]il)\s+o\s+[cč]ástku\s+([\d\s.,]+?)\s*(CZK|EUR|USD)/i);
  if (!headM) return null;
  const absAmount = parseAmount(headM[2]);
  if (absAmount === null) return null;
  const sign = /sn[ií][žz]il/i.test(headM[1]) ? -1 : 1;
  const amount = sign * Math.abs(absAmount);
  const currency = headM[3].toUpperCase();
  const direction = sign < 0 ? 'Odchozí' : 'Příchozí';

  // Zdrojový účet z hlavičky: "na účtu Společný číslo 1679014023/3030 se snížil"
  const srcM = body.match(/na\s+ú[cč]tu\s+.*?[cč]íslo\s*(\d+)\/\d+\s+se\s+(?:sn[ií][žz]il|zv[ýy][šs]il)/i);
  const source_account = srcM ? srcM[1] : null;

  // Protistrana + protiúčet:
  //  - odchozí: "Odchozí úhrada na účet <jméno> číslo <num>/<bank>"
  //  - příchozí: "Příchozí úhrada z účtu <jméno> číslo <num>/<bank>"  (reálný AirBank formát)
  let description = '';
  let counterparty_account = null;
  const cpM = body.match(/úhrada\s+(?:na\s+ú[cč]et|z\s+ú[cč]tu|od)\s+(.+?)\s+[cč]íslo\s*(\d+\/\d+)/i);
  if (cpM) {
    description = cpM[1].trim();
    counterparty_account = cpM[2];
  }

  // Platba kartou: "Platba kartou (nezaúčtováno) v <MÍSTO>" → place (ořež koncový terminálový kód ", 000")
  let place = null;
  let card_last4 = null;
  let tx_type = null;
  const cardLineM = body.match(/Platba kartou(?:\s*\([^)]*\))?\s+v\s+(.+)/i);
  if (cardLineM) {
    place = cardLineM[1].trim().replace(/,\s*\d{1,3}\s*$/, '').trim();
    tx_type = 'Platba kartou';
  }
  const cardNumM = body.match(/Karta:\s*([\d*]+)/i);
  if (cardNumM) {
    const digits = cardNumM[1].replace(/[^\d]/g, '');
    if (digits.length >= 4) card_last4 = digits.slice(-4);
  }

  // Zpráva pro plátce/příjemce → note
  const msgM = body.match(/Zpráva pro (?:plátce|p[rř]íjemce):\s*(.+)/i);
  const note = msgM ? msgM[1].trim() : '';

  // Datum: primárně "Datum zaúčtování", fallback "Datum provedení" (kartové platby), fallback z hlavičky "k 07.06.2026 v ..."
  const date =
    parseCzDate((body.match(/Datum zaú[cč]tování:\s*([\d.]+)/i) || [])[1]) ||
    parseCzDate((body.match(/Datum provedení:\s*([\d.]+)/i) || [])[1]) ||
    parseCzDate((body.match(/k\s+([\d.]+)\s+v\s+\d{2}:\d{2}/i) || [])[1]);

  // Čas: "v 17:47"
  const timeM = body.match(/\bv\s+(\d{2}:\d{2})\b/);
  const tx_time = timeM ? timeM[1] : null;

  return {
    date,
    amount,
    currency,
    description,
    note,
    ab_category: '',          // v e-mailu není → L2 kategorizace odpadá
    direction,
    external_id,
    tx_time,
    tx_type,
    counterparty_account,
    entered_by: null,
    place,
    card_last4,
    source_account,
  };
}

module.exports = { parseEmailNotification, parseAmount, parseCzDate };
