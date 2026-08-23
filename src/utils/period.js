/**
 * Vypočítá start a end datum pro daný billing cyklus.
 * @param {number} billingDay - den v měsíci (1–31)
 * @param {string} periodKey  - "YYYY-MM" (měsíc zahájení cyklu)
 * @returns {{ start: string, end: string }} ISO datumy (YYYY-MM-DD)
 */
function getPeriodDates(billingDay, periodKey) {
  const [year, month] = periodKey.split('-').map(Number);
  const fmt = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // Start: billingDay daného měsíce (clamped na poslední den)
  const daysInStart = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startDay = Math.min(billingDay, daysInStart);

  // End: den před billingDay příštího měsíce (s clampem na poslední den příštího měsíce)
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const daysInNext = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  const nextStartDay = Math.min(billingDay, daysInNext);

  const end = nextStartDay > 1
    ? fmt(nextYear, nextMonth, nextStartDay - 1)
    : fmt(year, month, daysInStart);

  return { start: fmt(year, month, startDay), end };
}

/**
 * Vrátí periodKey ("YYYY-MM") pro aktuální billing cyklus.
 * @param {number} billingDay
 * @returns {string}
 */
function currentPeriodKey(billingDay) {
  const today = new Date();
  const day = today.getDate();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  if (day >= billingDay) {
    return `${year}-${String(month).padStart(2, '0')}`;
  } else {
    const d = new Date(year, month - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}

/**
 * Vrátí billing_day uživatele z DB (default 1).
 */
function getUserBillingDay(db, userId) {
  const row = db.prepare('SELECT billing_day FROM settings WHERE user_id = ?').get(userId);
  return row?.billing_day ?? 1;
}

/**
 * Vrátí periodKey ("YYYY-MM") pro billing cyklus, do kterého spadá dané datum.
 * Den >= billingDay patří do měsíce data; den < billingDay do předchozího měsíce.
 * @param {number} billingDay - den v měsíci (1–31)
 * @param {string} dateStr    - "YYYY-MM-DD"
 * @returns {string} "YYYY-MM"
 */
function periodKeyForDate(billingDay, dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  if (day >= billingDay) {
    return `${year}-${String(month).padStart(2, '0')}`;
  }
  const d = new Date(Date.UTC(year, month - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Posune periodKey o `delta` měsíců. "2026-01" + (-1) → "2025-12".
 */
function shiftPeriodKey(periodKey, delta) {
  const [y, m] = periodKey.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Pořadové číslo období pro porovnávání a odečítání rozsahů. */
function periodIndex(periodKey) {
  const [y, m] = periodKey.split('-').map(Number);
  return y * 12 + (m - 1);
}

/**
 * Výchozí rozsah pro dlouhodobé grafy.
 *
 * Poslední zobrazené období je VŽDY poslední KOMPLETNÍ, nikdy běžící — rozjetý
 * měsíc má nutně nižší čísla než uzavřené a v grafu by vypadal jako propad.
 * Uživatel si běžící měsíc může přidat ručně přes from/to.
 *
 * Začátek = leden roku aktuálního OBDOBÍ (ne kalendářního data — při
 * billing_day > 1 je začátkem ledna aktuálním obdobím ještě prosinec).
 * Kdyby takový rozsah vyšel kratší než `minPeriods`, vezme se posledních
 * `minPeriods` kompletních období.
 *
 * @param {string} currentKey aktuální (běžící) periodKey ("YYYY-MM")
 * @param {number} minPeriods minimální počet období
 * @returns {{ from: string, to: string }}
 */
function defaultHistoryRange(currentKey, minPeriods = 6) {
  const to = shiftPeriodKey(currentKey, -1);
  const from = `${currentKey.split('-')[0]}-01`;
  if (periodIndex(to) - periodIndex(from) + 1 >= minPeriods) {
    return { from, to };
  }
  return { from: shiftPeriodKey(to, -(minPeriods - 1)), to };
}

module.exports = { getPeriodDates, currentPeriodKey, getUserBillingDay, periodKeyForDate, shiftPeriodKey, periodIndex, defaultHistoryRange };
