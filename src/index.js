require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('./services/passport');
const { initSchema } = require('./db/schema');
const SqliteStore = require('better-sqlite3-session-store')(session);
const db = require('./db/connection');

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET is required in production');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Railway / reverse proxy
app.set('trust proxy', 1);

// --- Middleware ---
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

const SESSION_DB_PATH = process.env.SESSION_DB_PATH || path.join(__dirname, '../sessions.db');
app.use(session({
  store: new SqliteStore({ client: require('better-sqlite3')(SESSION_DB_PATH) }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// --- DB Init ---
initSchema();

// --- Health check ---
const APP_VERSION = require('fs').readFileSync(require('path').join(__dirname, '../VERSION'), 'utf8').trim();
app.get('/health', (req, res) => res.json({ status: 'ok', version: APP_VERSION }));

// --- API routes ---
app.use('/auth', require('./routes/auth'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/budgets', require('./routes/budgets'));
app.use('/api/annual-budgets', require('./routes/annual-budgets'));
app.use('/api/budget-items', require('./routes/budget-items'));
app.use('/api/fixed-expenses', require('./routes/fixed-expenses'));
app.use('/api/income', require('./routes/income'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/import', require('./routes/import'));

// --- Frontend (production) ---
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Spendex running on port ${PORT}`);
});
