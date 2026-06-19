import { addPeriods } from '../i18n.js';

// Posun periodKey "YYYY-MM" o delta měsíců. Při posunu vpřed (delta > 0)
// nepřekročí maxPeriod (typ. aktuální měsíc) — stejně jako disabled tlačítko vpřed.
export function stepPeriod(period, delta, maxPeriod) {
  if (!period) return period;
  const next = addPeriods(period, delta);
  if (delta > 0 && maxPeriod && next > maxPeriod) return period;
  return next;
}
