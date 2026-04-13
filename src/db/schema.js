const db = require('./connection');

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password_hash TEXT,
      email_verified INTEGER DEFAULT 0,
      verify_token TEXT,
      reset_token TEXT,
      reset_expires INTEGER,
      google_id TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#6366f1',
      icon TEXT DEFAULT 'tag',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category_id INTEGER,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'CZK',
      date TEXT NOT NULL,
      description TEXT,
      note TEXT,
      source TEXT DEFAULT 'manual',
      external_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
      UNIQUE (user_id, external_id)
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      amount REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
      UNIQUE (user_id, category_id, month)
    );

    CREATE TABLE IF NOT EXISTS airbank_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER,
      account_id TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id INTEGER PRIMARY KEY,
      billing_day INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS category_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      pattern TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS airbank_category_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ab_category TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      UNIQUE(user_id, ab_category),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_budgets_user_month ON budgets(user_id, month);
    CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
  `);

  // Migrace: budgety bez 'default' záznamu — vezmi nejnovější per user+category a nastav jako default
  const budgetMigration = db.prepare(`
    SELECT user_id, category_id, MAX(month) as month, amount
    FROM budgets
    WHERE month != 'default'
    GROUP BY user_id, category_id
    HAVING NOT EXISTS (
      SELECT 1 FROM budgets b2
      WHERE b2.user_id = budgets.user_id
        AND b2.category_id = budgets.category_id
        AND b2.month = 'default'
    )
  `).all();
  const insertDefault = db.prepare(`
    INSERT OR IGNORE INTO budgets (user_id, category_id, month, amount) VALUES (?, ?, 'default', ?)
  `);
  for (const row of budgetMigration) {
    insertDefault.run(row.user_id, row.category_id, row.amount);
  }

  // Migrace: nové sloupce pro Air Bank metadata
  const migrations = [
    'ALTER TABLE transactions ADD COLUMN tx_time TEXT',
    'ALTER TABLE transactions ADD COLUMN tx_type TEXT',
    'ALTER TABLE transactions ADD COLUMN counterparty_account TEXT',
    'ALTER TABLE transactions ADD COLUMN entered_by TEXT',
    'ALTER TABLE transactions ADD COLUMN place TEXT',
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* sloupec již existuje */ }
  }
}

module.exports = { initSchema };
