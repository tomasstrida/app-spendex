const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { getPeriodDates, getUserBillingDay, currentPeriodKey } = require('../utils/period');
const { savingsNet, reserveBalance, savingsAccount, reserveAccount, reservePaidPatterns, mainAccount, variableAccount } = require('../utils/recurring');
const { SPENDING_AND } = require('../utils/spending-filter');
const { normCounterparty } = require('../utils/income');

// GET /api/stats/overview?period=2026-04
router.get('/overview', requireAuth, (req, res) => {
  const billingDay = getUserBillingDay(db, req.dataUserId);
  const periodKey = req.query.period || currentPeriodKey(billingDay);
  const { start, end } = getPeriodDates(billingDay, periodKey);

  // Fáze A: „výdaj domácnosti" = spending účet, NULL účet, NEBO reálná kategorie
  // (typ 1/2/3) na ignorovaném účtu. Sdílený fragment (viz utils/spending-filter).
  const SPENDING_FILTER = SPENDING_AND;

  const total = db.prepare(`
    SELECT COALESCE(SUM(-t.amount), 0) as total_spent
    FROM transactions t
    WHERE t.user_id = ? AND t.date >= ? AND t.date <= ?
    ${SPENDING_FILTER}
  `).get(req.dataUserId, start, end);

  const byCategory = db.prepare(`
    SELECT c.id, c.name, c.color, c.icon, c.type,
      COALESCE(SUM(-t.amount), 0) as spent,
      COUNT(t.id) as tx_count
    FROM categories c
    LEFT JOIN transactions t ON t.category_id = c.id
      AND t.user_id = ?
      AND t.date >= ? AND t.date <= ?
      ${SPENDING_FILTER}
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY spent DESC
  `).all(req.dataUserId, start, end, req.dataUserId);

  const bySubcategory = db.prepare(`
    SELECT t.subcategory_id, sc.category_id, sc.name,
      COALESCE(SUM(-t.amount), 0) as spent
    FROM transactions t
    JOIN subcategories sc ON sc.id = t.subcategory_id
    WHERE t.user_id = ? AND t.date >= ? AND t.date <= ? ${SPENDING_FILTER}
    GROUP BY t.subcategory_id
    ORDER BY spent DESC
  `).all(req.dataUserId, start, end);

  // Účetní kategorie (type=4): saldo napříč VŠEMI účty (bez SPENDING_FILTER),
  // aby interní převody vyšly na nulu. Kladné=příliv, záporné=odliv, ~0=vyrovnané.
  // `prepaid_purchase` je z Účetní sekce vyloučená: není to převod mezi vlastními
  // účty, ale skutečný výdaj, takže saldo nemá smysl kontrolovat na nulu.
  const accounting = db.prepare(`
    SELECT c.id, c.name, c.color, c.icon,
      COALESCE(SUM(t.amount), 0) AS saldo,
      COUNT(t.id) AS tx_count
    FROM categories c
    LEFT JOIN transactions t ON t.category_id = c.id
      AND t.user_id = ?
      AND t.date >= ? AND t.date <= ?
    WHERE c.user_id = ? AND c.type = 4
      AND COALESCE(c.system_role, '') != 'prepaid_purchase'
    GROUP BY c.id
    ORDER BY c.name ASC
  `).all(req.dataUserId, start, end, req.dataUserId);

  // Posledních 12 období
  const trend = db.prepare(`
    SELECT strftime('%Y-%m', t.date) as month_key,
      COALESCE(SUM(-t.amount), 0) as spent
    FROM transactions t
    WHERE t.user_id = ?
    ${SPENDING_FILTER}
    GROUP BY strftime('%Y-%m', t.date)
    ORDER BY month_key DESC
    LIMIT 12
  `).all(req.dataUserId);

  // Detailní rozpis pohybů na spořicím účtu za období.
  // Interní převod má v DB OBĚ nohy (odchozí z běžného účtu + příchozí na spořicí),
  // proto se bere jen ta, kde je spořicí protiúčtem — druhá by ho zdvojila.
  // Peníze, které na spořicí přijdou zvenku (cizí odesílatel) nebo bez protistrany
  // (kreditní úrok), ale druhou nohu nemají — ty se musí vzít z transakcí zaúčtovaných
  // přímo na spořicím účtu, jinak by v přehledu chyběly (řádek má `external: 1`).
  // Spořicí účet se hledá přes normalizované číslo, ne exact match na sloupec —
  // jinak by stačila mezera navíc v `accounts` a doplňování pohybů by tiše vyplo.
  const savingsNumber = normCounterparty(savingsAccount);
  const savingsAccountId = db.prepare('SELECT id, account_number FROM accounts WHERE user_id = ?')
    .all(req.dataUserId)
    .filter(a => normCounterparty(a.account_number) === savingsNumber)
    .map(a => a.id)[0] || null;

  // `amount` je u běžné nohy z pohledu zdrojového účtu (záporné = vklad na spořicí),
  // u `external` řádků z pohledu spořicího účtu (kladné = přibylo). Převod na jednotný
  // pohled dělá `onSavings` níž i klient. is_regular = standardní měsíční vklad 25 000.
  // REPLACE v porovnání protiúčtu: čísla účtů chodí i s mezerami, exact LIKE by je minul.
  const savingsRows = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount, t.counterparty_account, t.note,
           a.name AS account_name, a.account_number AS account_number
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
    WHERE t.user_id = ? AND t.date >= ? AND t.date <= ?
      AND (REPLACE(t.counterparty_account, ' ', '') LIKE ? || '%' OR t.account_id = ?)
    ORDER BY t.date DESC, t.id DESC
  `).all(req.dataUserId, start, end, savingsNumber, savingsAccountId);

  // Noha zaúčtovaná na běžném účtu (spořicí je protistrana) je referenční — z ní se
  // pohyb počítá vždy. Noha zaúčtovaná na spořicím účtu se zahodí jen tehdy, když k ní
  // referenční protějšek v datech SKUTEČNĚ existuje (stejné datum, opačná částka,
  // párování 1:1). Odvozovat to z protiúčtu nestačí: chybějící protiúčet by převod
  // zdvojil a nenaimportovaný druhý účet by naopak skutečný pohyb nechal zmizet.
  // Párovací okno: obě nohy nesou datum zaúčtování téhož převodu, takže v datech
  // vycházejí na stejný den (ověřeno na celé historii: 49 z 49 párů). Tolerance je
  // pojistka pro případ, kdy banka strany zaúčtuje přes půlnoc nebo přes víkend.
  const PAIR_WINDOW_DAYS = 3;
  const dayDiff = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

  const pool = savingsRows
    .filter(t => normCounterparty(t.counterparty_account) === savingsNumber)
    .map(t => ({ date: t.date, amount: -t.amount, used: false }));   // částka z pohledu spořicího

  // Spotřebuje protějšek pro danou nohu (nejbližší datum vyhrává), nebo vrátí false.
  function takeCounterpartyLeg(t) {
    let best = null;
    for (const p of pool) {
      if (p.used || p.amount !== t.amount) continue;
      const d = dayDiff(p.date, t.date);
      if (d > PAIR_WINDOW_DAYS) continue;
      if (!best || d < best.d) best = { p, d };
      if (d === 0) break;
    }
    if (!best) return false;
    best.p.used = true;
    return true;
  }

  const savingsTransfers = savingsRows
    .map(t => {
      if (normCounterparty(t.counterparty_account) === savingsNumber) {
        return { ...t, external: 0, is_regular: t.amount === -25000 };
      }
      if (takeCounterpartyLeg(t)) return null;    // druhá noha už započteného převodu
      return { ...t, external: 1, is_regular: false };
    })
    .filter(Boolean);

  // Pohled spořicího účtu: kladné = přibylo (vklad), záporné = ubylo (výběr).
  const onSavings = t => (t.external ? t.amount : -t.amount);
  const sav = savingsTransfers.reduce((acc, t) => {
    const v = onSavings(t);
    if (v > 0) acc.deposits += v;
    else acc.withdrawals += -v;
    return acc;
  }, { deposits: 0, withdrawals: 0 });

  const savings = {
    deposits: sav.deposits,
    withdrawals: sav.withdrawals,
    net: savingsNet(sav),
    transfers: savingsTransfers,
  };

  const envCol = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS envelopeDeposits,
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS envelopeReturns
    FROM transactions
    WHERE user_id = ? AND counterparty_account LIKE ? || '%' AND date <= ?
  `).get(req.dataUserId, reserveAccount, end);
  const paidStmt = db.prepare(`
    SELECT COALESCE(SUM(ABS(amount)), 0) AS s
    FROM transactions
    WHERE user_id = ? AND amount < 0 AND date <= ? AND description LIKE '%' || ? || '%'
  `);
  const najemSum = paidStmt.get(req.dataUserId, end, reservePaidPatterns[0]).s;
  const preSum   = paidStmt.get(req.dataUserId, end, reservePaidPatterns[1]).s;
  const reserve = {
    balance: reserveBalance({
      envelopeDeposits: envCol.envelopeDeposits,
      najemSum, preSum,
      envelopeReturns: envCol.envelopeReturns,
    }),
  };

  // Jednotlivé položky drahých věcí (Typ 3) v zobrazeném období – seznam transakcí.
  // Stejný SPENDING_FILTER jako součet „Drahé věci celkem" (by_category), aby seznam
  // seděl na součet — jinak sem padaly i drahé věci z ignorovaných účtů, které se
  // do součtu nepočítají.
  const expensiveItems = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount, t.note,
           c.id AS category_id, c.name AS category_name, c.color AS category_color
    FROM transactions t
    JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
    WHERE t.user_id = ? AND c.type = 3
      AND t.date >= ? AND t.date <= ?
      ${SPENDING_FILTER}
    ORDER BY t.date DESC, t.id DESC
  `).all(req.dataUserId, start, end);

  // ── Nestandardní dobití ročního budgetu (kategorie se system_role='fund_topup') ──
  // Do bilance jde JEN odchozí noha z provozního účtu; příchozí noha na fondovém
  // účtu by ji vyrušila. `saldo` napříč všemi účty je kontrola pro uživatele:
  // když označí jen jednu nohu převodu, nevyjde 0 (sekce Účetní to ukáže s ⚠).
  // Záměrně BEZ SPENDING_FILTER (na rozdíl od `annual_off_fund` níž): ten filtr
  // vyžaduje kategorii typu 1–3 a zahodil by dobití zaplacené z účtu s rolí
  // 'ignored' (Hlavní), které se ale do bilance počítat MUSÍ. Důsledek: dobití
  // zaplacené přímo z OSVČ účtu (role='income', mimo scope aplikace) se odečte
  // jako výdaj domácnosti, přestože jeho zdroj do „Příjmy celkem" nevstupuje.
  const topupCat = db.prepare(
    "SELECT id, name FROM categories WHERE user_id = ? AND system_role = 'fund_topup'"
  ).get(req.dataUserId);
  let fundTopup = { category_id: null, name: null, outflow: 0, tx_count: 0, saldo: 0 };
  if (topupCat) {
    const o = db.prepare(`
      SELECT COALESCE(SUM(-t.amount), 0) AS outflow, COUNT(t.id) AS tx_count
      FROM transactions t
      WHERE t.user_id = ? AND t.category_id = ? AND t.amount < 0
        AND t.date >= ? AND t.date <= ?
        AND NOT EXISTS (SELECT 1 FROM accounts fa WHERE fa.id = t.account_id AND fa.is_fund = 1)
    `).get(req.dataUserId, topupCat.id, start, end);
    const s = db.prepare(`
      SELECT COALESCE(SUM(t.amount), 0) AS saldo
      FROM transactions t
      WHERE t.user_id = ? AND t.category_id = ? AND t.date >= ? AND t.date <= ?
    `).get(req.dataUserId, topupCat.id, start, end);
    fundTopup = {
      category_id: topupCat.id, name: topupCat.name,
      outflow: o.outflow, tx_count: o.tx_count, saldo: s.saldo,
    };
  }

  // ── Roční výdaje (typ 2) zaplacené mimo fondový účet ──
  // null = uživatel nemá označený ani jeden fondový účet; řádek by pak ukázal
  // celé roční čerpání (každý účet by byl „mimo fond") a mátl, proto se skryje.
  // Riziko dvojího započtení: `fixedExpensesForPeriod` matchuje čistě podle
  // textu/protiúčtu a nekouká na typ kategorie – pokud by transakce v kategorii
  // typu 2 na ne-fondovém účtu zároveň sedla na aktivní matcher fixní platby,
  // počítala by se dvakrát (jednou v „Fixní platby", jednou tady). Na aktuálních
  // produkčních datech k tomu nedochází (matcher typ kategorie nezohledňuje).
  const hasFundAccount = db.prepare(
    'SELECT 1 FROM accounts WHERE user_id = ? AND is_fund = 1 LIMIT 1'
  ).get(req.dataUserId);
  let annualOffFund = null;
  if (hasFundAccount) {
    annualOffFund = db.prepare(`
      SELECT COALESCE(SUM(-t.amount), 0) AS spent, COUNT(t.id) AS tx_count
      FROM transactions t
      JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
      WHERE t.user_id = ? AND c.type = 2 AND t.date >= ? AND t.date <= ?
        AND NOT EXISTS (SELECT 1 FROM accounts fa WHERE fa.id = t.account_id AND fa.is_fund = 1)
        ${SPENDING_FILTER}
    `).get(req.dataUserId, start, end);
  }

  // ── Nákup předplacených balíčků ──
  // Skutečný odliv za období. Čerpání balíčku se do bilance NEpromítá (to je
  // rozpočtový pohled v /api/budgets), takže se nic nezapočte dvakrát.
  // POZOR: záměrně BEZ SPENDING_FILTER a bez filtru na fondové účty (na rozdíl
  // od `annualOffFund` výše) — platba za balíček je vždy jednorázový odliv
  // vlastní kategorie, ne matcher přes fixní platby/roční kategorie, takže
  // riziko dvojího započtení, kterému SPENDING_FILTER předchází jinde, tu
  // nevzniká. Důsledek: balíček zaplacený z OSVČ účtu (mimo scope SPENDING_
  // FILTER) se PŘESTO odečte od přebytku, i když jeho zdroj do příjmů
  // nevstupuje — čistě výdajová strana bilance ho tedy vidí, příjmová ne.
  const prepaidCat = db.prepare(
    "SELECT id, name FROM categories WHERE user_id = ? AND system_role = 'prepaid_purchase'"
  ).get(req.dataUserId);
  let prepaidPurchase = { category_id: null, name: null, outflow: 0, tx_count: 0 };
  if (prepaidCat) {
    const p = db.prepare(`
      SELECT COALESCE(SUM(-t.amount), 0) AS outflow, COUNT(t.id) AS tx_count
      FROM transactions t
      WHERE t.user_id = ? AND t.category_id = ? AND t.amount < 0
        AND t.date >= ? AND t.date <= ?
    `).get(req.dataUserId, prepaidCat.id, start, end);
    prepaidPurchase = {
      category_id: prepaidCat.id, name: prepaidCat.name,
      outflow: p.outflow, tx_count: p.tx_count,
    };
  }

  res.json({
    period: periodKey,
    period_start: start,
    period_end: end,
    billing_day: billingDay,
    total_spent: total.total_spent,
    by_category: byCategory,
    by_subcategory: bySubcategory,
    monthly_trend: trend,
    savings,
    reserve,
    expensive_items: expensiveItems,
    accounting,
    fund_topup: fundTopup,
    annual_off_fund: annualOffFund,
    prepaid_purchase: prepaidPurchase,
  });
});

// ── GET /api/stats/budget-history?from=YYYY-MM&to=YYYY-MM ──────────────────
// Dlouhodobé vyhodnocení: utraceno po obdobích, jedna série na kategorii.
// Období se počítají přes getPeriodDates(billingDay, key), NE jako kalendářní
// měsíce — jinak by při billing_day != 1 čísla nesedla s Měsíčními rozpočty.
const PERIOD_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_PERIODS = 60;

function shiftPeriodKey(periodKey, delta) {
  const [y, m] = periodKey.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

function periodIndex(periodKey) {
  const [y, m] = periodKey.split('-').map(Number);
  return y * 12 + (m - 1);
}

router.get('/budget-history', requireAuth, (req, res) => {
  const billingDay = getUserBillingDay(db, req.dataUserId);
  const to = req.query.to || currentPeriodKey(billingDay);
  const from = req.query.from || shiftPeriodKey(to, -11);

  if (!PERIOD_KEY_RE.test(from) || !PERIOD_KEY_RE.test(to)) {
    return res.status(400).json({ error: 'Parametry from/to musí mít formát YYYY-MM.' });
  }
  const count = periodIndex(to) - periodIndex(from) + 1;
  if (count < 1) return res.status(400).json({ error: 'Parametr from musí být menší nebo roven to.' });
  if (count > MAX_PERIODS) return res.status(400).json({ error: `Rozsah je omezený na ${MAX_PERIODS} období.` });

  const periods = [];
  for (let i = 0; i < count; i++) {
    const key = shiftPeriodKey(from, i);
    periods.push({ key, ...getPeriodDates(billingDay, key) });
  }

  // Výdajové série: type=4 (účetní/převody) do vyhodnocení výdajů nepatří —
  // interní převody nejsou výdaj a `prepaid_purchase` by se dvojil s čerpáním
  // balíčku, které se níž připočítává ke skutečné kategorii.
  const spentStmt = db.prepare(`
    SELECT t.category_id AS category_id, COALESCE(SUM(-t.amount), 0) AS spent
    FROM transactions t
    JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
    WHERE t.user_id = ? AND t.date >= ? AND t.date <= ? AND c.type != 4
    ${SPENDING_AND}
    GROUP BY t.category_id
  `);

  // Čerpání předplacených balíčků se počítá stejně jako `budget_spent`
  // v /api/budgets — aby graf a Měsíční rozpočty ukazovaly totéž číslo.
  const prepaidStmt = db.prepare(`
    SELECT p.category_id AS category_id, COALESCE(SUM(d.amount), 0) AS spent
    FROM prepaid_draws d
    JOIN prepaid_packages p ON p.id = d.package_id AND p.user_id = d.user_id
    WHERE d.user_id = ? AND d.date >= ? AND d.date <= ?
    GROUP BY p.category_id
  `);

  const byCat = new Map(); // category_id → number[] (index = pořadí období)
  const bump = (catId, i, value) => {
    if (catId == null || !value) return;
    if (!byCat.has(catId)) byCat.set(catId, new Array(count).fill(0));
    byCat.get(catId)[i] += value;
  };

  periods.forEach((p, i) => {
    for (const row of spentStmt.all(req.dataUserId, p.start, p.end)) bump(row.category_id, i, row.spent);
    for (const row of prepaidStmt.all(req.dataUserId, p.start, p.end)) bump(row.category_id, i, row.spent);
  });

  const meta = new Map(
    db.prepare('SELECT id, name, color, icon, type FROM categories WHERE user_id = ?')
      .all(req.dataUserId)
      .map(c => [c.id, c])
  );

  const series = [...byCat.entries()]
    .filter(([, values]) => values.some(v => v !== 0))
    .map(([categoryId, values]) => {
      const c = meta.get(categoryId) || {};
      return {
        category_id: categoryId,
        name: c.name || `#${categoryId}`,
        color: c.color || null,
        icon: c.icon || null,
        type: c.type ?? 1,
        values,
        total: values.reduce((a, b) => a + b, 0),
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'cs'));

  res.json({ from, to, billing_day: billingDay, periods, series });
});


module.exports = router;
