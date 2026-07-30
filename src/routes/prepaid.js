const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { getPeriodDates, getUserBillingDay } = require('../utils/period');
const { unitAmount, drawAmount, packageSummary, writeOffAmount } = require('../utils/prepaid');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// Balíček + dopočtené hodnoty. `periodRange` (nepovinné) omezí vrácená čerpání
// na jedno období; zbytek balíčku se ale VŽDY počítá ze všech čerpání, jinak by
// v období bez čerpání vypadal balíček jako nedotčený.
function withSummary(pkg, periodRange) {
  const allDraws = db.prepare(
    'SELECT * FROM prepaid_draws WHERE package_id = ? AND user_id = ? ORDER BY date ASC, id ASC'
  ).all(pkg.id, pkg.user_id);
  const draws = periodRange
    ? allDraws.filter(d => d.date >= periodRange.start && d.date <= periodRange.end)
    : allDraws;
  return { ...pkg, ...packageSummary(pkg, allDraws), draws };
}

// GET /api/prepaid?status=active|closed|all&category=<id>&period=YYYY-MM
router.get('/', requireAuth, (req, res) => {
  const status = req.query.status || 'active';
  const filters = ['p.user_id = ?'];
  const params = [req.dataUserId];
  if (status !== 'all') { filters.push('p.status = ?'); params.push(status); }
  if (req.query.category) { filters.push('p.category_id = ?'); params.push(parseInt(req.query.category)); }

  let periodRange = null;
  if (req.query.period) {
    const billingDay = getUserBillingDay(db, req.dataUserId);
    periodRange = getPeriodDates(billingDay, req.query.period);
  }

  const rows = db.prepare(`
    SELECT p.*, c.name AS category_name, c.color AS category_color
    FROM prepaid_packages p
    LEFT JOIN categories c ON c.id = p.category_id AND c.user_id = p.user_id
    WHERE ${filters.join(' AND ')}
    ORDER BY p.status ASC, p.created_at DESC
  `).all(...params);

  res.json({ packages: rows.map(p => withSummary(p, periodRange)) });
});

// POST /api/prepaid — z existující platby udělá balíček
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { transaction_id, name, category_id, units_total, valid_until, note } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Název balíčku je povinný.' });

  const units = parseFloat(units_total);
  if (!(units > 0)) return res.status(400).json({ error: 'Počet jednotek musí být kladné číslo.' });

  const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .get(transaction_id, req.dataUserId);
  if (!tx) return res.status(404).json({ error: 'Transakce nenalezena.' });
  if (!(tx.amount < 0)) return res.status(400).json({ error: 'Balíček lze založit jen z výdajové platby.' });

  const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?')
    .get(category_id, req.dataUserId);
  if (!cat) return res.status(404).json({ error: 'Kategorie nenalezena.' });
  if (cat.type !== 1) {
    return res.status(400).json({ error: 'Čerpání lze účtovat jen do měsíční kategorie (typ 1).' });
  }

  // `prepaid_spent` v /api/budgets se dopočítává jen k řádkům, které mají
  // výchozí budget (budgets.month='default') — bez něj by čerpání balíčku
  // nikde v rozpočtu ani teploměru neviselo (viz nález review).
  const hasDefaultBudget = db.prepare(
    "SELECT 1 FROM budgets WHERE user_id = ? AND category_id = ? AND month = 'default'"
  ).get(req.dataUserId, cat.id);
  if (!hasDefaultBudget) {
    return res.status(400).json({ error: 'Kategorie nemá nastavený měsíční rozpočet — čerpání by se nikde nezobrazilo. Nejdřív jí nastav výchozí budget.' });
  }

  const purchaseCat = db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND system_role = 'prepaid_purchase'"
  ).get(req.dataUserId);
  if (!purchaseCat) return res.status(500).json({ error: 'Chybí technická kategorie pro nákup balíčků.' });

  const existing = db.prepare('SELECT id FROM prepaid_packages WHERE transaction_id = ? AND user_id = ?')
    .get(tx.id, req.dataUserId);
  if (existing) return res.status(409).json({ error: 'Z této platby už balíček existuje.' });

  const total = Math.abs(tx.amount);
  const info = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO prepaid_packages
        (user_id, transaction_id, category_id, original_category_id, name,
         total_amount, units_total, unit_amount, valid_until, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.dataUserId, tx.id, cat.id, tx.category_id, String(name).trim(),
      total, units, unitAmount(total, units), valid_until || null, note || null);
    db.prepare('UPDATE transactions SET category_id = ? WHERE id = ? AND user_id = ?')
      .run(purchaseCat.id, tx.id, req.dataUserId);
    return r;
  })();

  const pkg = db.prepare('SELECT * FROM prepaid_packages WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(withSummary(pkg, null));
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function loadPackage(id, userId) {
  return db.prepare('SELECT * FROM prepaid_packages WHERE id = ? AND user_id = ?').get(id, userId);
}

// POST /api/prepaid/:id/draws — odtiknutí jedné (nebo více) jednotek
router.post('/:id/draws', requireAuth, writeLimiter, (req, res) => {
  const pkg = loadPackage(req.params.id, req.dataUserId);
  if (!pkg) return res.status(404).json({ error: 'Balíček nenalezen.' });
  if (pkg.status === 'closed') return res.status(400).json({ error: 'Balíček je uzavřený.' });

  const units = req.body.units == null ? 1 : parseFloat(req.body.units);
  if (!(units > 0)) return res.status(400).json({ error: 'Počet jednotek musí být kladné číslo.' });

  const date = req.body.date || todayISO();
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'Datum musí být ve formátu RRRR-MM-DD.' });

  const existing = db.prepare('SELECT * FROM prepaid_draws WHERE package_id = ? AND user_id = ?')
    .all(pkg.id, req.dataUserId);
  const summary = packageSummary(pkg, existing);
  if (units > summary.remaining_units) {
    return res.status(400).json({ error: `V balíčku zbývá jen ${summary.remaining_units} jednotek.` });
  }

  db.prepare(`
    INSERT INTO prepaid_draws (user_id, package_id, date, units, amount, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.dataUserId, pkg.id, date, units, drawAmount(pkg.unit_amount, units), req.body.note || null);

  res.status(201).json(withSummary(loadPackage(pkg.id, req.dataUserId), null));
});

// DELETE /api/prepaid/draws/:id — oprava omylem zapsaného čerpání
// Vrací aktuální stav balíčku (ne jen {ok:true}) — díky tomu má odpověď `.id`,
// takže ji klient (PrepaidPackageCard.call) předá do onChanged() jako platný
// balíček a nespletě si "smazáno čerpání" se "smazán balíček" (to hlásí jen
// DELETE /api/prepaid/:id, jehož odpověď {ok:true} žádné `.id` nemá).
router.delete('/draws/:id', requireAuth, writeLimiter, (req, res) => {
  const row = db.prepare('SELECT * FROM prepaid_draws WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.dataUserId);
  if (!row) return res.status(404).json({ error: 'Čerpání nenalezeno.' });
  db.prepare('DELETE FROM prepaid_draws WHERE id = ?').run(row.id);
  res.json(withSummary(loadPackage(row.package_id, req.dataUserId), null));
});

// POST /api/prepaid/:id/close — uzavření balíčku, volitelně s doúčtováním zbytku
router.post('/:id/close', requireAuth, writeLimiter, (req, res) => {
  const pkg = loadPackage(req.params.id, req.dataUserId);
  if (!pkg) return res.status(404).json({ error: 'Balíček nenalezen.' });

  const draws = db.prepare('SELECT * FROM prepaid_draws WHERE package_id = ? AND user_id = ?')
    .all(pkg.id, req.dataUserId);
  const rest = writeOffAmount(pkg, draws);
  const summary = packageSummary(pkg, draws);

  db.transaction(() => {
    // Práh 0,005 Kč: na plně vyčerpaném balíčku s nedělitelnou cenou jednotky
    // (např. 1000 / 3) zbyde po SUM(amount) floating-point smetí typu 1e-14 —
    // bez prahu by vzniklo fantomové čerpání "0× 0 Kč" v historii.
    if (req.body.write_off && rest > 0.005) {
      db.prepare(`
        INSERT INTO prepaid_draws (user_id, package_id, date, units, amount, note)
        VALUES (?, ?, ?, ?, ?, 'Doúčtování zbytku při uzavření')
      `).run(req.dataUserId, pkg.id, todayISO(), summary.remaining_units, rest);
    }
    db.prepare("UPDATE prepaid_packages SET status = 'closed', closed_at = datetime('now') WHERE id = ?")
      .run(pkg.id);
  })();

  res.json(withSummary(loadPackage(pkg.id, req.dataUserId), null));
});

// DELETE /api/prepaid/:id — zrušení balíčku; transakce se vrátí do původní kategorie
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const pkg = loadPackage(req.params.id, req.dataUserId);
  if (!pkg) return res.status(404).json({ error: 'Balíček nenalezen.' });

  db.transaction(() => {
    if (pkg.transaction_id) {
      db.prepare('UPDATE transactions SET category_id = ? WHERE id = ? AND user_id = ?')
        .run(pkg.original_category_id, pkg.transaction_id, req.dataUserId);
    }
    db.prepare('DELETE FROM prepaid_packages WHERE id = ?').run(pkg.id);
  })();

  res.json({ ok: true });
});

module.exports = router;
