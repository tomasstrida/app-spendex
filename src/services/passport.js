const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const db = require('../db/connection');

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser((id, done) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

// Local strategy
passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !user.password_hash) return done(null, false, { message: 'Nesprávný e-mail nebo heslo.' });
    if (!user.email_verified) return done(null, false, { message: 'E-mail není ověřen.' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return done(null, false, { message: 'Nesprávný e-mail nebo heslo.' });
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

// Google OAuth strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
  }, (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      const name = profile.displayName;
      const googleId = profile.id;

      if (!email) return done(null, false, { message: 'Google účet nemá e-mail.' });

      let user = db.prepare('SELECT * FROM users WHERE google_id = ? OR email = ?').get(googleId, email);

      if (user) {
        if (!user.google_id) {
          db.prepare('UPDATE users SET google_id = ?, email_verified = 1 WHERE id = ?').run(googleId, user.id);
        }
        return done(null, user);
      }

      const result = db.prepare(
        'INSERT INTO users (email, name, google_id, email_verified) VALUES (?, ?, ?, 1)'
      ).run(email, name, googleId);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }));
}

module.exports = passport;
