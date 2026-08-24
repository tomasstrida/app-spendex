const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { findDuplicates, wouldEmptyDuplicateGroup } = require('../utils/duplicates');
const { ownsSubcategory } = require('../utils/subcategory-ownership');
const { SPENDING_AND } = require('../utils/spending-filter');
const { APPLE_MERCHANT_SQL } = require('../utils/apple-candidates');
const { buildAccountNameMap, placeDisplayText } = require('../utils/place-display');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

// Sdílené sestavení WHERE podmínek z query filtrů (bez SELECT/ORDER/LIMIT).
// Používá GET / (stránkovaný seznam) i GET /export (CSV bez limitu), aby export
// respektoval přesně stejné filtry jako to, co uživatel vidí v seznamu.
// Vrací { where, params }; `where` začíná ' AND …' (nebo je prázdné).
function buildTxWhere(query) {
  const { from, to, category_id, category_ids, subcategory_id, amount_min, amount_max, q, counterparty, direction, apple_account, apple_merchant } = query;
  let where = '';
  const params = [];

  if (from) { where += ' AND t.date >= ?'; params.push(from); }
  if (to)   { where += ' AND t.date <= ?'; params.push(to); }
  if (direction === 'in')  where += ' AND t.amount > 0';
  if (direction === 'out') where += ' AND t.amount < 0';

  // Zdroj / Cíl podle účtu domácnosti. Zrcadlí client/src/utils/accountFlow.js:
  // u ODCHOZÍ platby je zdrojem náš účet a cílem protistrana, u PŘÍCHOZÍ se
  // strany otočí. Díky tomu „zdroj = Společný" najde i převod na jiný můj účet.
  // Protiúčet se porovnává bez mezer (v transactions jsou syrové hodnoty typu
  // '705-77628031 / 0710') — zrcadlí utils/normalize-account.js, který také
  // odstraňuje jen whitespace. Číslo účtu se dotahuje korelovaným poddotazem
  // scopovaným na t.user_id, takže cizí account_id nikdy nic nevrátí.
  const CP_NORM = "REPLACE(REPLACE(t.counterparty_account, ' ', ''), CHAR(9), '')";
  const ACC_NUM = "(SELECT REPLACE(REPLACE(a2.account_number, ' ', ''), CHAR(9), '') FROM accounts a2 WHERE a2.id = ? AND a2.user_id = t.user_id)";
  const flowAccountId = (raw) => {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  const srcId = flowAccountId(query.source_account_id);
  if (srcId !== null) {
    where += ` AND ((t.amount < 0 AND t.account_id = ?) OR (t.amount >= 0 AND ${CP_NORM} = ${ACC_NUM}))`;
    params.push(srcId, srcId);
  }
  const tgtId = flowAccountId(query.target_account_id);
  if (tgtId !== null) {
    where += ` AND ((t.amount >= 0 AND t.account_id = ?) OR (t.amount < 0 AND ${CP_NORM} = ${ACC_NUM}))`;
    params.push(tgtId, tgtId);
  }

  // Přesný filtr: protistrana začíná zadaným číslem účtu (např. „1679014082"
  // matchne „1679014082/3030"). Užívá Schůzka pro klik na „Skutečně naspořeno".
  if (counterparty !== undefined && String(counterparty).trim() !== '') {
    where += ' AND t.counterparty_account LIKE ? || \'%\'';
    params.push(String(counterparty).trim());
  }

  // spending_only=1 → jen výdaje domácnosti (fáze A: spending + NULL účet +
  // reálná kategorie na ignorovaném účtu). Stejný fragment jako stats/budgets,
  // aby proklik ze Schůzky seděl s čísly.
  if (query.spending_only === '1') {
    where += SPENDING_AND;
  }

  // tx_ids=1,2,3 → přesně vyjmenované transakce. Pro prokliky ze Schůzky u
  // agregátů, jejichž příslušnost počítá JS a nedá se vyjádřit filtrem (matcher
  // fixních plateb přes text i číslo účtu, seskupování příjmů podle protistrany
  // × cílového účtu). Odkaz je pak exaktní, ne přibližný. Izolaci uživatele drží
  // `WHERE t.user_id = ?` volajícího — tady se jen zužuje množina.
  if (query.tx_ids !== undefined && String(query.tx_ids).trim() !== '') {
    const ids = String(query.tx_ids).split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n));
    if (ids.length > 0) {
      where += ` AND t.id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
  }

  // off_fund=1 → jen transakce, které NEJSOU na fondovém účtu (accounts.is_fund).
  // Užívá Schůzka pro klik na „Roční výdaje mimo fond". Transakce bez účtu
  // (account_id IS NULL) projdou — NOT EXISTS je na NULL id pravdivé.
  if (query.off_fund === '1') {
    where += ` AND NOT EXISTS (
      SELECT 1 FROM accounts ofa WHERE ofa.id = t.account_id AND ofa.is_fund = 1
    )`;
  }

  // match_patterns=A,B,C → pattern LIKE přes description/note/place (stejná
  // sémantika jako matcher fixních plateb). Užívá Schůzka pro klik na „Fixní platby".
  if (query.match_patterns !== undefined && String(query.match_patterns).trim() !== '') {
    const patterns = String(query.match_patterns)
      .split(',').map(s => s.trim()).filter(Boolean);
    if (patterns.length > 0) {
      const ors = patterns.map(() =>
        '(t.description LIKE ? OR t.note LIKE ? OR t.place LIKE ?)'
      ).join(' OR ');
      where += ` AND (${ors})`;
      for (const p of patterns) params.push(`%${p}%`, `%${p}%`, `%${p}%`);
    }
  }

  // Full-text vyhledávání napříč textovými poli (vč. názvu kategorie a subkategorie).
  // POZOR: aliasy `c` a `sc` musí být v každém dotazu, který buildTxWhere používá
  // (GET / i /export je oba joinují) — jinak by SQL spadlo na neznámém aliasu.
  if (q !== undefined && String(q).trim() !== '') {
    // necitlivé na velikost písmen i diakritiku (unaccent_lower – viz db/connection.js)
    const like = `%${String(q).trim()}%`;
    where += ` AND (
      unaccent_lower(t.description) LIKE unaccent_lower(?) OR unaccent_lower(t.note) LIKE unaccent_lower(?) OR unaccent_lower(t.place) LIKE unaccent_lower(?)
      OR unaccent_lower(t.counterparty_account) LIKE unaccent_lower(?) OR unaccent_lower(t.ab_category) LIKE unaccent_lower(?)
      OR unaccent_lower(t.tx_type) LIKE unaccent_lower(?) OR unaccent_lower(t.entered_by) LIKE unaccent_lower(?) OR unaccent_lower(t.external_id) LIKE unaccent_lower(?)
      OR unaccent_lower(c.name) LIKE unaccent_lower(?) OR unaccent_lower(sc.name) LIKE unaccent_lower(?)
    )`;
    for (let i = 0; i < 10; i++) params.push(like);
  }

  if (category_ids) {
    const ids = String(category_ids).split(',').map(s => s.trim()).filter(Boolean);
    const hasNone = ids.includes('none');
    const numericIds = ids
      .filter(id => id !== 'none')
      .map(id => parseInt(id))
      .filter(n => Number.isFinite(n));
    const conditions = [];
    if (hasNone) conditions.push('t.category_id IS NULL');
    if (numericIds.length > 0) {
      const placeholders = numericIds.map(() => '?').join(',');
      conditions.push(`t.category_id IN (${placeholders})`);
      params.push(...numericIds);
    }
    if (conditions.length > 0) {
      where += ` AND (${conditions.join(' OR ')})`;
    }
  } else if (category_id === 'none') {
    where += ' AND t.category_id IS NULL';
  } else if (category_id) {
    where += ' AND t.category_id = ?';
    params.push(category_id);
  }

  if (subcategory_id !== undefined && String(subcategory_id).trim() !== '') {
    const v = parseInt(subcategory_id, 10);
    if (Number.isFinite(v)) { where += ' AND t.subcategory_id = ?'; params.push(v); }
  }

  // Filtr podle Apple účtu z faktury. Účet žije na apple_receipts, ne na transakci —
  // proto EXISTS poddotaz, ne JOIN: join by při víc fakturách zduplikoval řádky
  // a rozbil stránkování.
  // `none` = transakce bez spárované faktury S ÚČTEM. Musí to sedět na dopočítaný
  // řádek „bez faktury" v rozpadu, do kterého spadají i faktury bez rozpoznaného účtu.
  if (apple_account !== undefined && String(apple_account).trim() !== '') {
    const val = String(apple_account).trim();
    const linked = `SELECT 1 FROM apple_receipts ar
      WHERE ar.transaction_id = t.id AND ar.user_id = t.user_id
        AND ar.status = 'matched' AND ar.apple_account IS NOT NULL`;
    if (val.toLowerCase() === 'none') {
      where += ` AND NOT EXISTS (${linked})`;
    } else {
      where += ` AND EXISTS (${linked} AND LOWER(ar.apple_account) = LOWER(?))`;
      params.push(val);
    }
  }

  // apple_merchant=1 → stejný prefix predikát jako agregát „Apple bez faktury"
  // v routes/budget-items.js (přes APPLE_MERCHANT_SQL). Záměrně PREFIX, ne
  // substring jako obecné `q` — jinak proklik ukáže víc transakcí, než kolik
  // sečetl agregát (viz feedback_link_aggregate_parity).
  if (apple_merchant === '1') {
    where += ` AND ${APPLE_MERCHANT_SQL}`;
  }

  if (amount_min !== undefined && amount_min !== '') {
    const v = parseFloat(amount_min);
    if (Number.isFinite(v)) { where += ' AND ABS(t.amount) >= ?'; params.push(v); }
  }
  if (amount_max !== undefined && amount_max !== '') {
    const v = parseFloat(amount_max);
    if (Number.isFinite(v)) { where += ' AND ABS(t.amount) <= ?'; params.push(v); }
  }

  return { where, params };
}

// GET /api/transactions?from=...&to=...&category_id=&category_ids=1,2,none&amount_min=&amount_max=&counterparty=&limit=&offset=
router.get('/', requireAuth, (req, res) => {
  const { limit = 200, offset = 0 } = req.query;
  const { where, params } = buildTxWhere(req.query);
  // LEFT JOIN na prepaid_packages přes indexovaný transaction_id — vrací jen
  // id balíčku (žádné další sloupce), ať frontend může u zdrojové platby
  // zobrazit odznak (viz PATCH blokace přeřazení kategorie o pár řádků výš
  // v tomto souboru). Cena je jedno levé spojení s rovností na indexovaném
  // sloupci, seznam se tím prakticky nezpomalí.
  const query = `SELECT t.*, c.name as category_name, c.color as category_color, sc.name as subcategory_name,
      pp.id as prepaid_package_id
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN subcategories sc ON t.subcategory_id = sc.id AND sc.user_id = t.user_id
    LEFT JOIN prepaid_packages pp ON pp.transaction_id = t.id AND pp.user_id = t.user_id
    WHERE t.user_id = ?${where}
    ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(query).all(req.dataUserId, ...params, Number(limit), Number(offset));
  res.json(rows);
});

// GET /api/transactions/ids?... — jen ID celé vyfiltrované sady (stejné filtry
// jako GET /, bez limitu a offsetu). Slouží hromadným akcím: klient si díky tomu
// může označit i to, co ještě nemá načtené, a zná přesný počet (GET / vrací jen
// stránku, takže z něj celkový počet nejde poznat).
// Musí být PŘED parametrickými routami.
router.get('/ids', requireAuth, (req, res) => {
  const { where, params } = buildTxWhere(req.query);
  // Aliasy c a sc jsou povinné — fulltextový filtr `q` v buildTxWhere sahá i na
  // názvy kategorie a subkategorie (viz varování u buildTxWhere).
  const rows = db.prepare(`SELECT t.id
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN subcategories sc ON t.subcategory_id = sc.id AND sc.user_id = t.user_id
    WHERE t.user_id = ?${where}
    ORDER BY t.date DESC, t.id DESC`).all(req.dataUserId, ...params);
  const ids = rows.map(r => r.id);
  res.json({ ids, total: ids.length });
});

// GET /api/transactions/export?... — CSV export (stejné filtry jako GET /, bez limitu).
// Musí být PŘED parametrickými routami. Oddělovač ';' + UTF-8 BOM kvůli českému Excelu.
router.get('/export', requireAuth, (req, res) => {
  const { where, params } = buildTxWhere(req.query);
  const query = `SELECT t.*, c.name as category_name, sc.name as subcategory_name, a.name as account_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN subcategories sc ON t.subcategory_id = sc.id AND sc.user_id = t.user_id
    LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
    WHERE t.user_id = ?${where}
    ORDER BY t.date DESC, t.id DESC`;
  const rows = db.prepare(query).all(req.dataUserId, ...params);

  // Mapa vlastních účtů se načítá zvlášť — druhý JOIN na accounts.account_number
  // by při duplicitním čísle rozmnožil řádky exportu.
  const accountRows = db.prepare('SELECT account_number, name FROM accounts WHERE user_id = ?').all(req.dataUserId);
  const cpNameMap = buildAccountNameMap(accountRows);

  const cols = [
    ['Datum', r => r.date],
    ['Čas', r => r.tx_time],
    ['Popis', r => r.description],
    ['Obchodní místo', r => placeDisplayText(r, cpNameMap)],
    ['Kategorie', r => r.category_name],
    ['Subkategorie', r => r.subcategory_name],
    ['Částka', r => (r.amount == null ? '' : String(r.amount).replace('.', ','))],
    ['Měna', r => r.currency],
    ['Účet', r => r.account_name],
    ['Protistrana', r => r.counterparty_account],
    ['Variabilní symbol', r => r.variable_symbol],
    ['Poznámka', r => r.note],
    ['Typ', r => r.tx_type],
    ['Karta', r => r.card_last4],
    ['Zdroj', r => r.source],
  ];
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = cols.map(c => c[0]).join(';');
  const lines = rows.map(r => cols.map(([, get]) => esc(get(r))).join(';'));
  const csv = '\uFEFF' + [header, ...lines].join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="transakce.csv"');
  res.send(csv);
});

// GET /api/transactions/duplicates
router.get('/duplicates', requireAuth, (req, res) => {
  res.json(findDuplicates(db, req.dataUserId));
});

// POST /api/transactions/duplicates/dismiss  body: { ids: [...] }
// Označí skupinu jako „nejsou duplicity" — už se nebude zobrazovat.
router.post('/duplicates/dismiss', requireAuth, writeLimiter, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length < 2) {
    return res.status(400).json({ error: 'Očekávám alespoň 2 ID transakcí.' });
  }
  const ph = ids.map(() => '?').join(',');
  const owned = db.prepare(`SELECT id FROM transactions WHERE user_id = ? AND id IN (${ph})`)
    .all(req.dataUserId, ...ids);
  if (owned.length !== ids.length) {
    return res.status(400).json({ error: 'Některá transakce nepatří uživateli.' });
  }
  const sig = ids.map(Number).sort((a, b) => a - b).join(',');
  db.prepare('INSERT OR IGNORE INTO duplicate_dismissals (user_id, tx_ids) VALUES (?, ?)')
    .run(req.dataUserId, sig);
  res.json({ ok: true });
});

// POST /api/transactions
router.post('/', requireAuth, writeLimiter, (req, res) => {
  const { amount, currency, date, description, note, category_id } = req.body;
  const amt = Number(amount);
  if (!Number.isFinite(amt)) return res.status(400).json({ error: 'Částka musí být číslo.' });
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Datum musí být ve formátu YYYY-MM-DD.' });
  if (category_id != null) {
    const owned = db.prepare('SELECT 1 FROM categories WHERE id = ? AND user_id = ?').get(category_id, req.dataUserId);
    if (!owned) return res.status(400).json({ error: 'Neplatná kategorie.' });
  }
  const cur = (currency && String(currency).slice(0, 8)) || 'CZK';
  const desc = description != null ? String(description).slice(0, 500) : '';
  const nt = note != null ? String(note).slice(0, 500) : '';
  const result = db.prepare(
    'INSERT INTO transactions (user_id, category_id, amount, currency, date, description, note, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.dataUserId, category_id || null, amt, cur, date, desc, nt, 'manual');
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

// PATCH /api/transactions/:id
// PATCH /api/transactions/bulk-category  body: { ids: [...], category_id }
// Hromadné přeřazení kategorie u vybraných transakcí. Musí být PŘED PATCH /:id,
// jinak by parametrická routa pohltila i tuhle cestu.
router.patch('/bulk-category', requireAuth, writeLimiter, (req, res) => {
  const { ids, category_id } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Neplatná data.' });
  if (category_id === undefined || category_id === null) return res.status(400).json({ error: 'Chybí kategorie.' });

  const catOwned = db.prepare('SELECT 1 FROM categories WHERE id = ? AND user_id = ?').get(category_id, req.dataUserId);
  if (!catOwned) return res.status(400).json({ error: 'Neplatná kategorie.' });

  const ph = ids.map(() => '?').join(',');
  const owned = db.prepare(`SELECT id FROM transactions WHERE user_id = ? AND id IN (${ph})`)
    .all(req.dataUserId, ...ids);
  if (owned.length !== ids.length) {
    return res.status(400).json({ error: 'Některá transakce nepatří uživateli.' });
  }

  // Zdrojové platby předplacených balíčků se přeskakují, ne odmítají — jinak by
  // jedna zamčená platba ve výběru shodila celou hromadnou akci. Důvod blokace
  // je stejný jako u PATCH /:id (dvojí započtení čerpání do rozpočtu).
  const locked = new Set(
    db.prepare(`SELECT transaction_id FROM prepaid_packages
                WHERE user_id = ? AND transaction_id IN (${ph})`)
      .all(req.dataUserId, ...ids).map(r => r.transaction_id)
  );
  const target = owned.map(r => r.id).filter(id => !locked.has(id));
  if (target.length === 0) return res.json({ updated: 0, skipped_prepaid: locked.size });

  // Subkategorie se nuluje — patřila pod starou kategorii. Stejně to dělá
  // inline editace v seznamu i Revize zařazení.
  const tph = target.map(() => '?').join(',');
  const result = db.prepare(`UPDATE transactions SET category_id = ?, subcategory_id = NULL
     WHERE user_id = ? AND id IN (${tph})`).run(category_id, req.dataUserId, ...target);

  res.json({ updated: result.changes, skipped_prepaid: locked.size });
});

router.patch('/:id', requireAuth, writeLimiter, (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!tx) return res.status(404).json({ error: 'Transakce nenalezena.' });
  const { amount, currency, date, description, note, category_id, subcategory_id } = req.body;
  if (amount !== undefined && !Number.isFinite(Number(amount))) return res.status(400).json({ error: 'Částka musí být číslo.' });
  if (date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) return res.status(400).json({ error: 'Datum musí být ve formátu YYYY-MM-DD.' });
  if (category_id !== undefined && category_id !== null) {
    const owned = db.prepare('SELECT 1 FROM categories WHERE id = ? AND user_id = ?').get(category_id, req.dataUserId);
    if (!owned) return res.status(400).json({ error: 'Neplatná kategorie.' });
  }

  // Zdrojová platba předplaceného balíčku sedí v technické kategorii
  // (prepaid_purchase); čerpání se počítá zvlášť do budgetu cílové kategorie
  // (viz budget_spent v /api/budgets). Přeřazení zpět by tu částku sečetlo
  // s čerpáním podruhé (dvojí započtení v teploměru) — a i přeřazení na null
  // by tichem vytratilo nákup z bilance Schůzky. Platí bez ohledu na status
  // balíčku — i uzavřený balíček dál nese svá čerpání do rozpočtu.
  // (Number(null) === 0, takže se pokus o vynulování kategorie chytí taky.)
  if (category_id !== undefined && Number(category_id) !== tx.category_id) {
    const pkg = db.prepare('SELECT id FROM prepaid_packages WHERE transaction_id = ? AND user_id = ?')
      .get(tx.id, req.dataUserId);
    if (pkg) {
      return res.status(400).json({
        error: 'Tato platba patří k předplacenému balíčku. Kategorii změníš zrušením balíčku (stránka Předplacené).',
      });
    }
  }

  // subcategory_id: '' / undefined / null → null; jinak celé číslo, ověřené proti
  // vlastníkovi A výsledné (effective) kategorii transakce — viz ownsSubcategory.
  let subId = tx.subcategory_id;
  if (subcategory_id !== undefined) {
    if (subcategory_id === null || String(subcategory_id).trim() === '') {
      subId = null;
    } else {
      const parsed = parseInt(subcategory_id, 10);
      if (!Number.isFinite(parsed)) return res.status(400).json({ error: 'Neplatná subkategorie pro tuto kategorii.' });
      subId = parsed;
    }
  }
  // Validaci vlastnictví subcategory_id spouštíme JEN když klient v požadavku
  // skutečně mění subcategory_id nebo category_id. Jinak by editace jiného pole
  // (např. note) na starší transakci s už nekonzistentním subcategory_id skončila
  // 400 a řádek by se nedal editovat vůbec (viz re-review regrese).
  if (subId != null && (subcategory_id !== undefined || category_id !== undefined)) {
    const effectiveCategoryId = category_id !== undefined ? parseInt(category_id) : tx.category_id;
    if (!ownsSubcategory(db, req.dataUserId, subId, effectiveCategoryId)) {
      return res.status(400).json({ error: 'Neplatná subkategorie pro tuto kategorii.' });
    }
  }

  db.prepare(
    'UPDATE transactions SET amount = ?, currency = ?, date = ?, description = ?, note = ?, category_id = ?, subcategory_id = ? WHERE id = ?'
  ).run(
    amount !== undefined ? Number(amount) : tx.amount,
    currency !== undefined ? String(currency).slice(0, 8) : tx.currency,
    date ?? tx.date,
    description !== undefined ? String(description).slice(0, 500) : tx.description,
    note !== undefined ? String(note).slice(0, 500) : tx.note,
    category_id !== undefined ? category_id : tx.category_id,
    subId,
    tx.id
  );
  // prepaid_package_id v odpovědi drží klientský stav konzistentní s GET / —
  // jinak by po prostém uložení poznámky odznak balíčku ze seznamu zmizel
  // (klient si tělo PATCH spread-uje do řádku, viz TransactionsPage.jsx).
  res.json(db.prepare(`
    SELECT t.*, pp.id as prepaid_package_id
    FROM transactions t
    LEFT JOIN prepaid_packages pp ON pp.transaction_id = t.id AND pp.user_id = t.user_id
    WHERE t.id = ?
  `).get(tx.id));
});

// DELETE /api/transactions/:id
router.delete('/:id', requireAuth, writeLimiter, (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.dataUserId);
  if (!tx) return res.status(404).json({ error: 'Transakce nenalezena.' });
  db.prepare('DELETE FROM transactions WHERE id = ?').run(tx.id);
  res.json({ ok: true });
});

// DELETE /api/transactions  body: { ids: [1,2,3], guardDuplicateGroups?: true }
router.delete('/', requireAuth, writeLimiter, (req, res) => {
  const { ids, guardDuplicateGroups } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Neplatná data.' });
  if (guardDuplicateGroups && wouldEmptyDuplicateGroup(db, req.dataUserId, ids)) {
    return res.status(400).json({ error: 'Ve skupině duplicit musí zůstat alespoň jedna transakce.' });
  }
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(
    `DELETE FROM transactions WHERE id IN (${placeholders}) AND user_id = ?`
  ).run(...ids, req.dataUserId);
  res.json({ deleted: result.changes });
});

module.exports = router;
