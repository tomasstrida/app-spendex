# Design: Velké dlaždice při zařazování do kategorií (mobil)

Datum: 2026-06-09
Stav: schváleno k implementaci (mockup varianta A v3 odsouhlasen)

## Cíl

Na obrazovce **ImportPage → „Z e-mailu"** se platby k zařazení dnes přiřazují přes
malý nativní `<select>` dropdown + tlačítko „Zařadit" (`client/src/pages/ImportPage.jsx:240–268`).
Na telefonu je dropdown malý a nepohodlný. Nahradíme ho **mřížkou velkých dlaždic**:
klepnutí na dlaždici rovnou zařadí.

Rozsah: jen pending fronta „Z e-mailu" na ImportPage. Ruční editace kategorie na
TransactionsPage je mimo rozsah.

## Schválený layout (varianta A, v3)

Pro každou pending položku:

**Kompaktní hlavička** (karta `.tx`):
- Řádek 1: **název obchodu** (tučně, dominantní) vlevo + **částka** vpravo. Částka je
  ve **stejné tlumené barvě a velikosti jako ostatní info** (`--text2` / `#8b90a7`,
  ~13 px) — vizuálně ustupuje.
- Řádek 2 (sub): datum · čas + **jmenovka majitele karty** (pilulka s iniciálou + jméno).
  Místo čísla karty. Když platba nemá kartu (převod), jmenovka se nezobrazí.

**Mřížka dlaždic** (`.tiles-scroll` → `.grid`):
- 2 sloupce, dlaždice min-výška ~58 px: barevná tečka (barva kategorie) + název.
- **Navržená kategorie** první, zvýrazněná (accent rámeček + štítek „NAVRŽENO").
- Zbytek kategorií v běžném pořadí.
- **Klepnutí na dlaždici = okamžité zařazení** (žádné druhé tlačítko „Zařadit").
- Když je kategorií moc, oblast **scrolluje** (`max-height ~300 px`, `overflow-y:auto`),
  dole jemné stmívání jako náznak.

**Akce**: tlačítko smazat (🗑) zůstává (zahodí pending položku).

## Frontend — `client/src/pages/ImportPage.jsx`

Přepsat blok `pending.map(...)` (ř. 240–268). Zrušit `<select>`, `selectedCats` state
a tlačítko „Zařadit". Nová struktura JSX per položka:

```jsx
<div key={item.id} className="card review-item">
  <div className="review-head">
    <div className="review-merch">{tx.description || '—'}</div>
    <div className="review-amt">{formatCurrency(tx.amount)}</div>
  </div>
  <div className="review-sub">
    <span>{tx.date} {tx.tx_time || ''}</span>
    {item.card_owner_name && (
      <span className="who">
        <span className="who-av" style={{ background: ownerColor(item.card_owner_id) }}>
          {item.card_owner_name.charAt(0).toUpperCase()}
        </span>
        {item.card_owner_name}
      </span>
    )}
  </div>
  <div className="review-tiles">
    <div className="review-grid">
      {orderedCats(cats, item.suggested_category_id).map(c => (
        <button key={c.id}
          className={`cat-tile${c.id === item.suggested_category_id ? ' suggested' : ''}`}
          disabled={busy === item.id}
          onClick={() => approve(item, c.id)}>
          <span className="cat-dot" style={{ background: c.color }} />
          <span className="cat-name">{c.name}</span>
          {c.id === item.suggested_category_id && <span className="cat-sug">NAVRŽENO</span>}
        </button>
      ))}
    </div>
  </div>
  <div className="review-actions">
    <button className="btn btn-ghost btn-icon" disabled={busy === item.id}
      onClick={() => remove(item)} title="Smazat"><Trash2 size={14} /></button>
  </div>
</div>
```

Pomocné funkce (v komponentě nebo modulu):
- `orderedCats(cats, suggestedId)` — vrátí navrženou kategorii první, pak zbytek v
  původním pořadí (`[suggested, ...others]`). Pokud `suggestedId` je null, jen `cats`.
- `ownerColor(userId)` — deterministická barva z `userId` (malá paleta, `COLORS[userId % n]`),
  ať má jmenovka stabilní barvu. Čistě kosmetické.

`approve(item, categoryId)` už existuje (ř. 206) a volá `POST /api/email-inbox/:id/approve`
s `{ category_id }`. Tap na dlaždici ho zavolá přímo s `c.id`. Po úspěchu se položka
odebere ze seznamu (stávající chování `load()`).

CSS: přidat třídy do `client/src/index.css` (styly z odsouhlaseného mockupu — `.review-head`,
`.review-amt` v `--text2`, `.tiles-scroll`/`.review-grid` 2 sloupce + scroll, `.cat-tile`
min-height 58 px, `.cat-tile.suggested` accent ring, `.cat-dot`, `.who` pilulka). Použít
existující CSS proměnné (`--bg2/3`, `--border`, `--accent`, `--text2`, `--radius`).

## Backend — jméno majitele karty

Pending položka má v `parsed_json` pole `card_last4`. Potřebujeme k němu jméno člena,
kterému karta patří (tabulka `cards`).

Upravit `GET /api/email-inbox` (`src/routes/emailInbox.js`) — k řádku doplnit
`card_owner_name` a `card_owner_id` přes LEFT JOIN na `cards` (přes `json_extract`) a `users`:

```sql
SELECT i.id, i.received_at, i.raw_text, i.parsed_json, i.external_id,
       i.suggested_category_id, i.status, i.created_at,
       c.name AS suggested_category_name, c.color AS suggested_category_color,
       cu.id AS card_owner_id, cu.name AS card_owner_name
FROM email_inbox i
LEFT JOIN categories c ON c.id = i.suggested_category_id
LEFT JOIN cards cd ON cd.data_owner_id = i.user_id
                  AND cd.last4 = json_extract(i.parsed_json, '$.card_last4')
LEFT JOIN users cu ON cu.id = cd.assigned_user_id
WHERE i.user_id = ? AND i.status IN ('pending', 'unparsed')
ORDER BY i.created_at DESC, i.id DESC
```

`req.dataUserId` zůstává klíč. Pending položky s kartou už mají kartu přiřazenou
(nepřiřazené se drží jako `awaiting_card`, ne `pending`), takže `card_owner_name` bude
zpravidla vyplněné; u převodů (bez `card_last4`) je null → UI jmenovku skryje.

## Edge cases

- **Převod / platba bez karty**: `card_owner_name` null → jmenovka se nevykreslí.
- **Hodně kategorií**: scroll v `.tiles-scroll`; bez umělého limitu počtu.
- **Dlouhý název obchodu**: ellipsis na řádku 1 (název), částka má pevné místo vpravo.
- **Souběžný klik (busy)**: dlaždice `disabled` během `busy === item.id` (jako dnes tlačítko).

## Testy

- `src/routes/emailInbox.test.js` (nebo stávající test souboru): `GET /api/email-inbox`
  vrátí `card_owner_name`/`card_owner_id` pro pending položku s `card_last4` mapovaným
  v `cards`; null pro položku bez karty.
- Frontend nemá unit testy → ověření přes `npm run build` a vizuální kontrola. `orderedCats`
  je čistá funkce — pokud ji vytáhneme do modulu, lze přidat jednoduchý unit test (navržená
  první, null suggested → beze změny pořadí).

## Mimo rozsah

- Redesign ruční editace kategorie na TransactionsPage (jiná obrazovka).
- Seskupení dlaždic podle typu rozpočtu (varianta C — zamítnuto ve prospěch ploché mřížky).
- Ikony kategorií (kategorie mají jen barvu, ne ikonu).
