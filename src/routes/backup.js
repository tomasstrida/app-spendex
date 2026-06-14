const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { listRecent, lastSuccessAt } = require('../services/backupLog');
const { shouldSchedule } = require('../services/scheduler');

// Záloha se považuje za „zdravou", pokud poslední úspěch není starší než tolik hodin.
// Denní cron běží ve 3:00; 28 h pokryje běžný drift, ale zmeškaný běh odhalí hned.
const HEALTHY_MAX_AGE_HOURS = 28;

// GET /api/backup/log?limit=20
router.get('/log', requireAuth, (req, res) => {
  const configured = Boolean(shouldSchedule());
  const entries = listRecent(db, req.query.limit);
  const lastSuccess = lastSuccessAt(db);

  let healthy = null; // null = neznámý stav (cron neaktivní nebo žádná záloha)
  if (configured && lastSuccess) {
    const ageMs = Date.now() - Date.parse(`${lastSuccess.replace(' ', 'T')}Z`);
    healthy = ageMs <= HEALTHY_MAX_AGE_HOURS * 3600 * 1000;
  }

  res.json({
    configured,
    healthy,
    last_success_at: lastSuccess,
    max_age_hours: HEALTHY_MAX_AGE_HOURS,
    entries,
  });
});

module.exports = router;
