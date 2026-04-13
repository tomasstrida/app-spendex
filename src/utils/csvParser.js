/**
 * Parser pro Air Bank CSV export.
 * Formát: semikolon, uvozovky, datum DD/MM/YYYY, částka "-1 234,56"
 */

const COL = {
  DATE: 0,
  DIRECTION: 1,
  TYPE: 2,
  AB_CATEGORY: 3,
  CURRENCY: 4,
  AMOUNT: 5,
  COUNTERPARTY: 9,
  NOTE_ME: 17,
  MESSAGE: 18,
  PLACE: 24,
  REF_NUMBER: 32,
};

function parseAmount(str) {
  if (!str) return null;
  // "-1 234,56" → -1234.56
  const cleaned = str.replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseDate(str) {
  // "13/04/2026" → "2026-04-13"
  if (!str) return null;
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ';' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseAirBankCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = parseCSVLine(lines[0]);
  // Ověř že jde o Air Bank formát
  if (!header[COL.DATE]?.includes('Datum') && !header[0]?.includes('Datum')) {
    throw new Error('Neplatný formát souboru. Očekáván Air Bank CSV export.');
  }

  const transactions = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < 10) continue;

    const amount = parseAmount(fields[COL.AMOUNT]);
    const date = parseDate(fields[COL.DATE]);
    if (amount === null || !date) continue;

    const counterparty = fields[COL.COUNTERPARTY]?.trim() || '';
    const place = fields[COL.PLACE]?.trim() || '';
    const message = fields[COL.MESSAGE]?.trim() || '';
    const noteMe = fields[COL.NOTE_ME]?.trim() || '';

    // Popis: preferuj protistranu, doplň místem nebo zprávou
    let description = counterparty;
    if (!description && place) description = place;
    if (!description && message) description = message;

    const refNumber = fields[COL.REF_NUMBER]?.trim() || '';

    transactions.push({
      date,
      amount,
      currency: fields[COL.CURRENCY]?.trim() || 'CZK',
      description,
      note: noteMe || message || '',
      ab_category: fields[COL.AB_CATEGORY]?.trim() || '',
      direction: fields[COL.DIRECTION]?.trim() || '',
      external_id: refNumber || null,
    });
  }

  return transactions;
}

module.exports = { parseAirBankCSV };
