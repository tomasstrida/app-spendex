# Oslavný efekt po výběru kategorie v importu

**Datum:** 2026-06-30
**Stav:** schváleno, k implementaci

## Cíl

Když uživatel v review frontě „Z e-mailu" upřesní kategorii u čekající (pending)
platby, dát mu drobný radostný feedback: konfety v barvě kategorie, odlet kartičky
a krátký zvuk. Posiluje návyk zařazovat platby.

## Rozsah

- **Spouštěč:** `ImportPage.approve()` po úspěšném `r.ok`, **jen pro `pending`** položky
  (klik na dlaždici kategorie). NE pro awaiting_card (přiřazení karty) ani inline editaci
  v Transakcích.
- Per-device preference zvuku (localStorage), default zapnuto.

## Komponenty

### `client/src/utils/celebrate.js` (nový)

Čtyři exporty:

- `isCelebrationSoundEnabled()` → boolean. Čte localStorage klíč
  `spendex_celebrate_sound`. Chybí-li klíč → `true` (default zapnuto). Jiná hodnota
  než `'0'`/`'1'` → ošetřit jako default true.
- `setCelebrationSoundEnabled(enabled)` → uloží `'1'`/`'0'` do localStorage.
- `playPopSound()` → Web Audio API. Lazy-init sdíleného `AudioContext`, `resume()`
  (kvůli iOS autoplay; volá se z click handleru = user gesture). Dva krátké tóny
  (oscilátor, ~150 ms, gain envelope ať to nelupá). Žádný side-efekt mimo audio.
  No-op když `isCelebrationSoundEnabled()` je false nebo Web Audio není dostupné.
- `fireConfetti(originRect, color)` → vytvoří ~16 částicových `<div.confetti-piece>`
  do `document.body` (position: fixed) se startem u `originRect` (střed kliknuté
  dlaždice), náhodné rozptyly přes CSS custom properties (`--dx`, `--dy`, `--rot`),
  barva = barva kategorie. Auto-remove po skončení animace (`animationend` +
  pojistka setTimeout). No-op při `prefers-reduced-motion: reduce`.

Náhodnost (rozptyl částic) přes `Math.random()` je v klientském kódu OK
(workflow-omezení na Math.random se týká jen workflow skriptů, ne app kódu).

### `client/src/pages/ImportPage.jsx`

- Stav `celebratingId` (id právě oslavované položky).
- `approve(item, categoryId, originEl)`:
  1. POST jako dnes.
  2. Po `r.ok`: najdi barvu kategorie z `cats` (`c.color`), zavolej
     `fireConfetti(originEl.getBoundingClientRect(), color)` a `playPopSound()`.
  3. `setCelebratingId(item.id)` → kartička dostane třídu `.celebrating`.
  4. Po ~450 ms: `await load()` + `setCelebratingId(null)`.
  - Při `prefers-reduced-motion`: přeskoč odlet (kratší/nulová prodleva), konfety
    jsou no-op samy.
- Dlaždice `onClick` předá `e.currentTarget` jako origin.

### `client/src/index.css`

- `.confetti-piece` — `position: fixed`, malý čtvereček, `will-change: transform`,
  animace `confettiFly` (translate dle `--dx/--dy`, rotate dle `--rot`, fade-out).
- `.review-item.celebrating` — transition: `transform`/`opacity`
  (scale ~0.96, translateY -8px, fade na 0).
- `@media (prefers-reduced-motion: reduce)` — vypnout obě animace.

### Nastavení (sekce Notifikace)

Přepínač „Zvuk při zařazení platby" → čte/píše přes `isCelebrationSoundEnabled` /
`setCelebrationSoundEnabled`. Čistě klientské, žádný backend. Umístění:
`client/src/pages/SettingsPage.jsx`, `CollapsibleCard title={t.settings.notifications_title}`
(řádky ~478–525), za `notifications_scope` select. Stav `useState` inicializovaný
z `isCelebrationSoundEnabled()`, checkbox/toggle volá setter + překlopí stav.
Texty do `client/src/i18n.js` (`settings.celebration_sound_label`).

## Testy

- **TDD `node --test client/src/utils/celebrate.test.js`** na čisté helpery
  persistence: default true bez klíče, set→get round-trip `true`/`false`, odolnost
  vůči nevalidní hodnotě. localStorage v testu = lehký in-memory stub na `globalThis`.
- `playPopSound` / `fireConfetti` = DOM/Web Audio side-efekty → **vizuální ověření
  v prohlížeči** (skill verify), bez unit testu.

## Mimo rozsah

- Cross-device sync zvukové preference (zůstává per-device localStorage).
- Efekt u přiřazení karty a u inline editace v Transakcích.
- Konfigurovatelnost typu/intenzity efektu.
