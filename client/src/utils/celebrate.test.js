import test from 'node:test';
import assert from 'node:assert/strict';

// Lehký in-memory localStorage stub (node nemá window/localStorage).
function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  return store;
}

test('isCelebrationSoundEnabled: default true bez uloženého klíče', async () => {
  installLocalStorage();
  const { isCelebrationSoundEnabled } = await import('./celebrate.js');
  assert.equal(isCelebrationSoundEnabled(), true);
});

test('set→get round-trip: false a zpět true', async () => {
  installLocalStorage();
  const { isCelebrationSoundEnabled, setCelebrationSoundEnabled } = await import('./celebrate.js');
  setCelebrationSoundEnabled(false);
  assert.equal(isCelebrationSoundEnabled(), false);
  setCelebrationSoundEnabled(true);
  assert.equal(isCelebrationSoundEnabled(), true);
});

test('nevalidní uložená hodnota → bezpečně default true', async () => {
  const store = installLocalStorage();
  store.set('spendex_celebrate_sound', 'xyz');
  const { isCelebrationSoundEnabled } = await import('./celebrate.js');
  assert.equal(isCelebrationSoundEnabled(), true);
});

test('uložená "0" → false', async () => {
  const store = installLocalStorage();
  store.set('spendex_celebrate_sound', '0');
  const { isCelebrationSoundEnabled } = await import('./celebrate.js');
  assert.equal(isCelebrationSoundEnabled(), false);
});
