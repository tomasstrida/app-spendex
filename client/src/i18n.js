const cs = {
  nav: {
    dashboard: 'Měsíční rozpočty',
    transactions: 'Transakce',
    categories: 'Kategorie',
    rules: 'Pravidla',
    budgets: 'Rozpočty',
    report: 'Schůzka',
    annualBudgets: 'Roční budgety',
    accounts: 'Účty',
    import: 'Import',
    duplicates: 'Duplicity',
    settings: 'Nastavení',
    sectionReports: 'Přehledy',
    sectionConfig: 'Konfigurace',
  },
  dashboard: {
    title: 'Měsíční rozpočty',
    totalSpent: 'Utraceno v období',
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
    notifications_title: 'Notifikace',
    notifications_enable: 'Zapnout notifikace na tomto zařízení',
    notifications_enabled: 'Notifikace zapnuté ✅',
    notifications_disable: 'Vypnout na tomto zařízení',
    notifications_denied: 'Notifikace zakázané v prohlížeči — povol je v nastavení telefonu.',
    notifications_ios_hint: 'Na iPhonu nejdřív přidej Spendex na plochu (Sdílet → Přidat na plochu) a otevři ho odtud.',
    notifications_unsupported: 'Tento prohlížeč push notifikace nepodporuje.',
    notifications_scope_label: 'Co notifikovat',
    notifications_scope_off: 'Vypnuto',
    notifications_scope_pending: 'Jen nezařazené platby',
    notifications_scope_all: 'Všechny platby',
    notifications_test: 'Poslat testovací notifikaci',
    notifications_test_sent: 'Odesláno na {n} zařízení',
    notifications_test_none: 'Nemáš zaregistrované žádné zařízení.',
    household_title: 'Domácnost',
    household_solo: 'Nejsi ve sdílené domácnosti.',
    household_create_invite: 'Vytvořit pozvánku',
    household_regenerate: 'Přegenerovat kód',
    household_code_label: 'Kód pozvánky (pošli ho druhému členovi):',
    household_join_label: 'Připojit se kódem',
    household_join: 'Připojit',
    household_owner_members: 'Členové domácnosti:',
    household_remove: 'Odebrat',
    household_member_of: 'Jsi ve sdílené domácnosti — vlastník:',
    household_leave: 'Odejít z domácnosti',
    household_join_bad: 'Neplatný kód.',
    household_joined: 'Připojeno ✅',
    cards_title: 'Platební karty',
    cards_hint: 'Přiřaď každou kartu členovi domácnosti — notifikace o platbě pak dostane jen ten, kdo platil.',
    cards_unassigned: 'Nepřiřazená',
    cards_assign_placeholder: 'Přiřadit členovi…',
    cards_waiting: 'platby čekají na přiřazení',
    cards_none: 'Zatím žádné karty (objeví se po první platbě kartou).',
    backup_title: 'Zálohy databáze',
    backup_healthy: 'Zálohy běží — poslední úspěšná {when}.',
    backup_stale: 'Poslední úspěšná záloha je starší než {h} h ({when}). Zkontroluj cron / R2.',
    backup_unconfigured: 'Automatické zálohy nejsou nakonfigurované (chybí R2 nastavení).',
    backup_none: 'Zatím žádný záznam o záloze.',
    backup_loading: 'Načítání stavu záloh…',
    backup_col_when: 'Čas',
    backup_col_status: 'Stav',
    backup_col_size: 'Velikost',
    backup_col_pruned: 'Smazáno starých',
    backup_status_success: 'OK',
    backup_status_failure: 'Selhání',
  },
  common: {
    logout: 'Odhlásit se',
    loading: 'Načítání…',
    error: 'Chyba načítání.',
    currency: 'Kč',
  },
  period: {
    resetToCurrent: 'Aktuální měsíc',
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
