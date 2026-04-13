const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const db = require('../db/connection');
const passport = require('../services/passport');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email');

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

// --- Google OAuth ---
if (process.env.GOOGLE_CLIENT_ID) {
  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
  router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: '/login?error=google' }),
    (req, res) => res.redirect('/')
  );
}

// --- Registrace ---
router.post('/register', authLimiter, async (req, res) => {
  const { email, name, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-mail a heslo jsou povinné.' });
  if (password.length < 8) return res.status(400).json({ error: 'Heslo musí mít alespoň 8 znaků.' });

  try {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'Tento e-mail je již registrován.' });

    const hash = await bcrypt.hash(password, 12);
    const token = uuidv4();
    db.prepare(
      'INSERT INTO users (email, name, password_hash, verify_token) VALUES (?, ?, ?, ?)'
    ).run(email, name || email.split('@')[0], hash, token);

    await sendVerificationEmail(email, name, token);
    res.json({ ok: true, message: 'Zkontrolujte svůj e-mail a potvrďte účet.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Chyba serveru.' });
  }
});

// --- Ověření e-mailu ---
router.get('/verify', (req, res) => {
  const { token } = req.query;
  const user = db.prepare('SELECT * FROM users WHERE verify_token = ?').get(token);
  if (!user) return res.redirect('/login?error=invalid_token');

  db.prepare('UPDATE users SET email_verified = 1, verify_token = NULL WHERE id = ?').run(user.id);
  req.login(user, () => res.redirect('/'));
});

// --- Přihlášení (local) ---
router.post('/local', authLimiter, passport.authenticate('local'), (req, res) => {
  res.json({ ok: true, user: { id: req.user.id, email: req.user.email, name: req.user.name } });
});

// --- Zapomenuté heslo ---
router.post('/forgot', authLimiter, async (req, res) => {
  const { email } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Vždy vrátit OK (neodhalovat existenci účtu)
  if (!user || !user.password_hash) return res.json({ ok: true });

  const token = uuidv4();
  const expires = Date.now() + 60 * 60 * 1000; // 1 hodina
  db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, expires, user.id);
  await sendPasswordResetEmail(email, user.name, token).catch(console.error);
  res.json({ ok: true });
});

// --- Reset hesla ---
router.post('/reset', authLimiter, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 8) return res.status(400).json({ error: 'Neplatný požadavek.' });

  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user || user.reset_expires < Date.now()) return res.status(400).json({ error: 'Token vypršel nebo je neplatný.' });

  const hash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?').run(hash, user.id);
  res.json({ ok: true });
});

// --- Odhlášení ---
router.post('/logout', (req, res) => {
  req.logout(() => res.json({ ok: true }));
});

// --- Aktuální uživatel ---
router.get('/me', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const { id, email, name } = req.user;
  res.json({ id, email, name });
});

module.exports = router;
