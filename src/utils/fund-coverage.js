'use strict';

/**
 * Čisté pohyby na fondovém účtu za období.
 *
 * Na rozdíl od spořicího účtu (viz utils/savings.js) se tady NEDEDUPLIKUJE:
 * u fondových účtů jsou všechny nohy převodů zaúčtované přímo na fondu, takže
 * filtr na `account_id` každý pohyb vrátí právě jednou. Ověřeno na produkčních
 * datech — dotaz „účet i protiúčet je tentýž fond" vrací nula řádků.
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
    JOIN categories c ON c.id = bi.category_id AND c.user_id = bi.user_id
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
