'use strict';
const webpush = require('web-push');
const { periodKeyForDate, getUserBillingDay } = require('../utils/period');

function defaultClient() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return null;
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:tomas.strida@gmail.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  return webpush;
}

async function sendToUser(db, userId, payload, client) {
  const sender = client || defaultClient();
  if (!sender) return;
  const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
  const body = JSON.stringify(payload);
  for (const s of subs) {
    const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await sender.sendNotification(sub, body);
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      } else {
        console.error('[push] odeslání selhalo:', err && err.message);
      }
    }
  }
}

function formatBody(notify) {
  const amount = Math.abs(Number(notify.amount) || 0);
  const sum = `${amount.toLocaleString('cs-CZ')} ${notify.currency || 'CZK'}`;
  const merchant = notify.merchant || 'Platba';
  // Ikona na začátku = stav kategorizace na první pohled:
  //   💳 neznámá karta (čí?), ✅ automaticky zařazeno, ⚠️ potřebuje ruční kategorii
  if (notify.unknownCard) return `💳 ${sum} • ${merchant} — čí karta? Přiřaď v aplikaci`;
  if (notify.categoryName) return `✅ ${sum} • ${merchant} → ${notify.categoryName}`;
  return `⚠️ ${sum} • ${merchant} — potřebuje kategorii`;
}

// Sestaví deep-link URL + unikátní tag podle typu výsledku.
function deepLink(db, result) {
  if (result.status === 'imported' && result.transactionId && result.txDate) {
    const key = periodKeyForDate(getUserBillingDay(db, result.userId), result.txDate);
    return { url: `/transactions?period=${key}&highlight=${result.transactionId}`, tag: `spendex-tx-${result.transactionId}` };
  }
  if (result.inboxId) {
    return { url: `/import?focus=${result.inboxId}`, tag: `spendex-${result.inboxId}` };
  }
  return { url: '/import', tag: 'spendex-payment' };
}

async function notifyForResult(db, result, client) {
  if (!result || !result.notify) return;
  if (result.status === 'awaiting_card' && result.broadcast) {
    const owner = result.userId;
    if (!owner) return;
    const members = db.prepare('SELECT user_id FROM household_members WHERE data_owner_id = ?')
      .all(owner).map(r => r.user_id);
    const targets = [...new Set([owner, ...members])];
    const link = deepLink(db, result);
    for (const t of targets) {
      await sendToUser(db, t, { title: 'SPENDEX', body: formatBody(result.notify), url: link.url, tag: link.tag }, client);
    }
    return;
  }
  if (result.status !== 'pending' && result.status !== 'imported') return;
  const target = result.notifyUserId || result.userId;
  if (!target) return;
  const row = db.prepare('SELECT notify_scope FROM settings WHERE user_id = ?').get(target);
  const scope = row?.notify_scope || 'pending_only';
  if (scope === 'off') return;
  if (result.status === 'imported' && scope !== 'all') return;
  const link = deepLink(db, result);
  await sendToUser(db, target, {
    title: 'SPENDEX',
    body: formatBody(result.notify),
    url: link.url,
    tag: link.tag,
  }, client);
}

module.exports = { sendToUser, notifyForResult, formatBody };
