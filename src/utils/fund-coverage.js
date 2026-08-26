'use strict';
const { normCounterparty } = require('./income');

/**
 * Čisté pohyby na fondovém účtu za období.
 *
 * Na rozdíl od spořicího účtu (viz utils/savings.js) se tady NEDEDUPLIKUJE. Skutečný
 * invariant: každý pohyb na fondu má vlastní řádek s `account_id` = fond, takže dotaz
 * `WHERE account_id = ?` z principu nemůže vrátit tutéž transakci dvakrát (na rozdíl od
 * dotazu tvaru `account_id = X OR counterparty_account = X`, kde dedup u spoření řeší
 * právě dvojí započtení). Riziko tady NENÍ duplicita, ale opak — CHYBĚJÍCÍ noha: pohyb
 * zachycený jen jako protistrana na jiném účtu, který by tenhle dotaz neviděl vůbec.
 * Kdyby taková noha chyběla, projeví se to rozjetím dopočtené křivky vůči snapshotům
 * v grafu.
 */
function fundMovements(db, userId, accountId, start, end) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS net
    FROM transactions
    WHERE user_id = ? AND account_id = ? AND date >= ? AND date <= ?
  `).get(userId, accountId, start, end);
  return row.net;
}

/**
 * Nejnovější snapshot zůstatku na účtu napříč CELOU historií (i mimo zobrazený
 * rozsah) — kotva pro dopočet. `null`, když účet nemá ani jeden snapshot.
 */
function fundAnchor(db, userId, accountId) {
  const row = db.prepare(`
    SELECT date, balance_after FROM transactions
    WHERE user_id = ? AND account_id = ? AND balance_after IS NOT NULL
    ORDER BY date DESC, COALESCE(tx_time, '') DESC, id DESC
    LIMIT 1
  `).get(userId, accountId);
  return row ? { date: row.date, balance: row.balance_after } : null;
}

/**
 * Roční plán fondu, letošní čerpání a kolik z plánu ještě zbývá.
 *
 * Počítá se PER KATEGORII, ne per podpoložku: plán kategorie je součet jejích
 * podpoložek, čerpání je celoroční součet jejích plateb. Důvod je věcný — kategorie
 * s víc podpoložkami má typicky překrývající se okna (Y_Sport má čtyři položky, všechny
 * 1–12) a per-položkový výpočet by tutéž platbu odečetl od každé z nich. Na reálných
 * datech to dělalo rozdíl 18 500 Kč v jediné kategorii, vždy směrem k optimismu.
 *
 * `spent` se ZÁMĚRNĚ neořezává na plán: „vyčerpáno z ročního plánu" má ukazovat
 * skutečnost (Y_Auto Moto: 37 428 z plánu 30 000), zatímco `remaining` je floorované
 * na nule, protože přečerpaná kategorie už z fondu nic nechce.
 *
 * ZNÁMÉ OMEZENÍ — propadlá okna: kategorie okno nemá, má ho až podpoložka, takže
 * nevyčerpaná položka po konci svého okna zůstane v `remaining` až do konce roku.
 * Číslo je tím konzervativnější (ukáže hůř než realita). Vědomě ponecháno: vyloučit
 * je nejde bez návratu k per-položkovému počítání, které má horší vadu.
 *
 * ZNÁMÉ OMEZENÍ — účet: čerpání se váže na `category_id`, ne na `account_id`, takže
 * platba kategorie navázané na fond, ale provedená z JINÉHO účtu, sníží `remaining`,
 * aniž ten fond cokoli zaplatil (viz spec §2, Y_Oblečení: z fondu odešlo 298 Kč
 * z 15 042). Neopravovat: vázat čerpání na účet by rozešlo číslo se stránkou Roční
 * budgety, která `account_id` taky nefiltruje.
 *
 * `today` se předává (formát 'YYYY-MM-DD'), ne bere z Date.now() — testovatelnost.
 */
function fundRemaining(db, userId, accountId, today) {
  const year = Number(today.slice(0, 4));

  // JOIN na accounts: osiřelý `fund_account_id` (účet mezitím smazaný — SQLite neumí
  // FK přidat přes ALTER TABLE) se tím chová jako NULL, tedy kategorie mimo fond.
  const rows = db.prepare(`
    SELECT c.id AS category_id, c.name AS category_name,
           COALESCE(SUM(bi.amount), 0) AS plan
    FROM categories c
    JOIN accounts a ON a.id = c.fund_account_id AND a.user_id = c.user_id AND a.is_fund = 1
    LEFT JOIN budget_items bi ON bi.category_id = c.id AND bi.user_id = c.user_id
    WHERE c.user_id = ? AND c.fund_account_id = ? AND c.type = 2
    GROUP BY c.id
  `).all(userId, accountId);

  const spentStmt = db.prepare(`
    SELECT COALESCE(SUM(-amount), 0) AS spent
    FROM transactions
    WHERE user_id = ? AND category_id = ? AND date >= ? AND date <= ?
  `);

  const categories = rows.map(r => {
    const { spent } = spentStmt.get(userId, r.category_id, `${year}-01-01`, `${year}-12-31`);
    return {
      category_id: r.category_id,
      category_name: r.category_name,
      plan: r.plan,
      spent,
      remaining: Math.max(0, r.plan - spent),
    };
  });
  // Největší zbytek nahoře — to je to, co uživatele na fondu čeká nejvíc.
  categories.sort((a, b) => b.remaining - a.remaining || a.category_name.localeCompare(b.category_name, 'cs'));

  return {
    plan: categories.reduce((s, c) => s + c.plan, 0),
    spent: categories.reduce((s, c) => s + c.spent, 0),
    remaining: categories.reduce((s, c) => s + c.remaining, 0),
    categories,
  };
}


/**
 * Očekávané dotace na fond od PŘÍŠTÍHO měsíce do konce roku.
 *
 * Fond není statická hromádka — každý měsíc na něj chodí dotace z běžného účtu.
 * Bez nich karta straší schodkem, který ve skutečnosti není: Nepravidelné vychází
 * v srpnu na −73 tis., ale do prosince na něj ještě přijde 80 800 Kč.
 *
 * Cíl dotace se ODVOZUJE Z HISTORIE (rozhodnutí uživatele): u fixní platby se najdou
 * její odchozí platby a když většina mířila na tenhle fond, je to dotace na něj.
 * Číslo protiúčtu má přednost před textem — stejné pořadí jako matcher Schůzky.
 * Ověřeno na produkčních datech: každá z devíti dotací míří jednoznačně na jeden účet
 * a „Dotace na VELKÉ RADOSTI" se sama vyřadí, protože její cíl fondový účet není.
 *
 * PŘIZNANÉ NEPŘESNOSTI:
 *  - Aktuální měsíc se nepočítá. Jeho dotace už na účtu typicky jsou (vidí je zůstatek);
 *    kdyby některá ještě nepřišla, číslo ji nezachytí — chyba míří k horšímu, ne k lepšímu.
 *  - Dotace bez jediné proběhlé platby se nenajde: není z čeho odvodit cíl. To je cena
 *    za odvozování místo explicitní vazby; zapojí se po prvním měsíci.
 *  - U `frequency_months > 1` se počítá `floor(zbývající měsíce / frekvence)` — bez
 *    znalosti fáze cyklu je to odhad. Všechny dnešní dotace jsou měsíční.
 */
function fundSubsidies(db, userId, accountId, today) {
  const account = db.prepare(
    'SELECT account_number FROM accounts WHERE id = ? AND user_id = ? AND is_fund = 1'
  ).get(accountId, userId);
  if (!account) return { total: 0, items: [] };
  const fundNumber = normCounterparty(account.account_number);
  if (!fundNumber) return { total: 0, items: [] };

  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));

  const fixed = db.prepare(
    'SELECT id, name, amount, match_pattern, match_counterparty_account, frequency_months, valid_from, valid_to FROM fixed_expenses WHERE user_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(userId);

  // Odchozí platby se načtou jednou a matchování běží v JS: číslo účtu se musí
  // porovnávat přes normCounterparty (exact, číslice před `/`), což SQL neumí čistě.
  const outgoing = db.prepare(
    'SELECT amount, description, note, place, counterparty_account FROM transactions WHERE user_id = ? AND amount < 0'
  ).all(userId);

  const items = [];
  for (const f of fixed) {
    const byAccount = normCounterparty(f.match_counterparty_account);
    const matches = outgoing.filter(t => {
      if (byAccount) return normCounterparty(t.counterparty_account) === byAccount;
      if (!f.match_pattern) return false;
      const p = f.match_pattern;
      return [t.description, t.note, t.place].some(v => v && v.indexOf(p) >= 0);
    });
    if (!matches.length) continue;   // bez historie cíl neodvodíme

    // Kam mířila většina — jedna zatoulaná platba nesmí přepsat celý řádek.
    const tally = new Map();
    for (const t of matches) {
      const cp = normCounterparty(t.counterparty_account);
      if (cp) tally.set(cp, (tally.get(cp) || 0) + 1);
    }
    let best = null, bestN = 0;
    for (const [cp, n] of tally) if (n > bestN) { best = cp; bestN = n; }
    if (best !== fundNumber) continue;

    // Zbývající měsíce roku od PŘÍŠTÍHO, s respektem k oknu platnosti.
    let months = 0;
    for (let m = month + 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      if (f.valid_from && f.valid_from > key) continue;
      if (f.valid_to && f.valid_to < key) continue;
      months++;
    }
    const freq = f.frequency_months > 1 ? f.frequency_months : 1;
    const occurrences = Math.floor(months / freq);
    if (occurrences <= 0) continue;

    items.push({
      fixed_expense_id: f.id,
      name: f.name,
      amount: f.amount,
      months: occurrences,
      total: f.amount * occurrences,
    });
  }

  return { total: items.reduce((s, i) => s + i.total, 0), items };
}

module.exports = { fundMovements, fundAnchor, fundRemaining, fundSubsidies };
