// Web Push klientská logika. Bez frameworku, čisté fetch + Service Worker API.

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// True jen když appka běží jako nainstalovaná PWA (na iOS nutné pro push).
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export async function getRegistration() {
  return navigator.serviceWorker.register('/sw.js');
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await getRegistration();
  return reg.pushManager.getSubscription();
}

// Vyžádá povolení, zaregistruje a pošle subscription na backend. Vrací 'granted'|'denied'|'default'|'unsupported'.
export async function enablePush() {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission; // 'denied' | 'default'

  const reg = await getRegistration();
  const keyRes = await fetch('/api/push/public-key', { credentials: 'include' });
  if (!keyRes.ok) throw new Error('Push notifikace nejsou na serveru nakonfigurovány.');
  const { publicKey } = await keyRes.json();
  if (!publicKey) throw new Error('VAPID public key chybí na serveru.');

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  const json = sub.toJSON();
  await fetch('/api/push/subscribe', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  return 'granted';
}

// Stav registrace podle serveru. Vrací null, když se server nepodařilo zeptat.
export async function fetchPushStatus() {
  try {
    const r = await fetch('/api/push/status', { credentials: 'include' });
    if (!r.ok) return null;
    return r.json(); // { count, subscriptions: [{ endpoint, last_success_at, last_error, ... }] }
  } catch {
    return null;
  }
}

// Samoopravný resync: server může odběr zahodit (410 z Apple) a prohlížeč se to nikdy nedozví.
// Při každém startu proto lokální subscription znovu ohlásíme — /subscribe je idempotentní.
// Vrací true, když se odběr na server poslal.
export async function syncPush() {
  if (!pushSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  const sub = await currentSubscription();
  if (!sub) return false;
  const json = sub.toJSON();
  try {
    const r = await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (sub) {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
  }
}

export async function sendTestPush() {
  const res = await fetch('/api/push/test', { method: 'POST', credentials: 'include' });
  return res.json(); // { ok: true, sent: <number> }
}
