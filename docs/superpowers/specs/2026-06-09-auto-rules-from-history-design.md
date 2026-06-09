# Auto-návrh pravidel z historie transakcí

**Datum:** 2026-06-09
**Stav:** schváleno (přístup A)

## Cíl

Z historie kategorizovaných transakcí zpětně odvodit textová pravidla
(`category_rules`) a doplnit jimi tabulku pravidel. Snížit budoucí ruční
kategorizaci tím, že se naučíme z toho, jak už uživatel platby zařadil.

## Forma

Jednorázový Node skript s **náhledem ke schválení**:
- default = dry-run, vytiskne navržená pravidla, nic nezapíše;
- zápis do DB jen s `CONFIRM=1` (viz [[feedback_destructive_data_migrations]] —
  na prod data nikdy bez explicitního souhlasu uživatele).

Umístění: `scripts/suggest-rules-from-history.cjs`.

## Vstupní data

- Jméno obchodníka leží ve sloupci `transactions.description` (nejčistší forma).
  `place` = description + lokalita (šum pro analýzu), `note` = doplněk.
- Match v runtime (`apply-rules.js`, vrstva L3) skládá haystack =
  `description + note + place`, takže pattern stačí odvodit z `description`.
- Bereme jen `category_id IS NOT NULL` daného `user_id`.

## Algoritmus (přístup A — token-prefix + purity)

1. Normalizace: `trim`, collapse whitespace, na `description`.
2. Kandidátní patterny pro každou tx = první 1, 2, 3 slova.
3. Pro každý kandidát napříč celou historií spočítat:
   - `coverage` = počet tx, jejichž description **obsahuje** kandidát
     (case-insensitive substring, stejně jako runtime),
   - rozložení kategorií → `purity` = podíl dominantní kategorie.
4. Návrh vznikne, když `coverage >= MIN_TX` (default 3) **a**
   `purity >= PURITY` (default 0.90).
5. **Generalizace:** mezi překrývajícími se kandidáty preferovat nejkratší
   (nejobecnější) pattern, který práh splní (`MAX FITNESS` ne `MAX FITNESS LUZINY`).
6. **Dedup proti existujícím** pravidlům: kandidát, který už pokrývá nějaké
   existující pravidlo (jeho pattern je substring nového, nebo naopak), zahodit.
7. **Vynechat:**
   - kategorii interních převodů (`Převody`, id 117) — řeší L0, ne text;
   - amount podmínky (ruční nuance, mimo scope).

## Výstup (náhled)

Tabulka řádků: `pattern → kategorie | coverage X tx | purity Y % | [kolize]`.
Seřazeno podle coverage sestupně. Kolize (purity < 100 %) explicitně označit,
ať uživatel vidí, kde pattern občas spadl jinam.

## Zápis

S `CONFIRM=1`: `INSERT INTO category_rules (user_id, category_id, pattern)`
pro každý schválený návrh. Bez amount sloupců (NULL). Idempotence: před
insertem ověřit, že identický `(user_id, pattern)` ještě neexistuje.

## Mimo scope

- Amount-based pravidla.
- Spouštění z UI (zvážit později jako tlačítko na stránce Pravidla).
- Mapování AirBank kategorií (`airbank_category_mappings`).

## Parametry (env)

- `DB_PATH` (default `./data.db`)
- `USER_ID` (default = user s nejvíce kategorizovanými tx)
- `MIN_TX` (default 3), `PURITY` (default 0.90)
- `CONFIRM` (default off = dry-run)
