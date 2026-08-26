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
 * Datové okno podpoložky pro daný rok. Cross-year okno (window_start > window_end,
 * např. 10–1) končí v NÁSLEDUJÍCÍM roce — stejný výpočet jako routes/budget-items.js,
 * aby čísla seděla se stránkou Roční budgety.
 */
function itemWindow(item, year) {
  const toYear = item.window_start > item.window_end ? year + 1 : year;
  const lastDay = new Date(toYear, item.window_end, 0).getDate();
  return {
    from: `${year}-${String(item.window_start).padStart(2, '0')}-01`,
    to: `${toYear}-${String(item.window_end).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

/**
 * Kolik z fondu ještě letos odejde: součet nevyčerpaného plánu AKTIVNÍCH podpoložek
 * kategorií navázaných na tento fond.
 *
 * Aktivní = konec datového okna ještě nenastal. Uplynulá nevyčerpaná položka se
 * ignoruje (rozhodnutí uživatele): buď se výdaj nekonal, nebo šel jinudy, a počítat
 * ho by krytí zbytečně strašilo.
 *
 * Čerpání se bere V OKNĚ položky, ne za celý rok — kategorie může mít víc položek
 * s různými okny (Lítačka Tom 4–5 vs. Martin 8–9) a roční součet by je slil dohromady.
 *
 * ZNÁMÉ OMEZENÍ: u kategorie s víc položkami, jejichž okna se PŘEKRÝVAJÍ, se tatáž
 * platba odečte od každé z nich, takže krytí vyjde optimističtěji než realita. Přesně
 * by to řešila jen vazba transakce → podpoložka, kterou datový model nemá; stejnou
 * nepřesnost má i stránka Roční budgety.
 *
 * DALŠÍ ZNÁMÉ OMEZENÍ: `spentStmt` váže platbu na `category_id`, ne na `account_id` —
 * platba kategorie navázané na fond, ale provedená z JINÉHO účtu, sníží `remaining`,
 * aniž ten fond cokoli zaplatil (viz spec §2, Y_Sport). Neopravovat: vázat `spent` na
 * účet by rozešlo číslo se stránkou Roční budgety, která `account_id` taky nefiltruje.
 *
 * `today` se předává (formát 'YYYY-MM-DD'), ne bere z Date.now() — testovatelnost.
 */
function fundRemaining(db, userId, accountId, today) {
  const year = Number(today.slice(0, 4));

  // JOIN na accounts: osiřelý `fund_account_id` (účet mezitím smazaný — SQLite neumí
  // FK přidat přes ALTER TABLE) se tím chová jako NULL, tedy kategorie mimo fond.
  const items = db.prepare(`
    SELECT bi.id, bi.category_id, bi.name, bi.amount, bi.window_start, bi.window_end,
           c.name AS category_name
    FROM budget_items bi
    JOIN categories c ON c.id = bi.category_id AND c.user_id = bi.user_id AND c.type = 2
    JOIN accounts a ON a.id = c.fund_account_id AND a.user_id = c.user_id AND a.is_fund = 1
    WHERE bi.user_id = ? AND c.fund_account_id = ?
    ORDER BY bi.window_start, bi.id
  `).all(userId, accountId);

  const spentStmt = db.prepare(`
    SELECT COALESCE(SUM(-amount), 0) AS spent
    FROM transactions
    WHERE user_id = ? AND category_id = ? AND date >= ? AND date <= ?
  `);

  const out = [];
  for (const item of items) {
    const w = itemWindow(item, year);
    if (w.to < today) continue;   // okno uplynulo → ignoruj
    const { spent } = spentStmt.get(userId, item.category_id, w.from, w.to);
    out.push({
      budget_item_id: item.id,
      category_id: item.category_id,
      category_name: item.category_name,
      name: item.name,
      amount: item.amount,
      spent,
      remaining: Math.max(0, item.amount - spent),
      window_from: w.from,
      window_to: w.to,
    });
  }

  return { remaining: out.reduce((s, i) => s + i.remaining, 0), items: out };
}

module.exports = { fundMovements, fundAnchor, fundRemaining, itemWindow };
