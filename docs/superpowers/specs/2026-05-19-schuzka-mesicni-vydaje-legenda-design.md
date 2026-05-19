# Schůzka: legenda sloupců v sekci Měsíční výdaje

**Datum:** 2026-05-19
**Soubor:** `client/src/pages/ReportPage.jsx`
**Kontext:** V sekci „Měsíční výdaje" nejsou popsané sloupce s částkami — není zřejmé, co která hodnota znamená.

## Cíl

Nad seznam řádků přidat legendový řádek s popisky sloupců (schváleno uživatelem): **Kategorie / Utraceno / Rozpočet / Stav**.

## Návrh

Pouze JSX v `ReportPage.jsx`, sekce `{/* ── MĚSÍČNÍ VÝDAJE (Typ 1) ── */}`. Legendový řádek se vykreslí jen když `budgets.length > 0` (v empty-state „Žádné měsíční rozpočty." legenda není), bezprostředně PŘED `<div className="report-budget-list">`.

Legenda znovupoužívá **stejné sloupcové třídy** jako datový řádek (`report-budget-dot` jako prázdný spacer, `report-budget-name`, `report-budget-spent`, `report-budget-limit`, `report-budget-status`) → zarovnání je automaticky shodné s daty (DRY, žádné ruční šířky). Odliší se jen stylem (menší, tučné, tlumená barva):

```jsx
                <div className="report-budget-row" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 4 }}>
                  <span className="report-budget-dot" style={{ background: 'transparent' }} />
                  <span className="report-budget-name">Kategorie</span>
                  <span className="report-budget-spent">Utraceno</span>
                  <span className="report-budget-limit">Rozpočet</span>
                  <span className="report-budget-status">Stav</span>
                </div>
```

Umístění: uvnitř větve `budgets.length === 0 ? (...) : ( <> <legenda/> <div className="report-budget-list">…</div> </> )` — tj. obalit stávající `report-budget-list` a legendu fragmentem. Žádná jiná sekce ani řádek se nemění; data řádky (`Link`/`div` mapping) beze změny.

## Mimo rozsah (YAGNI)

- Žádné popisky v jiných sekcích (Roční/sezónní, Drahé věci, Příjmy, Fixní platby) — nevyžádáno.
- Žádná změna `App.css` (styl legendy inline, jednorázový).
- Žádná změna chování/dat/backendu.

## Testy

Žádné FE testy. Ověření: `npm run build` (0 chyb) + grep, že legenda „Kategorie/Utraceno/Rozpočet/Stav" je v sekci Měsíční výdaje a jen tam. Manuálně: na Schůzce nad řádky Měsíčních výdajů je čitelná legenda zarovnaná se sloupci; při prázdném stavu legenda není.

## Dopad / rizika

- Čistě kosmetické, aditivní; zarovnání zaručeno znovupoužitím sloupcových tříd.
- Riziko: kdyby `report-budget-list` měl víc sourozenců — má jen mapování; obalení fragmentem je bezpečné.
