/**
 * Import všech AirBank účtů do Spendex DB.
 * Vytvoří kategorie, AB mapování, účty a naimportuje transakce.
 *
 * Použití: node scripts/import-airbank-data.cjs
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');
const { parseAirBankCSV } = require('../src/utils/csvParser');

const DB_PATH  = process.env.DB_PATH  || path.join(__dirname, '../data.db');
const CSV_DIR  = process.env.CSV_DIR  || '/Users/tomas/AI/projekt-finance/2026-04-16_export-AirBank';
const USER_ID  = parseInt(process.env.USER_ID || '1', 10);

const db = new Database(DB_PATH);

// ── 1. Kategorie ────────────────────────────────────────────────────────────

const CATEGORIES = [
  { name: 'Nákupy - jídlo',     color: '#22c55e', icon: 'shopping-cart',  type: 1 },
  { name: 'Restaurace',         color: '#f97316', icon: 'utensils',        type: 1 },
  { name: 'Fitness & sport',    color: '#8b5cf6', icon: 'dumbbell',        type: 1 },
  { name: 'Doprava',            color: '#64748b', icon: 'car',             type: 1 },
  { name: 'Drogerie & léky',    color: '#06b6d4', icon: 'pill',            type: 1 },
  { name: 'Zdraví',             color: '#10b981', icon: 'heart',           type: 1 },
  { name: 'Osobní péče',        color: '#d97706', icon: 'scissors',        type: 1 },
  { name: 'Koučink',            color: '#6366f1', icon: 'brain',           type: 1 },
  { name: 'Licence & software', color: '#7c3aed', icon: 'monitor',         type: 1 },
  { name: 'Domácnost',          color: '#84cc16', icon: 'home',            type: 1 },
  { name: 'Zábava & kultura',   color: '#f59e0b', icon: 'music',           type: 1 },
  { name: 'Výlety & akce',      color: '#14b8a6', icon: 'map',             type: 2 },
  { name: 'Vzdělávání',         color: '#a855f7', icon: 'book',            type: 2 },
  { name: 'Elektronika',        color: '#3b82f6', icon: 'cpu',             type: 3 },
  { name: 'Ostatní',            color: '#6b7280', icon: 'tag',             type: 1 },
];

// AB kategorie → název Spendex kategorie
const AB_MAPPINGS = {
  'Nakupy Jidlo':        'Nákupy - jídlo',
  'Restaurace':          'Restaurace',
  'Zábava':              'Fitness & sport',   // MAX FITNESS dominuje
  'Sport':               'Fitness & sport',
  'Doprava':             'Doprava',
  'Lékárna':             'Drogerie & léky',
  'Zdravotní':           'Koučink',           // Mgr. Petr Hrdina = koučink/terapie
  'Služby':              'Osobní péče',       // Salon Vladimir
  'Licence Apple apod':  'Licence & software',
  'Bydlení':             'Domácnost',
  'Cizí':                'Výlety & akce',     // skupinové výdaje, chalupa
  'Podcast':             'Výlety & akce',     // Zmátlo Pavel – Silvester
  'Vzdelavani':          'Vzdělávání',
  'Nákupy':              'Ostatní',
  'Výběr hotovosti':     'Ostatní',
  'OSVC':                'Ostatní',
};

// Patterny na description transakce → název Spendex kategorie
// Porovnávají se case-insensitive, aplikují se jen na transakce bez kategorie
const DESCRIPTION_RULES = [
  // Jídlo & nákupy
  { pattern: 'ROHLIK',           category: 'Nákupy - jídlo' },
  { pattern: 'ROHLÍK',           category: 'Nákupy - jídlo' },

  // Zdraví
  { pattern: 'MUDR.',            category: 'Zdraví' },
  { pattern: 'MAIXNER',         category: 'Zdraví' },       // Mgr. Maixner – pravděpodobně terapeut/fyzio

  // Vzdělávání
  { pattern: 'GOPAY kniha',      category: 'Vzdělávání' },

  // Zábava & kultura
  { pattern: 'PIXEL GAME',       category: 'Zábava & kultura' },
  { pattern: 'MV enjoy',         category: 'Zábava & kultura' },

  // Výlety & akce (skupinové výdaje, chalupa, akce)
  { pattern: 'silvestr',         category: 'Výlety & akce' },
  { pattern: 'chatu',            category: 'Výlety & akce' },
  { pattern: 'chata',            category: 'Výlety & akce' },
  { pattern: 'Queer ball',       category: 'Výlety & akce' },
  { pattern: 'Vodáková',         category: 'Výlety & akce' },

  // Domácnost (energie, nájem)
  { pattern: 'Pražská energetika', category: 'Domácnost' },
  { pattern: 'PRE -',            category: 'Domácnost' },

  // Ostatní
  { pattern: 'Celní úřad',       category: 'Ostatní' },
  { pattern: 'Air Bank 2355',    category: 'Ostatní' },   // splátka/poplatek AB
  { pattern: 'MICHAL HORÁČEK',   category: 'Ostatní' },
  { pattern: 'Karafa',           category: 'Ostatní' },   // objednávka, nezařazeno
];

// ── 2. Účty ─────────────────────────────────────────────────────────────────

const ACCOUNTS = [
  { number: '1679014023', name: 'Společný',         role: 'spending' },
  { number: '1679014058', name: 'zz-Hromadné akce', role: 'spending' },
  { number: '1679014074', name: 'Nepravidelné',      role: 'spending' },
  { number: '1679014111', name: 'Licence',           role: 'spending' },
  { number: '1679014066', name: 'Harmonicka-najem',  role: 'fixed'    },
  { number: '1679014138', name: 'Hlavní',            role: 'ignored'  },
  { number: '1679014031', name: 'Tom-OSVC',          role: 'ignored'  },
  { number: '1679014015', name: 'Tom-AirBank',       role: 'ignored'  },
  { number: '1679014082', name: 'Spořicí-účet-1',   role: 'ignored'  },
  { number: '1679014103', name: 'Dane-doplatek',     role: 'ignored'  },
];

// CSV soubor pro každý účet
const CSV_FILES = {
  '1679014023': 'airbank_1679014023_2026-04-16_09-18.csv',
  '1679014058': 'airbank_1679014058_2026-04-16_09-19.csv',
  '1679014074': 'airbank_1679014074_2026-04-16_09-18.csv',
  '1679014111': 'airbank_1679014111_2026-04-16_09-17.csv',
  '1679014066': 'airbank_1679014066_2026-04-16_09-16.csv',
};

// ── Spuštění ─────────────────────────────────────────────────────────────────

console.log(`\n🗄  DB: ${DB_PATH}`);
console.log(`📁  CSV: ${CSV_DIR}`);
console.log(`👤  user_id: ${USER_ID}\n`);

db.transaction(() => {

  // 1. Kategorie
  console.log('── Kategorie ───────────────────────────────');
  const insertCat = db.prepare(`
    INSERT OR IGNORE INTO categories (user_id, name, color, icon, type)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const c of CATEGORIES) {
    const r = insertCat.run(USER_ID, c.name, c.color, c.icon, c.type);
    console.log(`  ${r.changes > 0 ? '✅' : '⏭ '} ${c.name}`);
  }

  // Načti id → name mapu
  const catRows = db.prepare('SELECT id, name FROM categories WHERE user_id = ?').all(USER_ID);
  const catByName = {};
  catRows.forEach(r => { catByName[r.name] = r.id; });

  // 2. AB mapování
  console.log('\n── AB mapování ─────────────────────────────');
  const upsertMapping = db.prepare(`
    INSERT INTO airbank_category_mappings (user_id, ab_category, category_id)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, ab_category) DO UPDATE SET category_id = excluded.category_id
  `);
  for (const [abCat, spendexName] of Object.entries(AB_MAPPINGS)) {
    const catId = catByName[spendexName];
    if (!catId) { console.log(`  ⚠️  Kategorie nenalezena: ${spendexName}`); continue; }
    upsertMapping.run(USER_ID, abCat, catId);
    console.log(`  ✅ "${abCat}" → ${spendexName}`);
  }

  // 3. Účty
  console.log('\n── Účty ────────────────────────────────────');
  const upsertAccount = db.prepare(`
    INSERT INTO accounts (user_id, account_number, name, role)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, account_number) DO UPDATE SET name = excluded.name, role = excluded.role
  `);
  for (const a of ACCOUNTS) {
    upsertAccount.run(USER_ID, a.number, a.name, a.role);
    console.log(`  ✅ ${a.name} (${a.role})`);
  }

  // Načti account_id mapu
  const accRows = db.prepare('SELECT id, account_number FROM accounts WHERE user_id = ?').all(USER_ID);
  const accById = {};
  accRows.forEach(r => { accById[r.account_number] = r.id; });

  // Načti aktuální AB mapování pro kategorii
  const mappingRows = db.prepare('SELECT ab_category, category_id FROM airbank_category_mappings WHERE user_id = ?').all(USER_ID);
  const abCatMap = {};
  mappingRows.forEach(r => { abCatMap[r.ab_category] = r.category_id; });

  // 4. Import transakcí (jen spending + fixed)
  console.log('\n── Import transakcí ────────────────────────');

  const insertTx = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (user_id, category_id, amount, currency, date, description, note, source, external_id,
       tx_time, tx_type, counterparty_account, entered_by, place, account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'airbank', ?, ?, ?, ?, ?, ?, ?)
  `);

  let totalImported = 0;
  let totalSkipped  = 0;

  for (const acc of ACCOUNTS) {
    if (acc.role === 'ignored') continue; // ignorované účty nepřeskakovat CSV parsing
    const csvFile = CSV_FILES[acc.number];
    if (!csvFile) continue;

    const csvPath = path.join(CSV_DIR, csvFile);
    if (!fs.existsSync(csvPath)) {
      console.log(`  ⚠️  Soubor nenalezen: ${csvFile}`);
      continue;
    }

    const text         = fs.readFileSync(csvPath, 'utf-8');
    const transactions = parseAirBankCSV(text);
    const accountId    = accById[acc.number];

    let imported = 0;
    let skipped  = 0;

    for (const t of transactions) {
      // Přeskočit příchozí platby
      if (t.direction === 'Příchozí') { skipped++; continue; }

      const categoryId = abCatMap[t.ab_category] || null;
      const result = insertTx.run(
        USER_ID, categoryId, t.amount, t.currency, t.date,
        t.description, t.note || '', t.external_id || null,
        t.tx_time || null, t.tx_type || null,
        t.counterparty_account || null, t.entered_by || null, t.place || null,
        accountId,
      );
      if (result.changes > 0) imported++;
      else skipped++;
    }

    console.log(`  ${acc.name.padEnd(22)} +${String(imported).padStart(3)} importováno, ${String(skipped).padStart(3)} přeskočeno`);
    totalImported += imported;
    totalSkipped  += skipped;
  }

  console.log(`\n  Celkem: +${totalImported} importováno, ${totalSkipped} přeskočeno`);

  // 5. Aplikuj description rules na transakce bez kategorie
  console.log('\n── Description rules ───────────────────────');
  const updateCat = db.prepare(`
    UPDATE transactions
    SET category_id = ?
    WHERE user_id = ? AND category_id IS NULL
      AND (LOWER(description) LIKE LOWER(?) OR LOWER(COALESCE(note,'')) LIKE LOWER(?))
  `);
  let ruleFixed = 0;
  for (const rule of DESCRIPTION_RULES) {
    const catId = catByName[rule.category];
    if (!catId) { console.log(`  ⚠️  Kategorie nenalezena: ${rule.category}`); continue; }
    const r = updateCat.run(catId, USER_ID, `%${rule.pattern}%`, `%${rule.pattern}%`);
    if (r.changes > 0) {
      console.log(`  ✅ "${rule.pattern}" → ${rule.category} (${r.changes} tx)`);
      ruleFixed += r.changes;
    }
  }
  // Fallback: zz-Hromadné akce bez kategorie → Výlety & akce
  const hromadneId = accById['1679014058'];
  const vyletyId   = catByName['Výlety & akce'];
  if (hromadneId && vyletyId) {
    const r = db.prepare(`
      UPDATE transactions SET category_id = ?
      WHERE user_id = ? AND category_id IS NULL AND account_id = ?
    `).run(vyletyId, USER_ID, hromadneId);
    if (r.changes > 0) {
      console.log(`  ✅ fallback zz-Hromadné akce → Výlety & akce (${r.changes} tx)`);
      ruleFixed += r.changes;
    }
  }

  console.log(`\n  Rules opraveno celkem: ${ruleFixed} transakcí`);

})();

// Ověření
const stats = db.prepare(`
  SELECT a.name as acc, a.role, COUNT(t.id) as cnt, ROUND(SUM(ABS(t.amount))) as total
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  WHERE t.user_id = ?
  GROUP BY a.id
  ORDER BY cnt DESC
`).all(USER_ID);

console.log('\n── Výsledek v DB ───────────────────────────');
stats.forEach(s => {
  console.log(`  ${s.acc.padEnd(22)} ${String(s.cnt).padStart(4)} tx, ${String(s.total).padStart(8)} Kč`);
});

const uncategorized = db.prepare(
  'SELECT COUNT(*) as n FROM transactions WHERE user_id = ? AND category_id IS NULL AND amount < 0'
).get(USER_ID);
console.log(`\n  Bez kategorie: ${uncategorized.n} transakcí`);
console.log('\n✅ Hotovo\n');
