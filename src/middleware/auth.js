function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  // Lazy require: respektuje výměnu DB singletonu v testech (bust require.cache).
  const db = require('../db/connection');
  const row = db.prepare('SELECT data_owner_id FROM household_members WHERE user_id = ?').get(req.user.id);
  req.dataUserId = row ? row.data_owner_id : req.user.id;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const db = require('../db/connection');
  const u = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
  if (!u || !u.is_admin) return res.status(403).json({ error: 'Forbidden' });
  next();
}

module.exports = { requireAuth, requireAdmin };
