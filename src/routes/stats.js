const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { getPeriodDates, getUserBillingDay, currentPeriodKey, shiftPeriodKey, periodIndex, defaultHistoryRange, periodKeyForDate } = require('../utils/period');
const { reserveBalance, reserveAccount, reservePaidPatterns, mainAccount, variableAccount } = require('../utils/recurring');
const { SPENDING_AND } = require('../utils/spending-filter');
const { savingsMovements, findSavingsAccountId } = require('../utils/savings');
const { chainBalances } = require('../utils/balance-chain');
const { fundMovements, fundAnchor, fundRemaining, fundSubsidies } = require('../utils/fund-coverage');

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
  // `extra_income` je vyloučená ze stejného důvodu: mimořádný příjem není převod
  // mezi vlastními účty, jeho saldo je trvale kladné a kontrola na nulu by ho
  // každý měsíc hlásila jako převod s chybějící nohou.
  const accounting = db.prepare(`
    SELECT c.id, c.name, c.color, c.icon,
      COALESCE(SUM(t.amount), 0) AS saldo,
      COUNT(t.id) AS tx_count
    FROM categories c
    LEFT JOIN transactions t ON t.category_id = c.id
      AND t.user_id = ?
      AND t.date >= ? AND t.date <= ?
    WHERE c.user_id = ? AND c.type = 4
      AND COALESCE(c.system_role, '') NOT IN ('prepaid_purchase', 'extra_income')
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

  // Pohyby na spořicím účtu — sdílená pravda pro Schůzku i /savings-history.
  const savings = savingsMovements(db, req.dataUserId, start, end);

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

  // ── Mimořádné příjmy (kategorie se system_role='extra_income') ──
  // Jednorázový příjem bez vazby na pravidelný zdroj: přeplatek energií, dar,
  // výhra, prodej věci. Na Schůzce stojí POD provozní bilancí, aby srovnatelnost
  // měsíců zůstala zachovaná, a připočítá se až do výsledného „Na spořicí".
  //
  // Saldo (SUM(amount)), ne jen kladné částky: vratka části přeplatku zařazená do
  // téže kategorie číslo správně sníží. Bez SPENDING_FILTER (ten vyžaduje kategorii
  // typu 1–3 a zahodil by všechno) a bez omezení na účet — mimořádný příjem může
  // přistát kdekoli. Vyloučení z výpočtu příjmů řeší utils/income.js.
  const extraIncomeCat = db.prepare(
    "SELECT id, name FROM categories WHERE user_id = ? AND system_role = 'extra_income'"
  ).get(req.dataUserId);
  let extraIncome = { category_id: null, name: null, inflow: 0, tx_count: 0 };
  if (extraIncomeCat) {
    const e = db.prepare(`
      SELECT COALESCE(SUM(t.amount), 0) AS inflow, COUNT(t.id) AS tx_count
      FROM transactions t
      WHERE t.user_id = ? AND t.category_id = ?
        AND t.date >= ? AND t.date <= ?
    `).get(req.dataUserId, extraIncomeCat.id, start, end);
    extraIncome = {
      category_id: extraIncomeCat.id, name: extraIncomeCat.name,
      inflow: e.inflow, tx_count: e.tx_count,
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
    extra_income: extraIncome,
  });
});

// ── GET /api/stats/budget-history?from=YYYY-MM&to=YYYY-MM ──────────────────
// Dlouhodobé vyhodnocení: utraceno po obdobích, jedna série na kategorii.
// Období se počítají přes getPeriodDates(billingDay, key), NE jako kalendářní
// měsíce — jinak by při billing_day != 1 čísla nesedla s Měsíčními rozpočty.
const PERIOD_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_PERIODS = 60;
const MIN_DEFAULT_PERIODS = 6;

router.get('/budget-history', requireAuth, (req, res) => {
  const billingDay = getUserBillingDay(db, req.dataUserId);
  // Zálohu na krátký rozsah řeší defaultHistoryRange, ale jen když si rozsah
  // nezvolil uživatel — explicitní parametr se nikdy nepřebíjí.
  const fallback = defaultHistoryRange(currentPeriodKey(billingDay), MIN_DEFAULT_PERIODS);
  const explicit = req.query.from || req.query.to;
  const to = req.query.to || (explicit ? currentPeriodKey(billingDay) : fallback.to);
  const from = req.query.from || (explicit ? `${to.split('-')[0]}-01` : fallback.from);

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

  // Měsíční limit per období: přepsání pro dané období přebíjí default —
  // shodně s /api/budgets, takže se v grafu projeví i period overrides.
  // Kategorie bez jakéhokoli rozpočtu (roční, fond, nebo prostě bez záznamu)
  // dostane `limits: null` a čára limitu se nekreslí.
  const budgetRows = db.prepare('SELECT category_id, month, amount FROM budgets WHERE user_id = ?')
    .all(req.dataUserId);
  const defaultLimit = new Map();
  const overrideLimit = new Map();   // `${category_id}|${periodKey}` → amount
  for (const b of budgetRows) {
    if (b.month === 'default') defaultLimit.set(b.category_id, b.amount);
    else overrideLimit.set(`${b.category_id}|${b.month}`, b.amount);
  }
  const limitsFor = categoryId => {
    const values = periods.map(p => {
      const override = overrideLimit.get(`${categoryId}|${p.key}`);
      return override ?? defaultLimit.get(categoryId) ?? null;
    });
    return values.some(v => v != null) ? values : null;
  };

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
        limits: limitsFor(categoryId),
        total: values.reduce((a, b) => a + b, 0),
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'cs'));

  res.json({ from, to, billing_day: billingDay, periods, series });
});

// ── GET /api/stats/savings-history?from=YYYY-MM&to=YYYY-MM ─────────────────
// Historie spořicího účtu: přírůstek za období + vývoj zůstatku. Zůstatek se
// kotví posledním REÁLNÝM snapshotem z AirBank notifikace a od něj se dopočítává
// oběma směry; skutečné snapshoty se vracejí zvlášť, ať je vidět případný rozdíl.
router.get('/savings-history', requireAuth, (req, res) => {
  const billingDay = getUserBillingDay(db, req.dataUserId);
  // Na rozdíl od /budget-history se zobrazuje i BĚŽÍCÍ období — u spoření je
  // rozjetý měsíc užitečná informace, ne zavádějící propad.
  const fallback = defaultHistoryRange(currentPeriodKey(billingDay), MIN_DEFAULT_PERIODS);
  const to = req.query.to || currentPeriodKey(billingDay);
  const from = req.query.from || fallback.from;

  if (!PERIOD_KEY_RE.test(from) || !PERIOD_KEY_RE.test(to)) {
    return res.status(400).json({ error: 'Parametry from/to musí mít formát YYYY-MM.' });
  }
  const count = periodIndex(to) - periodIndex(from) + 1;
  if (count < 1) return res.status(400).json({ error: 'Parametr from musí být menší nebo roven to.' });
  if (count > MAX_PERIODS) return res.status(400).json({ error: `Rozsah je omezený na ${MAX_PERIODS} období.` });

  const today = new Date().toISOString().slice(0, 10);
  const periods = [];
  for (let i = 0; i < count; i++) {
    const key = shiftPeriodKey(from, i);
    const dates = getPeriodDates(billingDay, key);
    periods.push({ key, ...dates, partial: dates.end >= today });
  }

  const values = periods.map(p => {
    const m = savingsMovements(db, req.dataUserId, p.start, p.end);
    return {
      period: p.key,
      deposits: m.deposits,
      withdrawals: m.withdrawals,
      net: m.net,
      // tx_ids jsou povinné: součet je JS-počítaný přes dedup noh, takže filtr
      // podle data a účtu by v Transakcích vrátil i zahozené druhé nohy převodů.
      tx_ids: m.transfers.map(t => t.id),
      balance_derived: null,
      balance_actual: null,
    };
  });

  const savingsAccountId = findSavingsAccountId(db, req.dataUserId);

  // Skutečný zůstatek per období = poslední snapshot uvnitř období.
  if (savingsAccountId) {
    const snapStmt = db.prepare(`
      SELECT balance_after FROM transactions
      WHERE user_id = ? AND account_id = ? AND balance_after IS NOT NULL
        AND date >= ? AND date <= ?
      ORDER BY date DESC, COALESCE(tx_time, '') DESC, id DESC
      LIMIT 1
    `);
    periods.forEach((p, i) => {
      const row = snapStmt.get(req.dataUserId, savingsAccountId, p.start, p.end);
      values[i].balance_actual = row ? row.balance_after : null;
    });
  }

  // Kotva pro dopočet — nejnovější snapshot napříč celou historií, i mimo rozsah.
  const anchorRow = savingsAccountId
    ? db.prepare(`
        SELECT date, balance_after FROM transactions
        WHERE user_id = ? AND account_id = ? AND balance_after IS NOT NULL
        ORDER BY date DESC, COALESCE(tx_time, '') DESC, id DESC
        LIMIT 1
      `).get(req.dataUserId, savingsAccountId)
    : null;

  if (anchorRow) {
    const fromIdx = periodIndex(from);
    const toIdx = periodIndex(to);
    const anchorKey = periodKeyForDate(billingDay, anchorRow.date);
    const anchorIdx = periodIndex(anchorKey);

    // Netto pohyby libovolného období — zobrazená se berou z `values`, období mezi
    // rozsahem a kotvou (kotva může ležet mimo rozsah) se dopočítají dotazem.
    const netCache = new Map();
    values.forEach((v, i) => netCache.set(fromIdx + i, v.net));
    const netAt = absIdx => {
      if (!netCache.has(absIdx)) {
        const d = getPeriodDates(billingDay, shiftPeriodKey(from, absIdx - fromIdx));
        netCache.set(absIdx, savingsMovements(db, req.dataUserId, d.start, d.end).net);
      }
      return netCache.get(absIdx);
    };

    // Zůstatek ke konci kotvícího období: ke kotvě se přičtou pohyby, které v témže
    // období nastaly PO ní. Porovnává se na úrovni DNE — kotva je nejnovější snapshot,
    // takže pozdějších pohybů je minimum a `balance_actual` rozdíl stejně zviditelní.
    // Dotaz jde přes CELÉ období, ne od data kotvy: dedup noh převodu potřebuje
    // v okně obě strany, jinak by se osamocená noha započítala podruhé.
    const anchorDates = getPeriodDates(billingDay, anchorKey);
    const after = savingsMovements(db, req.dataUserId, anchorDates.start, anchorDates.end)
      .transfers
      .filter(t => t.date > anchorRow.date)
      .reduce((acc, t) => acc + (t.external ? t.amount : -t.amount), 0);

    const balances = chainBalances({
      anchorIndex: anchorIdx,
      anchorBalance: anchorRow.balance_after + after,
      fromIndex: fromIdx,
      toIndex: toIdx,
      netAt,
    });

    values.forEach((v, i) => {
      const b = balances.get(fromIdx + i);
      if (b != null) v.balance_derived = b;
    });
  }

  const totals = values.reduce((acc, v) => ({
    deposits: acc.deposits + v.deposits,
    withdrawals: acc.withdrawals + v.withdrawals,
    net: acc.net + v.net,
  }), { deposits: 0, withdrawals: 0, net: 0 });

  res.json({
    from, to, billing_day: billingDay, periods, values, totals,
    anchor: anchorRow ? { date: anchorRow.date, balance: anchorRow.balance_after } : null,
  });
});

// ── GET /api/stats/fund-history?account_id=&from=YYYY-MM&to=YYYY-MM ────────
// Kontrola fondu: krytí (zůstatek proti tomu, co z fondu ještě letos odejde)
// + historie zůstatku po obdobích. `values` mají ZÁMĚRNĚ stejný tvar jako
// savings-history, aby šla použít táž komponenta grafu.
router.get('/fund-history', requireAuth, (req, res) => {
  if (req.query.account_id === undefined) {
    return res.status(400).json({ error: 'Chybí parametr account_id.' });
  }
  const accountId = parseInt(req.query.account_id, 10);
  const account = Number.isInteger(accountId)
    ? db.prepare('SELECT id, name, account_number FROM accounts WHERE id = ? AND user_id = ? AND is_fund = 1')
        .get(accountId, req.dataUserId)
    : null;
  if (!account) return res.status(400).json({ error: 'Účet není fondový.' });

  const billingDay = getUserBillingDay(db, req.dataUserId);
  // Jako u spoření se zobrazuje i BĚŽÍCÍ období — u fondu je rozjetý měsíc
  // podstatná informace, ne zavádějící propad.
  const fallback = defaultHistoryRange(currentPeriodKey(billingDay), MIN_DEFAULT_PERIODS);
  const to = req.query.to || currentPeriodKey(billingDay);
  const from = req.query.from || fallback.from;

  if (!PERIOD_KEY_RE.test(from) || !PERIOD_KEY_RE.test(to)) {
    return res.status(400).json({ error: 'Parametry from/to musí mít formát YYYY-MM.' });
  }
  const count = periodIndex(to) - periodIndex(from) + 1;
  if (count < 1) return res.status(400).json({ error: 'Parametr from musí být menší nebo roven to.' });
  if (count > MAX_PERIODS) return res.status(400).json({ error: `Rozsah je omezený na ${MAX_PERIODS} období.` });

  const today = new Date().toISOString().slice(0, 10);
  const periods = [];
  for (let i = 0; i < count; i++) {
    const key = shiftPeriodKey(from, i);
    const dates = getPeriodDates(billingDay, key);
    periods.push({ key, ...dates, partial: dates.end >= today });
  }

  const txIdStmt = db.prepare(`
    SELECT id FROM transactions
    WHERE user_id = ? AND account_id = ? AND date >= ? AND date <= ?
    ORDER BY date, id
  `);
  const snapStmt = db.prepare(`
    SELECT balance_after FROM transactions
    WHERE user_id = ? AND account_id = ? AND balance_after IS NOT NULL
      AND date >= ? AND date <= ?
    ORDER BY date DESC, COALESCE(tx_time, '') DESC, id DESC
    LIMIT 1
  `);

  const values = periods.map(p => {
    const snap = snapStmt.get(req.dataUserId, account.id, p.start, p.end);
    return {
      period: p.key,
      net: fundMovements(db, req.dataUserId, account.id, p.start, p.end),
      // Proklik jede přes tx_ids stejně jako u spoření — filtr podle účtu a data
      // by v Transakcích nešel vyjádřit tak, aby seznam seděl na součet.
      tx_ids: txIdStmt.all(req.dataUserId, account.id, p.start, p.end).map(r => r.id),
      balance_derived: null,
      balance_actual: snap ? snap.balance_after : null,
    };
  });

  const anchor = fundAnchor(db, req.dataUserId, account.id);
  if (anchor) {
    const fromIdx = periodIndex(from);
    const toIdx = periodIndex(to);
    const anchorIdx = periodIndex(periodKeyForDate(billingDay, anchor.date));

    const netCache = new Map();
    values.forEach((v, i) => netCache.set(fromIdx + i, v.net));
    const netAt = absIdx => {
      if (!netCache.has(absIdx)) {
        const d = getPeriodDates(billingDay, shiftPeriodKey(from, absIdx - fromIdx));
        netCache.set(absIdx, fundMovements(db, req.dataUserId, account.id, d.start, d.end));
      }
      return netCache.get(absIdx);
    };

    // Zůstatek ke KONCI kotvícího období: ke kotvě se přičtou pohyby, které v témže
    // období nastaly po ní (porovnání na úrovni dne, stejně jako u spoření).
    const anchorDates = getPeriodDates(billingDay, periodKeyForDate(billingDay, anchor.date));
    const after = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS s
      FROM transactions
      WHERE user_id = ? AND account_id = ? AND date > ? AND date <= ?
    `).get(req.dataUserId, account.id, anchor.date, anchorDates.end).s;

    const balances = chainBalances({
      anchorIndex: anchorIdx,
      anchorBalance: anchor.balance + after,
      fromIndex: fromIdx,
      toIndex: toIdx,
      netAt,
    });
    values.forEach((v, i) => {
      const b = balances.get(fromIdx + i);
      if (b != null) v.balance_derived = b;
    });
  }

  const { plan, spent, remaining, categories } = fundRemaining(db, req.dataUserId, account.id, today);
  // Fond není statická hromádka — do konce roku na něj ještě přijdou dotace.
  // Bez nich by karta hlásila schodek, který ve skutečnosti není.
  const subsidies = fundSubsidies(db, req.dataUserId, account.id, today);

  // Krytí musí mířit na DNEŠEK, ne na den kotvy — `remaining` je taky forward-looking.
  // Kotva bývá týdny stará (fond dostává snapshot jen u plateb, co prošly frontou
  // revize), takže se k ní přičtou VŠECHNY pohyby po ní až do teď, bez horní meze.
  const post = anchor
    ? db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS s FROM transactions
        WHERE user_id = ? AND account_id = ? AND date > ?
      `).get(req.dataUserId, account.id, anchor.date).s
    : 0;
  const balanceToday = anchor ? anchor.balance + post : null;

  res.json({
    from, to, billing_day: billingDay,
    account,
    coverage: {
      balance: balanceToday,          // odhad k dnešku (kotva + pohyby po ní)
      balance_date: today,            // ke kterému dni odhad platí
      anchor_balance: anchor ? anchor.balance : null,   // naposledy potvrzeno bankou
      anchor_date: anchor ? anchor.date : null,
      plan,                           // roční plán fondu = součet podpoložek jeho kategorií
      spent,                          // letos vyčerpáno (skutečnost, NEOŘEZANÁ na plán)
      remaining,                      // kolik z plánu ještě zbývá (per kategorie, floor 0)
      subsidies: subsidies.total,     // očekávané dotace na fond do konce roku
      subsidy_items: subsidies.items,
      diff: anchor ? balanceToday + subsidies.total - remaining : null,
      categories,
    },
    periods, values,
    totals: { net: values.reduce((s, v) => s + v.net, 0) },
    anchor: anchor ? { date: anchor.date, balance: anchor.balance } : null,
  });
});

module.exports = router;
