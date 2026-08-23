// Pomocné funkce pro spojnicový graf dlouhodobého vývoje výdajů.
// Čistě výpočetní, bez DOM — testovatelné přes `node --test`.

// Fallback paleta pro kategorie bez vlastní barvy (a pro rozlišení kategorií,
// které mají shodnou barvu). Osm odstínů nakrokovaných pro tmavý podklad
// (--bg2 #1a1d27); ověřeno validátorem: lightness band, chroma floor,
// odstup sousedních dvojic při barvosleposti i normálním vidění, kontrast.
// Pořadí NEMĚNIT — ověřená je právě tahle sekvence sousedních dvojic.
export const FALLBACK_COLORS = [
  '#3987e5', '#d95926', '#199e70', '#c98500',
  '#d55181', '#008300', '#9085e9', '#e66767',
];

/**
 * Barva jedné série. Barva kategorie má přednost; bez ní stabilní fallback
 * odvozený z category_id — tedy z entity, ne z pořadí v grafu (jinak by
 * vypnutí série přebarvilo zbytek).
 */
export function seriesColor(s) {
  if (s && s.color) return s.color;
  const id = Number(s?.category_id) || 0;
  return FALLBACK_COLORS[id % FALLBACK_COLORS.length];
}

/**
 * Přiřadí barvy celé sadě sérií a vyřeší kolize: dvě kategorie se stejnou
 * barvou (typicky výchozí #6366f1) by v grafu splynuly. Prochází se v pořadí
 * podle category_id, aby přiřazení nezáviselo na tom, které série jsou zrovna
 * zapnuté ani jak je seřadil server.
 * @returns {Map<number,string>} category_id → hex barva
 */
export function assignColors(series) {
  const out = new Map();
  const used = new Set();
  let dupIndex = 0;
  const ordered = [...(series || [])].sort((a, b) => (a.category_id || 0) - (b.category_id || 0));
  for (const s of ordered) {
    let color = seriesColor(s);
    if (used.has(color.toLowerCase())) {
      // Duplicity se rozprostřou po fallback paletě v pevném pořadí. Odstínů je
      // osm, takže při víc než osmi shodných barvách se začnou opakovat —
      // rozlišení pak nese legenda a tooltip, což je i důvod, proč je legenda
      // vždy vidět. (Reálný případ: všechny kategorie mají výchozí #6366f1.)
      color = FALLBACK_COLORS[dupIndex % FALLBACK_COLORS.length];
      dupIndex++;
    }
    used.add(color.toLowerCase());
    out.set(s.category_id, color);
  }
  return out;
}

const STEP_MULTIPLIERS = [1, 2, 2.5, 5, 10];

/**
 * Osa Y s kulatými hodnotami. Nula je vždy tickem (spojnice se čtou od
 * základny), záporné hodnoty (vratka převyšující výdaje) osu rozšíří dolů.
 * @returns {{ min: number, max: number, ticks: number[] }}
 */
export function niceScale(minValue, maxValue, targetCount = 5) {
  const lo = Math.min(0, Number.isFinite(minValue) ? minValue : 0);
  let hi = Math.max(0, Number.isFinite(maxValue) ? maxValue : 0);
  if (hi === lo) hi = lo + 1;

  const rough = (hi - lo) / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (STEP_MULTIPLIERS.find(m => norm <= m) ?? 10) * mag;

  const top = Math.ceil(hi / step) * step;
  const bottom = Math.floor(lo / step) * step;
  const ticks = [];
  for (let v = bottom; v <= top + step / 2; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return { min: bottom, max: top, ticks };
}

/** Popisek ticku osy Y — celé koruny s oddělovačem tisíců. */
export function formatTick(value) {
  return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(value);
}

/** Krátký popisek období pro osu X: "2026-07" → "7/26". */
export function shortPeriodLabel(periodKey) {
  const [y, m] = String(periodKey || '').split('-');
  if (!y || !m) return periodKey || '';
  return `${Number(m)}/${y.slice(2)}`;
}

/**
 * Znaménko před částku. `formatCurrency` v i18n záměrně bere absolutní
 * hodnotu, ale v grafu je záporný měsíc (vratka převýšila výdaje) reálný stav,
 * který se nesmí zobrazit jako kladný.
 */
export function signPrefix(value) {
  return value < 0 ? '−' : '';
}
