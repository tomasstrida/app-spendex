// Skutečný součet fixních plateb: jen definované položky, a jen když proběhly
// (tx_count > 0), skutečnou částkou. Auto account-řádky už API nevrací.
export function fixedActualTotal(fixedExpenses) {
  return (fixedExpenses || []).reduce(
    (s, f) => s + (f.tx_count > 0 ? (f.actual || 0) : 0), 0
  );
}

// „Na spořicí" = přebytek za období = příjmy minus výdaje (fixní, dobití ročních
// fondů nad plán, roční výdaje mimo fond, měsíční, drahé věci). Kolik by mělo jít
// na spoření. Skutečné pohyby na spořicím účtu se NEpočítají — Schůzka je
// plánovací, pohyby jsou v Transakcích.
//
// Dotace na účet „Nepravidelné" tu dřív byla čtvrtou položkou, počítaná ze všech
// odchozích plateb na hardcoded číslo účtu. Teď do bilance vstupuje jen jako
// definovaná fixní platba: jinak by se stejný přesun počítal dvakrát a bilance
// by měla vstup, který není nikde v konfiguraci vidět.
//
// `fundTopup` = odliv v kategorii fund_topup (dobití fondu nad standardní dotaci),
// `annualOffFund` = roční výdaje (typ 2) zaplacené mimo fondový účet. Oba jdou
// z `/api/stats/overview`; defaultně 0, aby starší volající nedostali NaN.
//
// `prepaidPurchase` = nákup předplacených balíčků (technická kategorie
// prepaid_purchase). Skutečný odliv v měsíci platby; čerpání balíčku do bilance
// nevstupuje — to je rozpočtový pohled (`budget_spent`), tady by se počítalo dvakrát.
export function surplusToSavings({ totalIncome, totalFixed, fundTopup, annualOffFund, prepaidPurchase, totalType1, totalType3 }) {
  return totalIncome - totalFixed - (fundTopup || 0) - (annualOffFund || 0)
    - (prepaidPurchase || 0) - totalType1 - totalType3;
}

// Jediná pravda pro plánovaný přebytek Schůzky. Skládá mezisoučty z API odpovědí
// (income, fixed-expenses, budgets typ 1, stats.by_category typ 3) a vrátí je
// i s výsledným přebytkem. Používá Schůzka (ReportPage) i stránka Spořicí účet
// (SavingsPage) — aby „plán" na obou seděl na stejné číslo.
// Vstup `budgetsType1` musí být budgets už přefiltrované na typ 1 (jako v ReportPage).
// `extraIncome` = saldo systémové kategorie extra_income za období (z
// `/api/stats/overview`); default 0, aby starší volající dostali `totalToSavings === surplus`.
export function computeMeetingSurplus({
  incomeSources = [],
  fixedExpenses = [],
  budgetsType1 = [],
  byCategory = [],
  fundTopup = 0,
  annualOffFund = 0,
  prepaidPurchase = 0,
  extraIncome = 0,
} = {}) {
  // Striktní whitelist: do bilance vstupují jen ručně aliasované zdroje (id != null).
  const totalIncome = incomeSources
    .filter(s => s.id != null)
    .reduce((s, i) => s + (i.actual || 0), 0);
  const totalFixed = fixedActualTotal(fixedExpenses);
  const totalType1 = budgetsType1.reduce((s, b) => s + (b.spent || 0), 0);
  const totalType3 = byCategory
    .filter(c => c.type === 3 && c.spent > 0)
    .reduce((s, c) => s + c.spent, 0);
  // `surplus` = PROVOZNÍ přebytek: příjmy minus všechny výdaje. Srovnatelný mezi
  // měsíci, protože jednorázovky do něj nevstupují.
  const surplus = surplusToSavings({
    totalIncome, totalFixed, fundTopup, annualOffFund, prepaidPurchase, totalType1, totalType3,
  });
  // `totalToSavings` = kolik má reálně jít na spořicí, tedy provozní přebytek plus
  // mimořádné příjmy (přeplatky, dary, výhry — systémová kategorie extra_income).
  // Schůzka i stránka Spořicí účet musí ukazovat TOHLE číslo, jinak se plán rozejde.
  const totalToSavings = surplus + extraIncome;
  return {
    totalIncome, totalFixed, fundTopup, annualOffFund, prepaidPurchase,
    totalType1, totalType3, extraIncome, surplus, totalToSavings,
  };
}
