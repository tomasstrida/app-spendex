/**
 * Vypočítá start a end datum pro daný billing cyklus.
 * @param {number} billingDay - den v měsíci (1–31)
 * @param {string} periodKey  - "YYYY-MM" (měsíc zahájení cyklu)
 * @returns {{ start: string, end: string }} ISO datumy (YYYY-MM-DD)
 */
function getPeriodDates(billingDay, periodKey) {
  const [year, month] = periodKey.split('-').map(Number);

  // Start: billingDay daného měsíce (clamped na poslední den)
  const daysInStart = new Date(year, month, 0).getDate();
  const startDay = Math.min(billingDay, daysInStart);
  const start = new Date(year, month - 1, startDay);

  // End: den před billingDay příštího měsíce
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  end.setDate(end.getDate() - 1);

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
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

module.exports = { getPeriodDates, currentPeriodKey, getUserBillingDay };
