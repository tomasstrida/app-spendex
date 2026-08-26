'use strict';

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

module.exports = { fundMovements, fundAnchor, fundRemaining };
