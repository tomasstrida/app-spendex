// Oslavný efekt po upřesnění kategorie v importu: konfety v barvě kategorie,
// krátký syntetizovaný "pop" a (volající řeší) odlet kartičky.
// Zvuk je per-device preference v localStorage; animace respektuje prefers-reduced-motion.

const SOUND_KEY = 'spendex_celebrate_sound';

// Default zapnuto: jen výslovně uložená '0' znamená vypnuto, cokoli jiného (vč.
// chybějícího klíče i nevalidní hodnoty) → true.
export function isCelebrationSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setCelebrationSoundEnabled(enabled) {
  try {
    localStorage.setItem(SOUND_KEY, enabled ? '1' : '0');
  } catch {
    /* localStorage nedostupný (privátní režim) → tichý no-op */
  }
}

function prefersReducedMotion() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// Sdílený AudioContext (lazy, ať se nevytvoří mimo user gesture → iOS autoplay).
let audioCtx = null;

// Krátký dvoutónový "pop" (blip → vyšší blip) přes Web Audio. No-op když je zvuk
// vypnutý nebo Web Audio není dostupné. Volat z click handleru (user gesture).
export function playPopSound() {
  if (!isCelebrationSoundEnabled()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.value = 0.0001;
    master.connect(audioCtx.destination);

    // dva rychle po sobě jdoucí tóny
    const tones = [
      { freq: 660, start: 0, dur: 0.09 },
      { freq: 990, start: 0.08, dur: 0.13 },
    ];
    for (const tn of tones) {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = tn.freq;
      const t0 = now + tn.start;
      // krátká attack/decay obálka, ať to neluptá
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + tn.dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + tn.dur + 0.02);
    }
    master.gain.value = 1;
  } catch {
    /* audio selhalo → efekt je nepodstatný, nešíříme chybu */
  }
}

// Vystřelí burst konfet z místa originRect (DOMRect kliknuté dlaždice) v dané barvě.
// Částice jsou position:fixed divy v document.body s CSS animací; samy se uklidí.
// No-op při prefers-reduced-motion nebo bez DOM.
export function fireConfetti(originRect, color) {
  if (prefersReducedMotion()) return;
  if (typeof document === 'undefined' || !originRect) return;

  const cx = originRect.left + originRect.width / 2;
  const cy = originRect.top + originRect.height / 2;
  const palette = [color || '#6366f1', '#ffffff', '#fbbf24', '#34d399'];
  const COUNT = 16;

  for (let i = 0; i < COUNT; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    // rozptyl: nahoru do polokruhu (záporné dy), náhodné x
    const angle = (Math.PI * (0.15 + 0.7 * Math.random())) * -1; // -27°…-153° (vzhůru)
    const dist = 60 + Math.random() * 90;
    const dx = Math.cos(angle) * dist * (Math.random() < 0.5 ? -1 : 1);
    const dy = Math.sin(angle) * dist - (20 + Math.random() * 40);
    piece.style.left = `${cx}px`;
    piece.style.top = `${cy}px`;
    piece.style.background = palette[i % palette.length];
    piece.style.setProperty('--dx', `${dx.toFixed(1)}px`);
    piece.style.setProperty('--dy', `${dy.toFixed(1)}px`);
    piece.style.setProperty('--rot', `${(Math.random() * 720 - 360).toFixed(0)}deg`);
    piece.style.animationDelay = `${(Math.random() * 60).toFixed(0)}ms`;
    document.body.appendChild(piece);

    const cleanup = () => piece.remove();
    piece.addEventListener('animationend', cleanup);
    setTimeout(cleanup, 1400); // pojistka kdyby animationend nedorazil
  }
}
