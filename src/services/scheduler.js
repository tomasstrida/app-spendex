'use strict';
const cron = require('node-cron');
const db = require('../db/connection');
const { createBackup } = require('./backup');
const { createR2Client } = require('./r2Client');
const { recordBackup, hasRecentSuccess } = require('./backupLog');
const { sendBackupFailureAlert, sendBackupMissingAlert } = require('./email');

function shouldSchedule(env = process.env) {
  return Boolean(
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET
  );
}

function maxAgeHours(env = process.env) {
  const n = Number(env.BACKUP_MAX_AGE_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

async function runBackupJob() {
  try {
    const r2 = createR2Client();
    const res = await createBackup({ r2 });
    console.log(`[backup] OK ${res.key} (${res.sizeBytes} B, prune ${res.prunedCount})`);
    try {
      recordBackup(db, { status: 'success', res });
    } catch (logErr) {
      console.error('[backup] zápis backup_log selhal:', logErr);
    }
  } catch (err) {
    console.error('[backup] SELHALO:', err);
    try {
      await sendBackupFailureAlert(err);
    } catch (alertErr) {
      console.error('[backup] alert e-mail selhal:', alertErr);
    }
    try {
      recordBackup(db, { status: 'failure', err });
    } catch (logErr) {
      console.error('[backup] zápis backup_log (failure) selhal:', logErr);
    }
  }
}

/**
 * Čistá rozhodovací logika heartbeat kontroly. Pokud chybí čerstvá úspěšná
 * záloha, zavolá mailer(maxAge). Mailer i db injektovatelné (testy).
 */
async function checkBackupHeartbeat(database, mailer, maxAge) {
  if (hasRecentSuccess(database, maxAge)) {
    console.log('[backup] heartbeat OK (čerstvá záloha v backup_log)');
    return;
  }
  console.warn(`[backup] heartbeat: za posledních ${maxAge} h žádná úspěšná záloha — alert`);
  await mailer(maxAge);
}

async function runBackupCheckJob() {
  try {
    await checkBackupHeartbeat(db, sendBackupMissingAlert, maxAgeHours());
  } catch (err) {
    console.error('[backup] heartbeat kontrola selhala:', err);
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

  const checkExpr = process.env.BACKUP_CHECK_CRON || '0 5 * * *';
  cron.schedule(checkExpr, runBackupCheckJob, { timezone: 'Europe/Prague' });
  console.log(`[backup] heartbeat cron aktivní: "${checkExpr}" (Europe/Prague)`);
}

module.exports = { shouldSchedule, startScheduler, runBackupJob, runBackupCheckJob, checkBackupHeartbeat };
