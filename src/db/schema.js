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

    CREATE TABLE IF NOT EXISTS income (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      person TEXT NOT NULL,
      amount REAL NOT NULL,
      period TEXT NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, person, period)
    );

    CREATE TABLE IF NOT EXISTS income_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      person TEXT NOT NULL,
      planned_amount REAL NOT NULL DEFAULT 0,
      match_pattern TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS annual_budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
      UNIQUE (user_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS fixed_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS budget_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      window_start INTEGER NOT NULL,
      window_end INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      account_number TEXT,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'spending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, account_number)
    );

    CREATE TABLE IF NOT EXISTS duplicate_dismissals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tx_ids TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, tx_ids)
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_budgets_user_month ON budgets(user_id, month);
    CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
    CREATE INDEX IF NOT EXISTS idx_annual_budgets_user ON annual_budgets(user_id);
    CREATE INDEX IF NOT EXISTS idx_budget_items_category ON budget_items(user_id, category_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
    CREATE TABLE IF NOT EXISTS csv_archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'airbank',
      account_id INTEGER,
      uploaded_at TEXT DEFAULT (datetime('now')),
      content TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      parsed_tx_count INTEGER DEFAULT 0,
      note TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
      UNIQUE(user_id, file_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_dup_dismiss_user ON duplicate_dismissals(user_id);
    CREATE INDEX IF NOT EXISTS idx_csv_archive_user ON csv_archive(user_id);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

    CREATE TABLE IF NOT EXISTS email_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      received_at TEXT,
      raw_text TEXT,
      parsed_json TEXT,
      external_id TEXT,
      suggested_category_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (suggested_category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_email_inbox_user ON email_inbox(user_id, status);

    CREATE TABLE IF NOT EXISTS backup_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      status        TEXT NOT NULL,
      object_key    TEXT,
      size_bytes    INTEGER,
      pruned_count  INTEGER,
      error         TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_backup_log_created ON backup_log(created_at);

    CREATE TABLE IF NOT EXISTS household_members (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      data_owner_id INTEGER NOT NULL,
      user_id       INTEGER NOT NULL UNIQUE,
      created_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (data_owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)       REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_household_members_owner ON household_members(data_owner_id);

    CREATE TABLE IF NOT EXISTS household_invites (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      data_owner_id INTEGER NOT NULL UNIQUE,
      token         TEXT NOT NULL UNIQUE,
      created_at    TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (data_owner_id) REFERENCES users(id) ON DELETE CASCADE
    );
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

  // Migrace: nové sloupce pro Air Bank metadata + typ kategorie
  const migrations = [
    'ALTER TABLE transactions ADD COLUMN tx_time TEXT',
    'ALTER TABLE transactions ADD COLUMN tx_type TEXT',
    'ALTER TABLE transactions ADD COLUMN counterparty_account TEXT',
    'ALTER TABLE transactions ADD COLUMN entered_by TEXT',
    'ALTER TABLE transactions ADD COLUMN place TEXT',
    'ALTER TABLE categories ADD COLUMN type INTEGER DEFAULT 1',
    'ALTER TABLE categories ADD COLUMN typical_price REAL',
    'ALTER TABLE categories ADD COLUMN frequency_months INTEGER',
    'ALTER TABLE transactions ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL',
    'ALTER TABLE transactions ADD COLUMN ab_category TEXT',
    // Datová integrita: kategorie unikátní per uživatel. Bez tohoto INSERT OR IGNORE
    // v import skriptu nikdy neignoruje a zakládá duplicity. Selže tiše, pokud
    // duplicity už existují – v tom případě je nutné je nejdřív vyčistit ručně.
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name ON categories(user_id, name)',
    'ALTER TABLE fixed_expenses ADD COLUMN match_pattern TEXT',
    'ALTER TABLE income_sources ADD COLUMN match_counterparty_account TEXT',
    'ALTER TABLE income_sources ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL',
    "ALTER TABLE settings ADD COLUMN notify_scope TEXT DEFAULT 'pending_only'",
    'DROP TABLE IF EXISTS airbank_tokens',
    'ALTER TABLE users ADD COLUMN verify_expires INTEGER',
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* sloupec/index již existuje nebo nelze aplikovat */ }
  }
}

module.exports = { initSchema };
