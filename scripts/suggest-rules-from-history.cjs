'use strict';
/*
 * Navrhne textová category_rules z historie kategorizovaných transakcí.
 * Přístup A: token-prefix kandidáti + purity filtr + generalizace + dedup.
 *
 * Spuštění (dry-run, jen náhled):
 *   node scripts/suggest-rules-from-history.cjs
 * Zápis do DB (až po kontrole náhledu):
 *   CONFIRM=1 node scripts/suggest-rules-from-history.cjs
 *
 * Env: DB_PATH (./data.db), USER_ID (auto), MIN_TX (3), PURITY (0.90)
 */
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');
const MIN_TX = parseInt(process.env.MIN_TX || '3', 10);
const PURITY = parseFloat(process.env.PURITY || '0.90');
const CONFIRM = process.env.CONFIRM === '1';
const TRANSFER_CATEGORY = 'Převody'; // řeší L0, ne text

const db = new Database(DB_PATH, { readonly: !CONFIRM });

const USER_ID = parseInt(
  process.env.USER_ID ||
    db.prepare(
      `SELECT user_id FROM transactions WHERE category_id IS NOT NULL
       GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1`
    ).get()?.user_id,
  10
);
if (!USER_ID) {
  console.error('Žádný user s kategorizovanými transakcemi.');
  process.exit(1);
}

// --- načtení dat ---------------------------------------------------------
const catName = new Map(
  db.prepare('SELECT id, name FROM categories WHERE user_id = ?').all(USER_ID)
    .map((c) => [c.id, c.name])
);
const transferCatId = [...catName.entries()].find(([, n]) => n === TRANSFER_CATEGORY)?.[0];

const txs = db.prepare(
  `SELECT description, category_id FROM transactions
   WHERE user_id = ? AND category_id IS NOT NULL`
).all(USER_ID);

const existing = db.prepare(
  'SELECT pattern, category_id FROM category_rules WHERE user_id = ?'
).all(USER_ID);

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const lc = (s) => norm(s).toLowerCase();

// Generické fragmenty z účtenek — ne obchodník, matchovaly by cokoliv.
const NOISE = /děkuj|dekuj|za n[áa]kup|d[ěe]kujeme/i;
const incomeCatId = [...catName.entries()].find(([, n]) => n === 'Příjmy')?.[0];

// --- generování kandidátů (první 1–3 slova z description) ----------------
const candidates = new Set();
for (const t of txs) {
  const words = norm(t.description).split(' ').filter(Boolean);
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    const cand = words.slice(0, n).join(' ');
    if (cand.length >= 3) candidates.add(cand); // ignoruj příliš krátké
  }
}

// --- skórování kandidáta: coverage + rozložení kategorií -----------------
function score(cand) {
  const needle = cand.toLowerCase();
  const dist = new Map();
  let total = 0;
  for (const t of txs) {
    if (!lc(t.description).includes(needle)) continue;
    total++;
    dist.set(t.category_id, (dist.get(t.category_id) || 0) + 1);
  }
  let topCat = null, topN = 0;
  for (const [cat, n] of dist) if (n > topN) { topN = n; topCat = cat; }
  return { coverage: total, topCat, topN, purity: total ? topN / total : 0 };
}

let suggestions = [];
for (const cand of candidates) {
  if (NOISE.test(cand)) continue; // šumový fragment z účtenky
  const s = score(cand);
  if (s.coverage < MIN_TX || s.purity < PURITY) continue;
  if (s.topCat === transferCatId) continue; // interní převody řeší L0
  suggestions.push({ pattern: cand, ...s });
}

// --- generalizace: drop delší pattern, když ho pokrývá obecnější se stejnou kat.
suggestions.sort((a, b) => a.pattern.length - b.pattern.length);
const kept = [];
for (const s of suggestions) {
  const covered = kept.some(
    (k) => k.topCat === s.topCat && s.pattern.toLowerCase().includes(k.pattern.toLowerCase())
  );
  if (!covered) kept.push(s);
}

// --- dedup proti existujícím pravidlům (substring v obou směrech) --------
function coveredByExisting(pattern) {
  const p = pattern.toLowerCase();
  return existing.some((e) => {
    const ep = lc(e.pattern);
    return ep && (p.includes(ep) || ep.includes(p));
  });
}
let final = kept
  .filter((s) => !coveredByExisting(s.pattern))
  .sort((a, b) => b.coverage - a.coverage);

// --- flagování rizik -----------------------------------------------------
// Kolize: dva návrhy sdílí slovo, ale různá kategorie (např. HAMR → Restaurace vs Zábava).
const wordsOf = (p) => new Set(lc(p).split(' ').filter((w) => w.length >= 3));
for (const s of final) {
  s.risks = [];
  if (s.purity < 1) s.risks.push(`purity ${(s.purity * 100).toFixed(0)}% (${s.coverage - s.topN} jinam)`);
  if (s.topCat === incomeCatId) s.risks.push('příjem – řeší income model');
  // Krátký/generický: pattern má po odstranění mezer ≤ 4 znaky (značky i iniciály
  // typu „M F" → substring riskantní). Necháváme na ruční kontrolu.
  if (s.pattern.replace(/\s+/g, '').length <= 4) s.risks.push('krátký/generický pattern');
  for (const o of final) {
    if (o === s || o.topCat === s.topCat) continue;
    const shared = [...wordsOf(s.pattern)].some((w) => wordsOf(o.pattern).has(w));
    if (shared) { s.risks.push(`kolize s „${o.pattern}" → ${catName.get(o.topCat)}`); break; }
  }
}
const solid = final.filter((s) => s.risks.length === 0);
const review = final.filter((s) => s.risks.length > 0);

// --- náhled --------------------------------------------------------------
const row = (s) =>
  `  ${s.pattern.padEnd(28)} → ${(catName.get(s.topCat) || '?').padEnd(24)} ${String(s.topN).padStart(3)} tx` +
  (s.risks.length ? `   ⚠ ${s.risks.join('; ')}` : '');

console.log(`\nDB: ${DB_PATH}  user_id=${USER_ID}  tx=${txs.length}  existing rules=${existing.length}`);
console.log(`Práh: min ${MIN_TX} tx, purity ≥ ${(PURITY * 100).toFixed(0)} %`);

console.log(`\n=== SOLIDNÍ (${solid.length}) — bez rizik, doporučeno zapsat ===\n`);
solid.forEach((s) => console.log(row(s)));

console.log(`\n=== KE KONTROLE (${review.length}) — rozhodni ručně ===\n`);
review.forEach((s) => console.log(row(s)));

// --- zápis ---------------------------------------------------------------
// SCOPE=solid (default) zapíše jen bezrizikové; SCOPE=all i skupinu ke kontrole.
// INCLUDE="Lidl,Bolt" přibere konkrétní patterny ze skupiny ke kontrole.
const SCOPE = (process.env.SCOPE || 'solid').toLowerCase();
const include = (process.env.INCLUDE || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const toWrite = SCOPE === 'all'
  ? final
  : [...solid, ...review.filter((s) => include.includes(s.pattern.toLowerCase()))];

console.log(`\n=== K ZÁPISU (${toWrite.length}) — SCOPE=${SCOPE}${include.length ? ` + INCLUDE=${include.join(',')}` : ''} ===\n`);
toWrite.forEach((s) => console.log(row(s)));

if (!CONFIRM) {
  console.log(`\n(dry-run — nic se nezapsalo. Pro zápis přidej CONFIRM=1)\n`);
  process.exit(0);
}

const exists = db.prepare(
  'SELECT 1 FROM category_rules WHERE user_id = ? AND pattern = ?'
);
const ins = db.prepare(
  'INSERT INTO category_rules (user_id, category_id, pattern) VALUES (?, ?, ?)'
);
let written = 0;
const tx = db.transaction(() => {
  for (const s of toWrite) {
    if (exists.get(USER_ID, s.pattern)) continue;
    ins.run(USER_ID, s.topCat, s.pattern);
    written++;
  }
});
tx();
console.log(`\n✅ Zapsáno ${written} pravidel do category_rules (SCOPE=${SCOPE}).\n`);
