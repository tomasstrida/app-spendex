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

async function postSubscription(sub) {
  const json = sub.toJSON();
  return fetch('/api/push/subscribe', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
}

async function createSubscription(reg) {
  const keyRes = await fetch('/api/push/public-key', { credentials: 'include' });
  if (!keyRes.ok) throw new Error('Push notifikace nejsou na serveru nakonfigurovány.');
  const { publicKey } = await keyRes.json();
  if (!publicKey) throw new Error('VAPID public key chybí na serveru.');
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
}

// Zajistí živý odběr ohlášený serveru. Lokální odběr může být mrtvý: push služba
// (typicky Apple) vrátila 410, server si endpoint označil a odpoví 409 { gone: true }.
// Prohlížeč se to jinak nedozví, takže odběr zahodíme a vytvoříme nový endpoint.
// Bez toho šlo notifikace vzkřísit jen ručním vypnutím a zapnutím v Nastavení.
async function ensureSubscribed(reg) {
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const r = await postSubscription(sub);
    if (r.status !== 409) return r.ok;
    await sub.unsubscribe();
  }
  sub = await createSubscription(reg);
  const r = await postSubscription(sub);
  return r.ok;
}

// Vyžádá povolení, zaregistruje a pošle subscription na backend. Vrací 'granted'|'denied'|'default'|'unsupported'.
export async function enablePush() {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission; // 'denied' | 'default'

  const reg = await getRegistration();
  await ensureSubscribed(reg);
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

// Samoopravný resync při každém startu: /subscribe je idempotentní, mrtvý endpoint
// (409) i ztracený lokální odběr se obnoví přes ensureSubscribed. Na iOS může
// subscribe mimo uživatelské gesto selhat — pak zůstane tlačítko v Nastavení.
// Vrací true, když server odběr zná.
export async function syncPush() {
  if (!pushSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    return await ensureSubscribed(await getRegistration());
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
