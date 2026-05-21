import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const PeriodContext = createContext(null);

export function PeriodProvider({ children }) {
  const [period, setPeriod] = useState(null);
  const [currentPeriod, setCurrentPeriod] = useState(null);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        if (!s) return;
        setCurrentPeriod(s.current_period);
        // Init period only if not already set (URL deep-link on TransactionsPage
        // may have called setPeriod earlier)
        setPeriod(p => p ?? s.current_period);
      })
      .catch(() => { /* unauthenticated user – ignore */ });
  }, []);

  const resetToCurrent = useCallback(() => {
    if (currentPeriod) setPeriod(currentPeriod);
  }, [currentPeriod]);

  return (
    <PeriodContext.Provider value={{ period, setPeriod, currentPeriod, resetToCurrent }}>
      {children}
    </PeriodContext.Provider>
  );
}

export function usePeriod() {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error('usePeriod must be inside PeriodProvider');
  return ctx;
}
