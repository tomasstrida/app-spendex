'use strict';
const cron = require('node-cron');
const { createBackup } = require('./backup');
const { createR2Client } = require('./r2Client');
const { sendBackupFailureAlert } = require('./email');

function shouldSchedule(env = process.env) {
  return Boolean(
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET
  );
}

async function runBackupJob() {
  try {
    const r2 = createR2Client();
    const res = await createBackup({ r2 });
    console.log(`[backup] OK ${res.key} (${res.sizeBytes} B, prune ${res.prunedCount})`);
  } catch (err) {
    console.error('[backup] SELHALO:', err);
    try {
      await sendBackupFailureAlert(err);
    } catch (alertErr) {
      console.error('[backup] alert e-mail selhal:', alertErr);
    }
  }
}

function startScheduler() {
  if (!shouldSchedule()) {
    console.warn('[backup] R2 ENV nenastaveno — cron záloha NEAKTIVNÍ');
    return;
  }
  const expr = process.env.BACKUP_CRON || '0 3 * * *';
  cron.schedule(expr, runBackupJob, { timezone: 'Europe/Prague' });
  console.log(`[backup] cron aktivní: "${expr}" (Europe/Prague)`);
}

module.exports = { shouldSchedule, startScheduler, runBackupJob };
