// Semafor pro rtuť teploměrů budgetů (Typ 1 měsíční i Typ 2 roční).
// Centralizovaná barevná logika — jediné místo, kde žijí prahy.
//
//   zelená   = v normě (v rámci budgetu i tempa)
//   oranžová = hrozí přečerpání (tempo utrácení přesáhne budget) NEBO
//              přečerpáno do 10 %
//   červená  = přečerpáno o víc než 10 %
export const BUDGET_GREEN = '#22c55e';  // --success
export const BUDGET_ORANGE = '#f97316';
// Výplň teploměru: intenzivní, sytě tmavá červená — záměrně tmavší/sytější než
// oranžová, aby byl rozdíl oranžová↔červená čitelný i při zhoršeném barvocitu.
// (Na plné ploše rtuti je čitelnost OK.)
export const BUDGET_RED = '#c81e1e';
// Text (částky) na tmavém pozadí: jasnější červená kvůli kontrastu — deep red
// jako text by byl špatně čitelný. Pořád jasně „červená", odlišná od oranžové.
export const BUDGET_RED_TEXT = '#ef4444';

// Vrátí semantický stav budgetu: 'green' | 'orange' | 'red'.
// Jediný zdroj pravdy pro barvu rtuti i barvu textu (částky) budgetu.
export function budgetState({ spent, amount, daysPassed, totalDays }) {
  // Bez rozpočtu nic nehrozí → zelená (a žádné dělení nulou).
  if (!(amount > 0)) return 'green';
  // Přečerpáno: do 10 % oranžová, nad 10 % červená.
  if (spent > amount) {
    return (spent - amount) / amount > 0.10 ? 'red' : 'orange';
  }
  const spentPct = (spent / amount) * 100;
  const dayPct = totalDays > 0 ? Math.min((daysPassed / totalDays) * 100, 100) : 0;
  // Utrácím rychleji, než plyne období → tempo přesáhne budget do konce.
  if (spentPct > dayPct) return 'orange';
  return 'green';
}

const STATE_COLOR = { green: BUDGET_GREEN, orange: BUDGET_ORANGE, red: BUDGET_RED };

export function budgetFillColor(args) {
  return STATE_COLOR[budgetState(args)];
}
