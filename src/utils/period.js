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

module.exports = { getPeriodDates, currentPeriodKey, getUserBillingDay, periodKeyForDate };
