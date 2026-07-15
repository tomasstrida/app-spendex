'use strict';
// Jednorázový setup subkategorií kategorie "Licence" (B-2):
//   1) idempotentně založí číselník subkategorií (per služba),
//   2) nastaví subcategory_id na existující textová pravidla a založí nová dopředná pravidla,
//   3) zpětně otaguje existující Licence transakce (subcategory_id IS NULL) podle patternu.
//
// Env: DB_PATH (povinné), CONFIRM=1 pro ostrý zápis (jinak dry-run). USER_ID (volitelné, jinak
// všichni uživatelé s cílovou kategorií). CATEGORY_NAME (volitelné, default "Licence";
// na produkci se kategorie jmenuje "Y_Licence" – roční budget typu 2).
// Aditivní: nikdy nic nemaže, doplňuje jen NULL subcategory_id a chybějící pravidla/subkategorie.
//
// POZOR – Railway: záměrně BEZ dopředného pravidla. Broad pattern "RAILWAY" koliduje s jízdným
// a textové pravidlo (L3) přepisuje i kategorii (běží před účtem), takže by budoucí vlakovou
// jízdenku přeřadilo do Licence. Existující Railway platby se otagují jen zpětně.

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH;
const CONFIRM = process.env.CONFIRM === '1';
const CATEGORY_NAME = process.env.CATEGORY_NAME || 'Licence';
if (!DB_PATH) { console.error('Chybí DB_PATH'); process.exit(1); }
const db = new Database(DB_PATH);
console.log(`Cílová kategorie: "${CATEGORY_NAME}"`);

// Kompletní číselník subkategorií Licence (per služba). Ostatní = ruční koš, bez patternu.
const SUBCATS = [
  'ChatGPT', 'Claude', 'Anthropic API', 'Apple', 'Nuelink', 'Google Workspace',
  'Discord', 'Opus Clip', 'WEDOS', 'Skool', 'Railway', 'CloudFlare', 'Ostatní',
];

// pattern → subkategorie. forward=true → smí existovat i dopředné textové pravidlo (bezpečné,
// 0 kolizí mimo Licence). forward=false → jen zpětné otagování existujících tx (Railway).
const MAPPINGS = [
  { pattern: 'OPENAI',           subcat: 'ChatGPT',          forward: true },
  { pattern: 'CLAUDE',           subcat: 'Claude',           forward: true },
  { pattern: 'ANTHROPIC',        subcat: 'Anthropic API',    forward: true },
  { pattern: 'APPLE.COM/BILL',   subcat: 'Apple',            forward: true },
  { pattern: 'NUELINK',          subcat: 'Nuelink',          forward: true },
  { pattern: 'Google Workspace', subcat: 'Google Workspace', forward: true },
  { pattern: 'DISCORD',          subcat: 'Discord',          forward: true },
  { pattern: 'OPUS CLIP',        subcat: 'Opus Clip',        forward: true },
  { pattern: 'WEDOS',            subcat: 'WEDOS',            forward: true },
  { pattern: 'P.SKOOL.COM',      subcat: 'Skool',            forward: true },
  { pattern: 'CLOUDFLARE',       subcat: 'CloudFlare',       forward: true },
  { pattern: 'RAILWAY',          subcat: 'Railway',          forward: false },
];

const users = process.env.USER_ID
  ? [{ id: +process.env.USER_ID }]
  : db.prepare("SELECT DISTINCT user_id AS id FROM categories WHERE name = ?").all(CATEGORY_NAME);

const plan = [];   // sběr akcí pro dry-run výpis
const actions = []; // funkce k provedení při CONFIRM

for (const u of users) {
  const lic = db.prepare("SELECT id FROM categories WHERE user_id = ? AND name = ?").get(u.id, CATEGORY_NAME);
  if (!lic) { plan.push(`[user ${u.id}] kategorie Licence neexistuje – přeskočeno`); continue; }
  const licId = lic.id;

  // 1) Subkategorie (idempotentně)
  const subIdByName = {};
  for (const name of SUBCATS) {
    const ex = db.prepare('SELECT id FROM subcategories WHERE user_id = ? AND category_id = ? AND name = ?').get(u.id, licId, name);
    if (ex) { subIdByName[name] = ex.id; continue; }
    plan.push(`[user ${u.id}] + subkategorie "${name}"`);
    actions.push(() => {
      const r = db.prepare('INSERT INTO subcategories (user_id, category_id, name) VALUES (?, ?, ?)').run(u.id, licId, name);
      subIdByName[name] = r.lastInsertRowid;
    });
  }
  // Pro dry-run doplň i id existujících (aby backfill plan viděl cíl)
  const resolveSub = (name) => subIdByName[name]
    || (db.prepare('SELECT id FROM subcategories WHERE user_id = ? AND category_id = ? AND name = ?').get(u.id, licId, name) || {}).id;

  // 2) Pravidla – set subcategory_id na existující + nová dopředná
  for (const m of MAPPINGS) {
    const existRule = db.prepare('SELECT id, subcategory_id FROM category_rules WHERE user_id = ? AND category_id = ? AND pattern = ?').get(u.id, licId, m.pattern);
    if (existRule) {
      if (existRule.subcategory_id == null) {
        plan.push(`[user ${u.id}] pravidlo "${m.pattern}" → subkategorie "${m.subcat}"`);
        actions.push(() => db.prepare('UPDATE category_rules SET subcategory_id = ? WHERE id = ?').run(resolveSub(m.subcat), existRule.id));
      }
    } else if (m.forward) {
      plan.push(`[user ${u.id}] + dopředné pravidlo "${m.pattern}" → Licence / "${m.subcat}"`);
      actions.push(() => db.prepare('INSERT INTO category_rules (user_id, category_id, pattern, subcategory_id) VALUES (?, ?, ?, ?)').run(u.id, licId, m.pattern, resolveSub(m.subcat)));
    }
    // forward=false a pravidlo neexistuje → žádné dopředné pravidlo (Railway)
  }

  // 3) Zpětné otagování existujících Licence tx (jen kde subcategory_id IS NULL)
  for (const m of MAPPINGS) {
    const like = `%${m.pattern.toLowerCase()}%`;
    const cnt = db.prepare(`
      SELECT COUNT(*) AS n FROM transactions
      WHERE user_id = ? AND category_id = ? AND subcategory_id IS NULL
        AND (LOWER(COALESCE(description,'')) LIKE ? OR LOWER(COALESCE(place,'')) LIKE ? OR LOWER(COALESCE(note,'')) LIKE ?)
    `).get(u.id, licId, like, like, like).n;
    if (cnt > 0) {
      plan.push(`[user ${u.id}] otagovat ${cnt}× tx "${m.pattern}" → "${m.subcat}"`);
      actions.push(() => {
        const sid = resolveSub(m.subcat);
        db.prepare(`
          UPDATE transactions SET subcategory_id = ?
          WHERE user_id = ? AND category_id = ? AND subcategory_id IS NULL
            AND (LOWER(COALESCE(description,'')) LIKE ? OR LOWER(COALESCE(place,'')) LIKE ? OR LOWER(COALESCE(note,'')) LIKE ?)
        `).run(sid, u.id, licId, like, like, like);
      });
    }
  }
}

console.log('=== Plán akcí ===');
if (plan.length === 0) console.log('(nic k provedení – vše už existuje)');
else plan.forEach(p => console.log('  ' + p));

if (!CONFIRM) { console.log('\nDry-run. Pro ostrý zápis spusť s CONFIRM=1.'); process.exit(0); }

const run = db.transaction(() => { for (const a of actions) a(); });
run();
console.log(`\nHotovo. Provedeno ${actions.length} akcí.`);
