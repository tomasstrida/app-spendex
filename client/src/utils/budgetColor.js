// Semafor pro rtuť teploměrů budgetů (Typ 1 měsíční i Typ 2 roční).
// Centralizovaná barevná logika — jediné místo, kde žijí prahy.
//
//   zelená   = v normě (v rámci budgetu i tempa)
//   oranžová = hrozí přečerpání (tempo utrácení přesáhne budget) NEBO
//              přečerpáno do 10 %
//   červená  = přečerpáno o víc než 10 %
export const BUDGET_GREEN = '#22c55e';  // --success
export const BUDGET_ORANGE = '#f97316';
export const BUDGET_RED = '#ef4444';    // --danger

export function budgetFillColor({ spent, amount, daysPassed, totalDays }) {
  // Bez rozpočtu nic nehrozí → neutrální zelená (a žádné dělení nulou).
  if (!(amount > 0)) return BUDGET_GREEN;
  // Přečerpáno: do 10 % oranžová, nad 10 % červená.
  if (spent > amount) {
    return (spent - amount) / amount > 0.10 ? BUDGET_RED : BUDGET_ORANGE;
  }
  const spentPct = (spent / amount) * 100;
  const dayPct = totalDays > 0 ? Math.min((daysPassed / totalDays) * 100, 100) : 0;
  // Utrácím rychleji, než plyne období → tempo přesáhne budget do konce.
  if (spentPct > dayPct) return BUDGET_ORANGE;
  return BUDGET_GREEN;
}
