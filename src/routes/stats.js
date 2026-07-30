const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { getPeriodDates, getUserBillingDay, currentPeriodKey } = require('../utils/period');
const { savingsNet, reserveBalance, savingsAccount, reserveAccount, reservePaidPatterns, mainAccount, variableAccount } = require('../utils/recurring');
const { SPENDING_AND } = require('../utils/spending-filter');

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
  const accounting = db.prepare(`
    SELECT c.id, c.name, c.color, c.icon,
      COALESCE(SUM(t.amount), 0) AS saldo,
      COUNT(t.id) AS tx_count
    FROM categories c
    LEFT JOIN transactions t ON t.category_id = c.id
      AND t.user_id = ?
      AND t.date >= ? AND t.date <= ?
    WHERE c.user_id = ? AND c.type = 4
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

  const sav = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS deposits,
      COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS withdrawals
    FROM transactions
    WHERE user_id = ? AND counterparty_account LIKE ? || '%'
      AND date >= ? AND date <= ?
  `).get(req.dataUserId, savingsAccount, start, end);

  // Detailní rozpis převodů přes spořicí účet za období. `amount` je z pohledu
  // zdrojového účtu: záporné = vklad na spořicí (peníze odešly), kladné = výběr
  // ze spořicího zpět na provoz. is_regular = standardní měsíční vklad 25 000.
  const savingsTransfers = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount, t.counterparty_account, t.note,
           a.name AS account_name, a.account_number AS account_number
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
    WHERE t.user_id = ? AND t.counterparty_account LIKE ? || '%'
      AND t.date >= ? AND t.date <= ?
    ORDER BY t.date DESC, t.id DESC
  `).all(req.dataUserId, savingsAccount, start, end).map(t => ({
    ...t,
    is_regular: t.amount === -25000,
  }));

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
  });
});

module.exports = router;
