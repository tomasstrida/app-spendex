const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Unicode-aware lower + odstranění diakritiky pro vyhledávání necitlivé na velikost
// písmen i háčky/čárky. SQLite vestavěný lower()/LIKE umí jen ASCII A-Z.
db.function('unaccent_lower', { deterministic: true }, (s) => {
  if (s == null) return null;
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
});

module.exports = db;
