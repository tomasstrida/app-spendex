'use strict';

/**
 * Serverový protějšek klientského `placeDisplay` (client/src/utils/accountName.js).
 * Používá ho CSV export, aby v něm „Obchodní místo" nebylo prázdné u QR plateb
 * a převodů. Čistě zobrazovací — do DB se nic nezapisuje.
 * Obě implementace používají stejnou normalizaci (ořez mezer, exact porovnání
 * kompletního čísla), takže pro tytéž vstupy dávají stejný text — liší se jen
 * návratový typ (klient `{ text, derived } | null` pro UI, server holý string
 * pro CSV buňku).
 */
function normalizeAccountNumber(raw) {
  if (!raw) return '';
  return String(raw).replace(/\s/g, '');
}

function buildAccountNameMap(rows) {
  const map = new Map();
  for (const a of rows || []) {
    if (a.account_number) map.set(normalizeAccountNumber(a.account_number), a.name);
  }
  return map;
}

/** Vrátí text do sloupce „Obchodní místo"; prázdný string = buňka zůstane prázdná. */
function placeDisplayText(tx, nameMap) {
  if (!tx) return '';
  const place = (tx.place || '').trim();
  if (place) return place;

  const cp = normalizeAccountNumber(tx.counterparty_account);
  if (!cp) return '';

  const name = nameMap ? nameMap.get(cp) : null;
  return name ? `${cp} · ${name}` : cp;
}

module.exports = { buildAccountNameMap, placeDisplayText };
