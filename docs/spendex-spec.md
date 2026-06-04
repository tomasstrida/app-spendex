# Spendex – Zadání pro Clauda při vývoji aplikace

> **Jak tento dokument používat:** Zkopíruj tento text jako systémový prompt nebo kontext na začátek konverzace s Claudem, když budeš vyvíjet Spendex. Claude tak bude mít přesný přehled o tom, co aplikace dělá, pro koho je a co musí umět.

---

## 1. Co je Spendex

Spendex je osobní finanční aplikace pro domácnost dvou partnerů – **Tomáše (Tom)** a **Martina**. Aplikace zpracovává bankovní transakce, kategorizuje výdaje a hlídá, zda domácnost nepřekračuje dohodnuté měsíční budgety v jednotlivých kategoriích.

Filozofie aplikace vychází z konceptu **„srdcovek"** (oblasti, do kterých má smysl vědomě investovat) a systému Finanční bilance 2.0 od Teorie Peněz. Cílem není jen šetřit – ale utrácet vědomě tam, kde to přináší radost a smysl, a hlídat ostatní kategorie.

---

## 2. Uživatelé

| Uživatel | Role | Příjem |
|----------|------|--------|
| **Tom** | OSVČ (živnostník) | ~140 000 Kč/měsíc čistý (fakturace ~150–190k bez DPH), variabilní |
| **Martin** | zaměstnanec / partner | ~20 000 Kč/měsíc čistý |
| **Sudo** | příjem z pronájmu bytu | 21 000 Kč/měsíc (fixní) |

**Celkový příjem domácnosti:** ~181 000 Kč/měsíc (variabilní – Tomovy příjmy kolísají)

---

## 3. Finanční struktura domácnosti

### 3.1 Pevné měsíční výdaje (nelze okamžitě zrušit)

| Položka | Měsíční částka | Poznámka |
|---------|---------------|----------|
| Nájem Stodola | 28 900 Kč | hlavní bydlení |
| Služby Stodola | 13 500 Kč | energie, správa |
| PRE Stodola | 3 500 Kč | elektřina |
| Fond oprav Sudo | 3 100 Kč | investiční byt |
| Auto – leasing/úvěr | 13 000 Kč | OSVČ Tom |
| Úvěr Buřinka | 6 500 Kč | investiční byt Sudo |
| Úvěr AirBank (OSVČ) | 15 000 Kč | podnikatelský úvěr |
| Telefony (3x) | 1 500 Kč | |
| Internet Stodola | 445 Kč | |
| PrEP (lék) | 600 Kč | Tom |
| Tramvajenky | 600 Kč | |
| Terapie | 13 000 Kč | oba dohromady |
| Cvičení Tom | 2 500 Kč | pravidelný trénink |
| **Licence celkem** | ~5 000–6 000 Kč | viz sekce 3.2 |
| ~~Sociální + zdravotní + záloha DPFO~~ | ~~33 500 Kč~~ | **Nepromítá se do rodinného rozpočtu** – viz sekce 6 |

### 3.2 Licence a předplatné

| Název | Platba | Částka/měsíc | Plátce | DPH |
|-------|--------|-------------|--------|-----|
| Recon (gay app) | ročně | ~158 Kč | Apple Tom | – |
| Growler | ročně | ~116 Kč | Apple Tom | – |
| Grinder společný | ročně | ~141 Kč | Apple Tom | – |
| Apple ONE (2TB, Music, Arcade, TV) | měsíčně | 449 Kč | Apple Martin | vyřešit |
| YouTube Premium | měsíčně | 359 Kč | Apple Martin | vyřešit |
| Google ONE | ročně | ~250 Kč | Google Tom | – |
| Romeo (gay app) | ročně | ~82 Kč | Apple oba | – |
| Lightroom Martin | měsíčně | 129 Kč | Apple Martin | – |
| Grinder Martin | měsíčně | 400 Kč | Apple Martin | – |
| Google (gayguys.cz) | měsíčně | 141 Kč | Google gayguys | – |
| Spendee | ročně | ~50 Kč | Apple Tom | – |
| M365 Microsoft | ročně | ~225 Kč | Microsoft Tom | ANO |
| Canva | ročně | ~275 Kč | bisek.martin | ANO |
| Mailchimp (gayguys.cz) | měsíčně | 500 Kč | martin@gayguys | – |
| Linktr.ee (gayguys) | měsíčně | 200 Kč | martin@gayguys | – |
| HBO/Netflix (Jiří) | ročně | ~117 Kč | – | – |

> ⚠️ **Poznámka:** Licence jsou kategorie, která se opakovaně překračuje – je třeba ji sledovat a upozorňovat zvlášť.

---

## 4. Budgety – tři typy výdajových kategorií

Spendex rozlišuje tři typy variabilních výdajů podle jejich přirozeného rytmu a předvídatelnosti. Každá kategorie patří právě do jednoho typu. Typ určuje, jak se category zobrazuje, jak se počítají alerty a odkud se financuje.

---

### Typ 1 – Měsíční budgety

Pravidelné výdaje s dohodnutým limitem na každý kalendářní měsíc.

**Zobrazení:** utraceno / limit + barevný indikátor + progress bar v rámci měsíce.
**Alert:** překročení limitu o >10 %.
**Financování:** z hlavního účtu.

| Kategorie | Měsíční budget | Poznámky |
|-----------|---------------|----------|
| **Jídlo** (nákupy, drogerie) | 20 000 Kč | opakovaně překračováno |
| **Auto / Moto** (PHM) | 11 000 Kč | sem nepatří servis ani leasing |
| **Sport** | 5 000 Kč | pravidelné tréninky, jednorázové vstupy |
| **Bydlení** (drobné nákupy pro dům) | 1 000 Kč | |
| **Oblečení** | 3 000 Kč | |
| **Zábava** | 4 500 Kč | kino, hry, koníčky |
| **Restaurace / kafíčka** | 10 000 Kč | historicky slabé místo, navýšen z 4 500 |
| **Dárky** | 1 000 Kč | |
| **Beauty** | 3 000 Kč | |
| **Terapie** | 3 000 Kč | zbytek je v pevných výdajích |
| **Tom osobní** | 1 000 Kč | |
| **Martin osobní** | 1 000 Kč | |

---

### Typ 2 – Roční / sezónní budgety (plánovaný spending schedule)

Výdaje s předvídatelným rytmem — sezonní nebo s opakovacím intervalem. Každá kategorie se dělí na **pojmenované podpoložky**, u nichž se dopředu definuje očekávaná částka a časové okno, kdy k platbě dojde. Tím vznikne **plán plateb na rok** a alert se vždy porovnává vůči tomuto plánu, ne vůči lineárnímu tempu.

**Příklad konfigurace „Sport roční":**
```
Beach volejbal – zimní sezona:   10 000 Kč,  říjen–leden
Beach volejbal – letní sezona:    6 000 Kč,  dubna–červen
Permanentka Tom (15h):            4 000 Kč,  každých 15 týdnů (opakovací)
```

**Alert logic:**
- Platba odpovídá naplánované podpoložce a vejde se do jejího budgetu → ✅ bez alertu
- Platba přichází mimo definované časové okno podpoložky → ⚠️ upozornění (nečekaný výdaj mimo sezonu)
- Platba překračuje budget podpoložky → 🔴 překročení
- Na konci roku zbývá velká nevyužitá část budgetu → informace (přehodnotit plán na příští rok)

**Zobrazení:** pro každou podpoložku zvlášť — utraceno / budget podpoložky + stav (zaplaceno / čeká / mimo okno).

**Financování:** z účtu „Nepravidelné výdaje", kam každý měsíc přichází pevný příspěvek.

| Roční kategorie | Roční budget | Měs. příspěvek | Podpoložky |
|-----------------|-------------|----------------|------------|
| **Sport roční** | ~45 000 Kč | 3 800 Kč | Beach zima, Beach léto, Permanentka |
| **Auto servis** | ~30 000 Kč | 2 500 Kč | Servis jaro, Servis podzim, Pneu, Rezerva |
| **Pojistky** | 7 200 Kč | 600 Kč | Dle konkrétních výročí pojistek |
| **Lítačka** | 7 200 Kč | 600 Kč | Roční kupón (1× ročně) |
| **Licence** | 60 000–72 000 Kč | 5 000–6 000 Kč | Viz sekce 3.2 – každé předplatné jako podpoložka |

---

### Typ 3 – Fond obnovy „Drahé věci"

Výdaje bez předvídatelného načasování — víme přibližně *kolik* a *jak často*, ale nevíme *kdy*. Typicky jednorázové velké výdaje s životním cyklem: brýle, telefon, notebook, oblečení co se opotřebuje.

**Definice kategorie:** očekávaná cena při výskytu + přibližná frekvence (např. 1× za 18 měsíců). Systém z toho odvodí doporučený měsíční příspěvek, ale **žádné časové okno nehlídá**.

**Alert logic:**
- Platba přijde kdykoliv → bez alertu na timing
- Platba výrazně překračuje očekávanou cenu (např. >150 %) → ⚠️ upozornění
- Více výskytů v roce než odpovídá frekvenci → ⚠️ upozornění

**Zobrazení:** ne progress bar, ale stav fondu — *„naspořeno X Kč, naposledy čerpáno před N měsíci, typická cena Y Kč"*.

**Financování:** také z účtu „Nepravidelné výdaje".

| Fond obnovy | Typická cena | Frekvence | Měs. příspěvek |
|-------------|-------------|-----------|----------------|
| **Brýle / optika** | 8 000 Kč | ~1× za 18 měs. | ~450 Kč |
| **Telefon** | 25 000 Kč | ~1× za 3 roky | ~700 Kč |
| **Notebook / technika** | 40 000 Kč | ~1× za 4 roky | ~830 Kč |
| *(další dle potřeby)* | | | |

> 💡 Kategorie „Drahé věci" z Finanční bilance Teorie Peněz = Typ 3 ve Spendexu.

---

### 4.4 Zobrazení stavu budgetů v aplikaci

Všechny tři typy se zobrazují v jednom přehledu, každý s vlastní logikou:

```
TYP 1 – MĚSÍČNÍ  (referenční rámec: aktuální měsíc)
  Jídlo          15 200 / 20 000 Kč   76 %   ✅
  Restaurace      9 800 / 10 000 Kč   98 %   ⚠️
  Auto/Moto       7 400 / 11 000 Kč   67 %   ✅

TYP 2 – ROČNÍ / SEZÓNNÍ  (referenční rámec: plán plateb)
  Sport roční
    └ Beach zima    10 000 / 10 000 Kč   zaplaceno leden   ✅
    └ Beach léto         0 /  6 000 Kč   čeká (duben–červen)
    └ Permanentka    4 000 /  4 000 Kč   zaplaceno únor    ✅
  Auto servis
    └ Servis jaro        0 /  8 000 Kč   čeká (březen–duben)
    └ Servis podzim      0 /  8 000 Kč   čeká (září–říjen)

TYP 3 – FOND OBNOVY „DRAHÉ VĚCI"
  Brýle / optika    naspořeno 3 600 Kč  │ typická cena 8 000 Kč  │ naposledy: 8 měs. zpět
  Telefon           naspořeno 5 600 Kč  │ typická cena 25 000 Kč │ naposledy: 14 měs. zpět
```

---

## 5. Srdcovky (vědomé utrácení – co dává smysl)

Srdcovky jsou oblasti, kam chceme vědomě investovat více a kde **nechceme škrtat**. Vycházejí z workshopu Teorie Peněz.

### Tomovy srdcovky
1. **Sport / golf** – golf s Martinem, beach volejbal
2. **Zpěv** – tréninky zpěvu, nahrávací technika, ohlučněná místnost
3. **Technika** – střih videa, AI nástroje, SW

### Martinovy srdcovky
1. **Cestování / bydlení** – golfová dovolená, surfing, kvalitní ubytování
2. **Setkávání s přáteli** – aktivity, společné výlety
3. **Technika a vybavení** – počítač, hodinky, vybavení pro práci a sport

### Co naopak nepotřebujeme
- Tomovi: značkové oblečení, společenský status, kluby
- Martinovi: obecně přepražené věci, předražené oblečení

---

## 6. Příjmy a účty

### Struktura účtů (zjednodušeně)

| Účet | Použití |
|------|---------|
| **Hlavní společný účet** | příjmy domácnosti, výdaje, trvalé příkazy |
| **OSVČ účet Tom** | fakturace klientů; odtud se hradí DPH, sociální, zdravotní, záloha DPFO, splátka AirBank – **do rodinného rozpočtu přichází pouze čistý zbytek** |
| **Daňový / odkladový účet** | rezerva na DPH, zálohy na daň, sociální a zdravotní – tyto prostředky **nejsou součástí rodinného cashflow** |
| **Účet „Nepravidelné výdaje"** | dedikovaný účet pro roční kategorie (sekce 4.2); každý měsíc sem přichází pevný příspěvek, výdaje se strhávají dle potřeby – Spendex sleduje zůstatek a čerpání per kategorie |
| **Spořící účet** | krátkodobá rezerva (cíl: 3× měsíční výdaje) |
| **Investiční byt Sudo** | příjmy z nájmu 21 000 Kč, výdaje na fond oprav, splátky Buřinka |

### Příjem z OSVČ – jak funguje

> ⚠️ **Klíčové pravidlo:** Podnikatelské výdaje jsou plně odděleny od rodinného rozpočtu. Spendex pracuje **výhradně s čistým příjmem**, který přichází na hlavní účet. DPH, zálohy na daň, sociální a zdravotní pojištění jsou zachyceny na separátním účtu a do rodinného přehledu **nevstupují**.

1. Tom fakturuje klientům (cca 150–190k Kč bez DPH)
2. Z OSVČ účtu se automaticky odvádí:
   - **DPH** – měsíčně (Tom je měsíční plátce)
   - **Sociální pojištění** – záloha ~14 000 Kč/měsíc
   - **Zdravotní pojištění** – záloha ~6 500 Kč/měsíc
   - **Záloha na DPFO** – ~13 000 Kč/měsíc
   - **Splátka AirBank (OSVČ úvěr)** – 15 000 Kč/měsíc
3. **Zbytek přechází na hlavní rodinný účet** jako čistý příjem (~140 000 Kč, variabilní)
4. Spendex sleduje pouze transakce na hlavním účtu a Sudo účtu – OSVČ účet je mimo scope rodinného rozpočtu

---

## 7. Logika hlídání budgetů (co Spendex musí umět)

### 7.1 Základní pravidla alertů

| Stav | Podmínka | Co zobrazit |
|------|----------|-------------|
| ✅ OK | realita ≤ budget | zelená, klidný stav |
| ⚠️ Pozor | realita > budget o 1–10 % | žlutá, upozornění |
| 🔴 Překročeno | realita > budget o >10 % | červená, výrazné upozornění |

> **Filozofie:** Překročení o méně než 10 % se po dobu nastavování (první 3–4 měsíce) nepovažuje za problém – jen se méně uspoří. Teprve překročení >10 % vyžaduje diskusi.

### 7.2 Průběžný stav v měsíci – vizualizace teploměrem

Každá měsíční kategorie (Typ 1) zobrazuje průběžný stav pomocí **teploměru**:

- **Rtuť teploměru** = aktuálně utracená částka (jako % z měsíčního budgetu)
- **Svislá čárka na teploměru** = aktuální den v měsíci (jako % z počtu dní v měsíci)

Vizuální logika:
```
Budget: 10 000 Kč   │  Dnes: 15. dubna (50 % měsíce)

[████████████░░░░░░░░│░░░░░░░░░░]
 0        6 200     │        10 000 Kč
          62 %      50%
           ↑         ↑
        rtuť        čárka (dnešní datum)
```

Pokud je **rtuť vlevo od čárky** (utrácíme méně, než odpovídá tempu měsíce) → ✅ klidný stav.
Pokud je **rtuť vpravo od čárky** (utrácíme rychleji, než odpovídá tempu) → ⚠️ pozor, tempo je vyšší.
Pokud **rtuť dosáhne konce** (100 % budgetu) → 🔴 překročeno, bez ohledu na datum.

Doplňkově se zobrazuje **lineární projekce do konce měsíce:**
`projekce = utraceno_dnes / dny_uplynulé × dny_v_měsíci`

Příklad: utraceno 6 200 Kč za 15 dní → projekce na konec měsíce = 12 400 Kč → o 2 400 Kč nad budget.

> **Implementační poznámka:** Teploměrová vizualizace platí pouze pro **Typ 1 (měsíční)**. Typ 2 a Typ 3 mají vlastní zobrazení popsané v sekci 4.

### 7.3 Specifická pravidla pro kategorie

- **Restaurace:** historicky silně překračována (původní budget 4 500 Kč, realita 8–12k) → navýšen na 10 000 Kč. Sledovat pečlivě.
- **Jídlo:** občas překračováno, zvláště v lednu. Budget 20 000 Kč.
- **Oblečení:** nenakupuje se každý měsíc, ale nárazově. Vhodné sledovat rolling 3-měsíční průměr nebo kumulativní roční budget.
- **Licence:** problematická kategorie, opakovaně překračována. Sledovat zvlášť s přehledem jednotlivých předplatných a jejich výročí.
- **Dárky:** nárazové, typicky překročeny v listopadu/prosinci (Vánoce).

### 7.4 Měsíční přehled / „měsíční schůzka"

Po konci každého měsíce by aplikace měla připravit **kompletní přehled pro měsíční finanční schůzku**. Přehled musí zobrazovat celý finanční obraz – nejen výdaje, ale i příjmy a výslednou bilanci.

**Struktura měsíčního přehledu:**

```
PŘÍJMY
  Tom (čistý příjem z OSVČ)         xxx Kč   [plán: ~140 000 Kč]
  Martin (čistá mzda)                xxx Kč   [plán: ~20 000 Kč]
  Sudo (nájem)                       xxx Kč   [plán: 21 000 Kč]
  ─────────────────────────────────────────
  Příjmy celkem                      xxx Kč

PEVNÉ VÝDAJE
  Nájem + služby Stodola             xxx Kč
  Splátky úvěrů (Buřinka, auto)      xxx Kč
  Terapie, cvičení, předplatné       xxx Kč
  ... (ostatní trvaláky)
  ─────────────────────────────────────────
  Pevné výdaje celkem                xxx Kč

VARIABILNÍ VÝDAJE (budgety)
  Jídlo          realita / budget    xxx / 20 000 Kč  ✅/⚠️/🔴
  Restaurace     realita / budget    xxx / 10 000 Kč  ✅/⚠️/🔴
  Auto/Moto      realita / budget    ...
  ...
  ─────────────────────────────────────────
  Variabilní výdaje celkem           xxx Kč

BILANCE MĚSÍCE
  Příjmy celkem                      xxx Kč
  − Výdaje celkem                    xxx Kč
  ═════════════════════════════════════════
  Naspořeno / proinvestováno         xxx Kč
  Stav spořícího účtu (k datu)       xxx Kč
```

**Kontrolní otázky pro schůzku:**
1. Přišly všechny příjmy? (Tom OSVČ, Martin, Sudo)
2. Odešly všechny trvalé platby?
3. Jak byly plněny budgety? (přehled kategorie po kategorii)
4. Celková bilance – kolik bylo naspořeno?
5. Co změnit na příští měsíc?

---

## 8. Kategorizace transakcí

Bankovní transakce přicházejí jako surová data. Spendex je musí zařadit do kategorií.

### Příklady mapování kategorií

| Bankovní popis / obchodník | Kategorie Spendex |
|----------------------------|-------------------|
| Albert, Billa, Lidl, Tesco, Rohlík, Košík | Jídlo |
| Shell, OMV, MOL, Benzina | Auto/Moto |
| Restaurace, kavárny, Deliveroo, Wolt, Bolt Food | Restaurace |
| Decathlon, SportisimO, Nike, golf obchody | Sport |
| Zara, H&M, Zalando, Vinted | Oblečení |
| Netflix, HBO, Steam, kino | Zábava |
| Lékárna, Dr.Max | Léky |
| Pojišťovna | Pojistky |
| Apple, Google Play | Licence |
| Microsoft | Licence (DPH) |
| Spendee | Licence |

> **Důležité:** Kategorizace bude vždy potřebovat manuální opravy. Aplikace musí umožnit jednoduché přeřazení transakce do jiné kategorie a „zapamatovat si" toto pravidlo do budoucna.

---

## 9. Technické požadavky a integrace

### 9.1 Zdroje dat
- **Primární vstup:** bankovní výpisy (CSV/API z české banky – AirBank, případně Fio nebo Revolut)
- Tom má více účtů: hlavní (AirBank), OSVČ (AirBank nebo jiný)
- Potenciálně: Revolut pro zahraniční platby

### 9.2 Klíčové funkce (MVP)
1. Import bankovních transakcí (CSV nebo API)
2. Automatická kategorizace transakcí s možností manuální korekce; systém si pamatuje pravidla
3. Každá kategorie má přiřazený typ: **Typ 1** (měsíční), **Typ 2** (roční/sezónní), nebo **Typ 3** (fond obnovy) — nelze kombinovat
4. **Typ 1:** přehled utraceno / limit za aktuální měsíc, alert při překročení >10 %
5. **Typ 2:** konfigurace podpoložek se spending schedule (částka + časové okno); alert při platbě mimo okno nebo nad budget podpoložky
6. **Typ 3:** konfigurace fondu (typická cena + frekvence); zobrazení stavu naspořené rezervy; alert pouze při výrazném překročení typické ceny nebo neočekávané frekvenci
7. Průběžná vizualizace teploměrem pro Typ 1 kategorie — rtuť = utraceno, čárka = aktuální den v měsíci, projekce do konce měsíce (viz sekce 7.2)
8. Měsíční souhrn s kompletním obrazem (příjmy + pevné výdaje + variabilní budgety) — viz sekce 7.4
9. Přehled licencí s výročím platby (podpoložky Typu 2)
10. Oddělené sledování: společné výdaje vs. osobní (Tom / Martin)

### 9.3 Nice-to-have
- Historické srovnání (tento měsíc vs. průměr posledních 3/6 měsíců)
- Upozornění na blížící se roční platby (licence, pojistky, servis)
- Přehled dluhů a splátkového kalendáře (Buřinka, AirBank, auto)
- Stav spořícího účtu a cíl železné rezervy (min. 3× měsíční výdaje)

---

## 10. Kontext a filozofie pro vývoj

Tato aplikace není jen „evidence výdajů". Je to nástroj pro **vědomé finanční rozhodování** dvojice, která:
- Má vysoký, ale variabilní příjem (OSVČ)
- Chce si dovolit své srdcovky bez výčitek
- Potřebuje mít pod kontrolou „unáhlené" kategorie (restaurace, licence)
- Dělá pravidelné měsíční finanční schůzky jako pár
- Pracuje s metodologií Teorie Peněz (Finanční bilance 2.0)

**Tón a UX aplikace** by měly být klidné, přehledné a nestigmatizující – aplikace není „policajt na výdaje", ale pomocník k lepšímu rozhodování.

---

## 11. Otevřené otázky / TODO

- [ ] Jak přesně funguje import z AirBank? (CSV export, nebo API?)
- [x] ~~Jsou transakce z OSVČ účtu odděleny od osobního?~~ → **Ano, OSVČ účet je mimo scope Spendexu. Do rodinného přehledu vstupuje pouze čistý převod na hlavní účet.**
- [ ] Chceme sledovat stav dluhů automaticky, nebo ručně?
- [ ] Jak řešit výdaje placené z Revolut vs. české banky?
- [ ] Chceme mobilní app, webovou aplikaci, nebo desktop?
- [ ] Přihlašování / více profilů (Tom vs. Martin), nebo sdílený pohled?
- [ ] Jak zacházet s dárky a licencemi, které se platí nárazově – roční kumulace?

---

*Dokument vygenerován na základě finančních podkladů domácnosti (Finance Martin Tom.xlsx, Financni Bilance Teoriepenez.xlsx, Utraceni vize PDFs). Aktualizuj ho, jak se situace mění.*
