import { formatCurrency } from '../i18n.js';

/**
 * Popisek očekávané částky fixní platby.
 *
 * Většina plateb má pevnou částku (`amount_min === amount_max`) — vypsat u nich
 * „6 000–6 000 Kč" vypadá jako chyba, proto se ukáže jedno číslo. Skutečné
 * rozmezí (např. T-Mobile 2 500–3 000) se vypíše celé, s oddělovačem tisíců
 * jako všude jinde v UI.
 *
 * Když rozmezí není vyplněné, padá se zpět na plánovanou částku.
 */
export function formatExpectedAmount(min, max, fallback) {
  if (min == null || max == null) return formatCurrency(fallback);
  if (Math.round(min) === Math.round(max)) return formatCurrency(min);
  // Dolní mez bez měny, ať se „Kč" neopakuje: „2 500–3 000 Kč". Oddělovač před
  // měnou je NEDĚLITELNÁ mezera (U+00A0) — v regexu proto escape, ne mezerník,
  // jinak by se nic neuřízlo a vzniklo by „2 500 Kč–3 000 Kč".
  return `${formatCurrency(min).replace(/\u00a0\S+$/, '')}–${formatCurrency(max)}`;
}
