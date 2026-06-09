# Ikonový picker kategorií v review frontě

**Datum:** 2026-06-09
**Stav:** návrh ke schválení

## Cíl

Rychlé zařazení nezaložených plateb (review fronta z e-mailu/importu na
ImportPage) nahradit textových scrollovacích dlaždic kompaktní mřížkou **ikon**.
Uživatel nahraje vlastní JPG ikonu ke každé kategorii na stránce Kategorie.

## Rozhodnutí (z brainstormingu)

- **Jen ikona** (bez popisku); název kategorie v `title` (tooltip / podržení).
- **Upload ikony per kategorie** v Kategoriích → uložení na volume + sloupec v DB.
- Rozsah: **jen review fronta na ImportPage** (pending + card-owner picker ne).

## Úložiště a model

- DB migrace: `ALTER TABLE categories ADD COLUMN icon_image TEXT`
  (hodnota = název souboru `<id>-<ms>.jpg`; `NULL` = bez vlastní ikony).
- Soubory na **volume**, mimo public root (security baseline):
  `dir = path.dirname(DB_PATH) + '/cat-icons'` → prod `/data/cat-icons`
  (persistuje přes deploye), lokál `./cat-icons`. Adresář se vytvoří při startu.
- Název souboru odvozuje **server** z `category_id` + `Date.now()` (nikdy z
  klientského názvu → žádný path traversal; časové razítko = cache-busting).

## Endpointy (`routes/categories.js`, vše `requireAuth` + ownership na `dataUserId`)

- `POST /:id/icon` (+ `writeLimiter`): tělo `{ image: "data:image/jpeg;base64,…" }`.
  Validace: prefix `data:image/(jpeg|png)`, dekód base64, **magic bytes**
  (JPEG `FF D8 FF` / PNG `89 50 4E 47`), strop dekódované velikosti **≤ 200 KB**.
  Zapíše soubor, smaže předchozí, nastaví `icon_image`. Vrací aktualizovanou kategorii.
- `DELETE /:id/icon`: smaže soubor + `icon_image = NULL`.
- `GET /:id/icon`: načte soubor z volume podle `icon_image` v DB, pošle s
  `Content-Type` + `Cache-Control`. 404 když ikona není.

## Klient – Kategorie (`CategoriesPage.jsx`)

U každé kategorie: náhled aktuální ikony (nebo placeholder) + „Nahrát ikonu"
(`input type=file accept=image/*`). Po výběru se obrázek **na klientovi zmenší
přes canvas na 128×128** (center-crop, `toDataURL('image/jpeg', 0.85)`) → POST.
Tím je ikona vždy malá a čtvercová bez ohledu na zdroj. Možnost „Odebrat".

## Klient – review fronta (`ImportPage.jsx`)

Dlaždice `cat-tile` → kompaktní čtvercové ikony:
- má-li kategorie `icon_image` → `<img src="/api/categories/:id/icon?v=<ms>">`,
- jinak **placeholder** = barevný kruh s první písmenem (jako avataři lidí),
  takže mřížka je uniformní i před nahráním všech ikon.
- `title` = název kategorie; klik = okamžité `approve` (beze změny chování).
- Návrh (`suggested`) zůstává zvýrazněný rámečkem; štítek „NAVRŽENO" → malý
  odznak v rohu.
- Mřížka `repeat(auto-fill, minmax(64px, 1fr))`, bez vnitřního scrollu.

## Geometrie / trade-off

Na desktopu (~600px karta) vyjde 24 kategorií zhruba na **3 řady** (8 sloupců).
Na úzkém telefonu vznikne víc řad, ale ikony jsou kompaktní a **bez scrollu** —
doslovné „3 řady" na mobilu by znamenalo ~40px ikony, čitelnost horší. Volím
kompaktní zalamovanou mřížku (na desktopu = 3 řady).

## Bezpečnost

- Upload jen vlastníkovi kategorie, magic-byte + velikostní validace, server
  generuje název souboru, úložiště mimo public root, servírování jen přes
  authed route. Reuse `writeLimiter`.

## Mimo scope

- Picker v Transakcích a v card-owner výběru.
- Sdílení ikon mezi členy domácnosti (každý si nahraje k vlastním kategoriím).
- Server-side resize (řeší klient přes canvas).
