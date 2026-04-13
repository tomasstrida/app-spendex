const cs = {
  nav: {
    dashboard: 'Přehled',
    transactions: 'Transakce',
    categories: 'Kategorie',
    budgets: 'Rozpočty',
  },
  dashboard: {
    title: 'Přehled',
    totalSpent: 'Celkem utraceno',
    budgets: 'Rozpočty',
    noBudgets: 'Žádné rozpočty pro tento měsíc.',
    noBudgetsHint: 'Přidejte rozpočty v sekci Rozpočty.',
    spent: 'utraceno',
    remaining: 'zbývá',
    over: 'přečerpáno',
    of: 'z',
    uncategorized: 'Bez kategorie',
  },
  common: {
    logout: 'Odhlásit se',
    loading: 'Načítání…',
    error: 'Chyba načítání.',
    currency: 'Kč',
  },
  months: ['Leden','Únor','Březen','Duben','Květen','Červen',
           'Červenec','Srpen','Září','Říjen','Listopad','Prosinec'],
};

export const t = cs;

export function formatCurrency(amount) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(amount)) + ' ' + cs.common.currency;
}

export function formatMonth(isoMonth) {
  const [year, month] = isoMonth.split('-').map(Number);
  return `${cs.months[month - 1]} ${year}`;
}

export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function addMonths(isoMonth, delta) {
  const [year, month] = isoMonth.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
