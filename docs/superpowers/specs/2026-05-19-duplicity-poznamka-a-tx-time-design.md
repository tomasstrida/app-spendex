# Duplicity: pole „poznámka" + tx_time rozlišuje duplicity

**Datum:** 2026-05-19
**Soubory:** `src/utils/duplicates.js`, `src/utils/duplicates.test.js`, `client/src/pages/DuplicatesPage.jsx`
**Kontext:** Drobná úprava featury „Hledáč duplicit". Dvě nezávislé změny.

## Problém

1. Řádek duplicity nezobrazuje `note` (poznámku transakce) — chybí kontext pro posouzení.
2. „Možné" duplicity (klíč `date+description+amount+account_id`) označí i dvě legitimní stejnodenní platby stejné částky u stejného obchodníka, i když proběhly v **jiný čas**. Uživatel chce: různý `tx_time` ⇒ nejsou duplicitní.

## Rozhodnutí (potvrzeno uživatelem)

- Pravidlo tx_time se aplikuje **jen na „Možné"**. „Pravděpodobné" (stejný AirBank `rawRef` + účet) zůstává beze změny — stejný ref = táž transakce z definice.
- **Chybějící čas = různý (od všeho).** Pokud `tx_time` je NULL/prázdný, řádek se nikdy neseskupí — ani s jiným NULL řádkem. Tj. do „Možné" se dostanou jen skupiny ≥2 řádků se **shodným neprázdným** `tx_time` (a shodným date+description+amount+account).
- Pojistka mazání (`wouldEmptyDuplicateGroup`) se srovná se stejnou definicí skupiny (vč. tx_time, NULL = unikát).
- „poznámka" se přidá jako další sloupec (aditivní), nic se nenahrazuje.

## Změny

### Backend — `src/utils/duplicates.js`

**`findDuplicates`:**
- SELECT doplnit o `t.note`.
- `prob` klíč beze změny (`${rr}|${account_id ?? null}`).
- `poss` klíč rozšířit o tx_time s NULL-jako-unikát sémantikou:
  ```js
  const timeKey = r.tx_time ? r.tx_time : `NIL:${r.id}`;
  pushTo(poss, `${r.date}|${r.description}|${r.amount}|${r.account_id ?? null}|${timeKey}`, r);
  ```
  `NIL:${r.id}` zaručí, že každý řádek bez `tx_time` má unikátní klíč → nikdy se neseskupí (ani dva NULL spolu). Řádky se shodným neprázdným `tx_time` se seskupí jako dosud.
- Řádky ve výstupu nově obsahují `note` (a stávající `ref`, `tx_time`).

**`wouldEmptyDuplicateGroup`** (pojistka — musí odpovídat nové definici „Možné" skupiny):
- Řádek s NULL/prázdným `tx_time` není členem žádné chráněné skupiny (dle nového pravidla je vždy unikát) → takový řádek lze vždy smazat: ve smyčce přeskočit (`if (!r.tx_time) continue;`).
- Skupinový dotaz rozšířit o `AND tx_time = ?` (neprázdné), tj. skupina = `date+description+amount+account_id+tx_time`. Blokuje jen smazání **všech** řádků vícečlenné skupiny se shodným neprázdným časem.

### Frontend — `client/src/pages/DuplicatesPage.jsx`

V `GroupCard` přidat sloupec **poznámka** (`row.note`) do legendy i datového řádku, konzistentně se stávajícími sloupci (fixní šířka + ellipsis + `title`, vzor jako `ref`/`external_id`). Umístění: za „popis" část je řádek úzký; vlož „poznámka" jako samostatný sloupec mezi `částka` a `AirBank ref` (nebo za `ext. ID`) — konkrétně **mezi `zdroj` a `čas transakce`**, aby nerozbíjel zarovnání číselných sloupců. Šířka ~160, ellipsis, `title={row.note}`. Záhlaví: „poznámka".

## Testy — `src/utils/duplicates.test.js`

Doplnit testy (reuse `freshDb`/`cleanup`/`ins`; pozn.: `ins` helper možná nevkládá `note`/`tx_time` — pro nové testy použít přímý `db.prepare(INSERT ...)` se všemi potřebnými sloupci):

1. **Různý tx_time → ne „Možné":** dvě tx shodné date+desc+amount+account, různý `tx_time` → `possible` neobsahuje skupinu (length 0).
2. **Shodný neprázdný tx_time → „Možné":** dvě tx vše shodné vč. `tx_time` → 1 skupina, 2 řádky.
3. **Oba NULL tx_time → ne „Možné":** dvě tx shodné, `tx_time` NULL u obou → `possible` length 0 (NULL = unikát).
4. **note ve výstupu:** řádky `possible`/`probable` mají `note` rovné vloženému.
5. **Pojistka s tx_time:** dvě tx shodné vč. neprázdného `tx_time` (skupina) → `wouldEmptyDuplicateGroup(ids=oba)` true; dva NULL-tx_time řádky shodné jinak → `wouldEmptyDuplicateGroup(ids=oba)` false (NULL = vždy smazatelné, nejsou skupina).
6. **Probable beze změny:** stávající probable test musí dál procházet (tx_time se do prob klíče nepřidává).

Stávající testy musí zůstat zelené (pozn.: pokud některý stávající `possible` test nevkládal `tx_time` → po změně by NULL=unikát rozbil jeho očekávání; takové testy upravit tak, aby vkládaly shodný neprázdný `tx_time`, aby ověřovaly zamýšlené chování — a doplnit komentář proč).

## Mimo rozsah (YAGNI)

- Žádná změna „Pravděpodobné" detekce.
- Žádné parsování/normalizace formátu `tx_time` (porovnává se string rovnost, jak přichází z CSV).
- Žádná konfigurovatelnost sloupců.

## Dopad / rizika

- Zúžení „Možné" (méně false-positive) je přesně záměr; reálné duplicity (stejný čas) se dál chytají, „Pravděpodobné" (stejný ref) je nedotčené a chytá import-duplicity i bez tx_time.
- Riziko: stávající `possible` testy bez `tx_time` — ošetřeno v sekci Testy (upravit, ne oslabit).
- API tvar zpětně kompatibilní (přidané pole `note`).
