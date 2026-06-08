const db = require('../db/connection');

function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
  const row = db.prepare('SELECT data_owner_id FROM household_members WHERE user_id = ?').get(req.user.id);
  req.dataUserId = row ? row.data_owner_id : req.user.id;
  next();
}

module.exports = { requireAuth };
