import { useEffect } from 'react';
import { usePeriod } from '../contexts/PeriodContext';
import { stepPeriod } from '../utils/stepPeriod';

// Klávesy ←/→ posunou globální období o měsíc zpět/vpřed.
// Opt-in: zavolej na stránce s měsíční navigací. `enabled` umožní vypnutí
// (např. Transakce ve free-range režimu).
export function usePeriodKeys({ enabled = true } = {}) {
  const { setPeriod, currentPeriod } = usePeriod();

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const el = e.target;
      const tag = el && el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable)) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPeriod(p => stepPeriod(p, -1, currentPeriod));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPeriod(p => stepPeriod(p, 1, currentPeriod));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, setPeriod, currentPeriod]);
}
