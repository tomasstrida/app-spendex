/* Service worker pro Spendex — pouze push (žádné offline caching zatím). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'SPENDEX', body: 'Nová platba k zařazení', url: '/import' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (_e) { /* keep default */ }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/import' },
      tag: 'spendex-payment',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/import';
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Jen okna stejného originu (vyhneme se zaostření cizí karty).
    const windows = list.filter((c) => {
      try { return new URL(c.url).origin === self.location.origin; } catch (_e) { return false; }
    });
    if (windows.length > 0) {
      const c = windows[0];
      try { await c.focus(); } catch (_e) { /* fokus nemusí projít */ }
      // Hlavní cesta: appka přesměruje sama přes React Router (spolehlivé i když
      // je už otevřená na jiné stránce, kde c.navigate() na iOS PWA selhává).
      c.postMessage({ type: 'navigate', url });
      // Pojistka pro starší klienty bez message listeneru.
      if ('navigate' in c) { c.navigate(url).catch(() => {}); }
      return;
    }
    await self.clients.openWindow(url);
  })());
});
