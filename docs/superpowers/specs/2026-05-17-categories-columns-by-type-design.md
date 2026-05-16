# Kategorie ve sloupcích podle typu

**Datum:** 2026-05-17
**Stav:** návrh ke schválení

## Kontext

`client/src/pages/CategoriesPage.jsx` dnes renderuje plochý seznam `.category-row`
(barevná tečka, název, type badge, edit/delete) seřazený podle názvu. `TYPE_OPTIONS`:
1 = Měsíční, 2 = Roční / sezónní, 3 = Drahé věci. Prod má typ 1 ×17, typ 2 ×7,
typ 3 ×0. Inline edit nahradí řádek formulářem; „Přidat" je card nahoře.

## Cíl

Zobrazit kategorie ve sloupcích podle `type` — každý (neprázdný) typ vlastní sloupec.
Čistě prezentační změna, frontend-only.

## Návrh (přístup A: seskupení v JSX + CSS grid)

### Data
- Zdroj beze změny: `GET /api/categories` (vrací vše, řazeno `name ASC`).
- V `CategoriesPage` seskupit načtené `categories` podle `c.type || 1`.
- Pořadí sloupců = přítomné typy vzestupně podle hodnoty typu (1 → 2 → 3).
- **Sloupec se renderuje jen pro typ, který má ≥ 1 kategorii** (prázdný typ se
  nezobrazí — potvrzeno uživatelem).
- V rámci sloupce pořadí dle názvu (zachováno z API; seskupení pořadí nemění).
- Striktně dle pole `type` — všech 17 kategorií typu 1 (včetně Ostatní/Příjmy/
  Převody/Pravidelné platby) v jednom sloupci „Měsíční", bez podsekcí (potvrzeno).

### Layout
- Kontejner `.category-columns` — CSS grid, `grid-template-columns:
  repeat(auto-fit, minmax(280px, 1fr))`, mezera mezi sloupci. Na širokém displeji
  sloupce vedle sebe, na úzkém se automaticky zalomí/staví pod sebe (bez JS
  breakpointů).
- Každý sloupec `.category-column` obsahuje:
  - hlavičku `.category-column-head` = label typu (z `TYPE_OPTIONS`) + počet `(n)`,
  - pod ní existující `.category-row` položky daného typu.

### Zachováno beze změny
- `.category-row` markup (tečka, název, type badge, edit/delete tlačítka).
  Type badge na řádku je v rámci sloupce redundantní, ale **ponechán** (odstranění =
  samostatné rozhodnutí, mimo rozsah).
- Inline edit: editovaný řádek nahrazen `CategoryForm` card uvnitř svého sloupce.
- Delete, „Přidat" form (card nahoře), loading / empty / no-categories stavy.
- `CategoryForm`, `TYPE_OPTIONS`, API, DB — beze změny.

### Soubory
- `client/src/pages/CategoriesPage.jsx` — seskupení + render sloupců (nahrazení
  jednoho `.category-list` mapu za grupování do `.category-columns`).
- `client/src/App.css` — 3 nové třídy: `.category-columns`, `.category-column`,
  `.category-column-head`. Stávající `.category-list` / `.category-row` styly se
  nemění (grid je nový wrapper).

### Mimo rozsah
- Změna API/DB, nový endpoint.
- Drag-and-drop přesun mezi typy.
- Odstranění type badge z řádku.
- Prázdné sloupce / drop-zone pro typ bez kategorií.

## Testy a ověření
- `cd client && npm run build` — projde bez chyby.
- Manuální browser kontrola (dev server): sloupce odpovídají typům (Měsíční,
  Roční / sezónní), počty sedí, edit nahradí řádek ve správném sloupci, delete a
  „Přidat" fungují, responsivní zalomení na úzkém okně. (Interaktivní klik-test
  dělá člověk po deployi — agent ho z prostředí neprovede, uvede to explicitně.)

## Rizika
- Nízká. Frontend-only, žádná datová ani API změna; stávající řádková logika
  (edit/delete/add) se znovupoužívá beze změny, jen se přeskupí do gridu.
- `auto-fit minmax(280px,1fr)`: při 1 typu = 1 sloupec přes celou šířku (akceptováno
  — málo kategorií jednoho typu je vzácné; vizuálně OK).
