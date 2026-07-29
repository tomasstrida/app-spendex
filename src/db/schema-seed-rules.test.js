'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

/**
 * Vrátí čistou DB (nový tmp soubor) s proběhlým initSchema(), ale BEZ jakýchkoliv uživatelů.
 * require cache je vymazána, takže connection.js i schema.js jsou načteny znovu proti novému DB_PATH.
 */
function freshDb() {
  const tmp = path.join(os.tmpdir(), `spendex-ssr-${Date.now()}-${Math.random()}.db`);
  process.env.DB_PATH = tmp;
  for (const m of ['./connection', './schema']) {
    try { delete require.cache[require.resolve(m)]; } catch { /* nenalezeno v cache */ }
  }
  const db = require('./connection');
  require('./schema').initSchema();
  return db;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: uživatel s kategorií odpovídající seed názvu dostane pravidla
// ─────────────────────────────────────────────────────────────────────────────
test('seed: uživatel s kategorií Sport dostane pravidla vč. amount_max_abs', () => {
  const db = freshDb();
  const { initSchema } = require('./schema');

  // Žádný uživatel → první initSchema() neosívala nikoho. Vložíme uživatele + kategorie.
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'test@x.cz')").run();

  // Sport — z textOverrides: { pattern: 'MAX FITNESS', category: 'Sport' }
  db.prepare("INSERT INTO categories (user_id, name) VALUES (1, 'Sport')").run();

  // Restaurace a kávičky — z textOverrides: benzinkové patterny s amount_max_abs: 200
  db.prepare("INSERT INTO categories (user_id, name) VALUES (1, 'Restaurace a kávičky')").run();

  // Druhý init — seed block poběží pro uživatele 1 (stále nemá žádná pravidla)
  initSchema();

  const rules = db.prepare(
    `SELECT cr.pattern, cr.amount_max_abs, c.name AS category
     FROM category_rules cr
     JOIN categories c ON c.id = cr.category_id
     WHERE cr.user_id = 1`
  ).all();

  // Musí existovat alespoň pravidlo pro Sport
  const sportRule = rules.find(r => r.pattern === 'MAX FITNESS' && r.category === 'Sport');
  assert.ok(sportRule, 'Pravidlo MAX FITNESS → Sport musí být oseto');

  // Benzinková pravidla musí nést amount_max_abs = 200
  const shellRule = rules.find(r => r.pattern === 'SHELL' && r.category === 'Restaurace a kávičky');
  assert.ok(shellRule, 'Pravidlo SHELL → Restaurace a kávičky musí být oseto');
  assert.equal(shellRule.amount_max_abs, 200, 'SHELL pravidlo musí mít amount_max_abs = 200');

  const olvRule = rules.find(r => r.pattern === 'OMV');
  assert.ok(olvRule, 'Pravidlo OMV musí být oseto');
  assert.equal(olvRule.amount_max_abs, 200, 'OMV pravidlo musí mít amount_max_abs = 200');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: pravidla kategorií, které uživatel NEMÁ, se přeskočí
// ─────────────────────────────────────────────────────────────────────────────
test('seed: kategorie bez shody = žádná pravidla pro danou kategorii', () => {
  const db = freshDb();
  const { initSchema } = require('./schema');

  // Uživatel má pouze kategorii 'Ostatní' — seed nemá žádné textOverrides pro 'Ostatní'
  // (jen abCategoryMap), takže z textOverrides by měla být 0 pravidel.
  db.prepare("INSERT INTO users (id, email) VALUES (1, 'noshared@x.cz')").run();
  db.prepare("INSERT INTO categories (user_id, name) VALUES (1, 'Ostatní')").run();

  initSchema();

  const count = db.prepare(
    'SELECT COUNT(*) AS n FROM category_rules WHERE user_id = 1'
  ).get().n;

  // textOverrides neobsahuje kategorii 'Ostatní' → žádné pravidlo nemá být oseto
  assert.equal(count, 0, 'Uživatel bez odpovídající kategorie nesmí dostat žádná pravidla');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: idempotence — dvojí initSchema() nepřidá duplicity
// ─────────────────────────────────────────────────────────────────────────────
test('seed: idempotentní — druhý initSchema() nepřidá duplicity', () => {
  const db = freshDb();
  const { initSchema } = require('./schema');

  db.prepare("INSERT INTO users (id, email) VALUES (1, 'idem@x.cz')").run();
  db.prepare("INSERT INTO categories (user_id, name) VALUES (1, 'Sport')").run();

  // První seed
  initSchema();
  const countAfterFirst = db.prepare(
    'SELECT COUNT(*) AS n FROM category_rules WHERE user_id = 1'
  ).get().n;

  assert.ok(countAfterFirst > 0, 'Po prvním seeding musí být alespoň jedno pravidlo');

  // Druhý seed — uživatel 1 UŽ pravidla má → seed ho přeskočí
  initSchema();
  const countAfterSecond = db.prepare(
    'SELECT COUNT(*) AS n FROM category_rules WHERE user_id = 1'
  ).get().n;

  assert.equal(countAfterSecond, countAfterFirst, 'Druhý initSchema() nesmí přidat duplicitní pravidla');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: doplnění nového pravidla uživateli, který už sadu pravidel má.
// Seed block běží jen pro uživatele s PRÁZDNOU sadou → nová pravidla by se
// existující instalaci nikdy nepřesypala. Proto samostatná idempotentní migrace.
// ─────────────────────────────────────────────────────────────────────────────
test('migrace: „Splátka půjčky" se doplní i uživateli, který už pravidla má', () => {
  const db = freshDb();
  const { initSchema } = require('./schema');

  db.prepare("INSERT INTO users (id, email) VALUES (1, 'loan@x.cz')").run();
  db.prepare("INSERT INTO categories (user_id, name) VALUES (1, 'Pravidelné platby')").run();
  const catId = db.prepare("SELECT id FROM categories WHERE user_id = 1").get().id;
  // Uživatel už jedno pravidlo má → seed block ho přeskočí
  db.prepare('INSERT INTO category_rules (user_id, category_id, pattern) VALUES (1, ?, ?)').run(catId, 'T-Mobile');

  initSchema();

  const rows = db.prepare("SELECT * FROM category_rules WHERE user_id = 1 AND pattern = 'Splátka půjčky'").all();
  assert.equal(rows.length, 1, 'Pravidlo Splátka půjčky musí být doplněno právě jednou');
  assert.equal(rows[0].category_id, catId);

  // Druhý běh nesmí přidat duplicitu
  initSchema();
  const after = db.prepare("SELECT COUNT(*) AS n FROM category_rules WHERE user_id = 1 AND pattern = 'Splátka půjčky'").get().n;
  assert.equal(after, 1, 'Migrace musí být idempotentní');
});
