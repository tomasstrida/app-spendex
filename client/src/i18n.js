const cs = {
  nav: {
    dashboard: 'Přehled',
    transactions: 'Transakce',
    categories: 'Kategorie',
    budgets: 'Rozpočty',
    settings: 'Nastavení',
  },
  dashboard: {
    title: 'Přehled',
    totalSpent: 'Celkem utraceno',
    budgets: 'Rozpočty',
    noBudgets: 'Žádné rozpočty pro toto období.',
    noBudgetsHint: 'Přidejte rozpočty v sekci Rozpočty.',
    remaining: 'zbývá',
    over: 'přečerpáno',
  },
  categories: {
    title: 'Kategorie',
    add: 'Přidat kategorii',
    edit: 'Upravit kategorii',
    name: 'Název',
    color: 'Barva',
    namePlaceholder: 'např. Jídlo',
    save: 'Uložit',
    cancel: 'Zrušit',
    delete: 'Smazat',
    deleteConfirm: 'Opravdu smazat kategorii? Transakce zůstanou bez kategorie.',
    noCategories: 'Zatím žádné kategorie.',
    transactionCount: 'transakcí',
  },
  settings: {
    title: 'Nastavení',
    billingDay: 'Začátek měsíčního období',
    billingDayHint: 'Den v měsíci, od kterého se počítají vaše výdaje a rozpočty.',
    billingDayExample: 'Např. 19 → období vždy 19.–18. příštího měsíce.',
    save: 'Uložit',
    saved: 'Uloženo.',
  },
  common: {
    logout: 'Odhlásit se',
    loading: 'Načítání…',
    error: 'Chyba načítání.',
    currency: 'Kč',
  },
  months: ['Leden','Únor','Březen','Duben','Květen','Červen',
           'Červenec','Srpen','Září','Říjen','Listopad','Prosinec'],
  monthsShort: ['led','úno','bře','dub','kvě','čvn','čvc','srp','zář','říj','lis','pro'],
};

export const t = cs;

export function formatCurrency(amount) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(amount)) + '\u00a0' + cs.common.currency;
}

export function formatPeriod(start, end) {
  if (!start || !end) return '';
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const sDay = s.getDate();
  const eDay = e.getDate();
  const sMonth = cs.monthsShort[s.getMonth()];
  const eMonth = cs.monthsShort[e.getMonth()];
  const sYear = s.getFullYear();
  const eYear = e.getFullYear();
  if (sYear === eYear) {
    return `${sDay}. ${sMonth} – ${eDay}. ${eMonth} ${sYear}`;
  }
  return `${sDay}. ${sMonth} ${sYear} – ${eDay}. ${eMonth} ${eYear}`;
}

export function addPeriods(periodKey, delta) {
  const [year, month] = periodKey.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
