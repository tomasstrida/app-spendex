'use strict';
const { normCounterparty } = require('./income');

/**
 * Serverový protějšek klientského `placeDisplay` (client/src/utils/accountName.js).
 * Používá ho CSV export, aby v něm „Obchodní místo" nebylo prázdné u QR plateb
 * a převodů. Čistě zobrazovací — do DB se nic nezapisuje.
 * Obě implementace musí dávat stejný výsledek; hlídají to unit testy na obou stranách.
 */
function buildAccountNameMap(rows) {
  const map = new Map();
  for (const a of rows || []) {
    const num = normCounterparty(a.account_number);
    if (num) map.set(num, a.name);
  }
  return map;
}

/** Vrátí text do sloupce „Obchodní místo"; prázdný string = buňka zůstane prázdná. */
function placeDisplayText(tx, nameMap) {
  if (!tx) return '';
  const place = (tx.place || '').trim();
  if (place) return place;

  const cp = normCounterparty(tx.counterparty_account);
  if (!cp) return '';

  const name = nameMap ? nameMap.get(cp) : null;
  return name ? `${cp} · ${name}` : cp;
}

module.exports = { buildAccountNameMap, placeDisplayText };
