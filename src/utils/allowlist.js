'use strict';

// Povolené e-maily pro založení nového účtu (Google OAuth i lokální registrace).
// Kontroluje se JEN při vzniku nového uživatele — stávající uživatelé se přihlašují
// dál bez omezení (nelze je nechtěně vyřadit).

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Jednoduchá validace formátu e-mailu (server-side, ne jen klient).
function isValidEmail(email) {
  const e = normalizeEmail(email);
  return e.length >= 3 && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function isEmailAllowed(db, email) {
  const e = normalizeEmail(email);
  if (!e) return false;
  // 1) ENV adminové jsou povolení vždy (bootstrap, i kdyby DB byla prázdná).
  if (getAdminEmails().includes(e)) return true;
  // 2) E-mail je na allowlistu.
  if (db.prepare('SELECT 1 FROM allowed_emails WHERE email = ? COLLATE NOCASE').get(e)) return true;
  // 3) E-mail patří stávajícímu adminovi.
  if (db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND is_admin = 1').get(e)) return true;
  return false;
}

module.exports = { getAdminEmails, normalizeEmail, isValidEmail, isEmailAllowed };
