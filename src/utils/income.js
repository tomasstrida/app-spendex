'use strict';
const { getPeriodDates } = require('./period');
const { incomeStatus } = require('./recurring');

/**
 * Normalizuje counterparty_account: vezme jen číslice před `/`.
 * Vrátí null pokud vstup prázdný nebo se nepodaří extrahovat číslo.
 */
function normCounterparty(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d+)/);
  return m ? m[1] : null;
}

/**
 * Vrátí příjmy uživatele za období: kombinace auto-detekce z transakcí
 * + případné ruční aliasy z income_sources (na základě match_counterparty_account
 * nebo match_pattern).
 *
 * Pravidla:
 *  - Incoming transakce = amount > 0 na libovolném účtu uživatele.
 *  - Interní převod (vyloučeno): counterparty se shoduje s vlastním účtem
 *    s rolí spending/fixed/ignored.
 *  - Counterparty NEní v účtech, NEBO je v účtech s rolí 'income' → příjem.
 *  - Group key = normalizovaný counterparty, fallback = description.
 *  - Pro každou skupinu vyhledej ruční alias (income_source):
 *      1) match_counterparty_account == group_key (přednost),
 *      2) jinak match_pattern matchuje description některé tx ve skupině.
 *  - Pokud alias: použij person, planned_amount, status; jinak auto-only.
 *  - Ruční zdroje bez auto-shody (planned ale neviděn): vrátit actual=0, status='missing' nebo null.
 */
function incomeSourcesForPeriod(db, userId, period, billingDay) {
  const { start, end } = getPeriodDates(billingDay, period);

  // Načti účty uživatele a roli — k vyloučení interních převodů a k uznání income účtů.
  const accounts = db.prepare(
    'SELECT id, account_number, role FROM accounts WHERE user_id = ? AND account_number IS NOT NULL'
  ).all(userId);
  const internalRoles = new Set(['spending', 'fixed', 'ignored']);
  const internalNumbers = new Set();
  const incomeAccountNumbers = new Set();
  for (const a of accounts) {
    const num = normCounterparty(a.account_number);
    if (!num) continue;
    if (a.role === 'income') incomeAccountNumbers.add(num);
    else if (internalRoles.has(a.role)) internalNumbers.add(num);
  }

  // Načti incoming transakce v období pro uživatele.
  const txs = db.prepare(`
    SELECT id, amount, date, description, counterparty_account
    FROM transactions
    WHERE user_id = ? AND amount > 0 AND date >= ? AND date <= ?
  `).all(userId, start, end);

  // Filtruj na "skutečné příjmy" (vyloučí interní převody mezi spending/fixed/ignored).
  const incomeTxs = txs.filter(t => {
    const cp = normCounterparty(t.counterparty_account);
    if (cp && internalNumbers.has(cp) && !incomeAccountNumbers.has(cp)) return false;
    return true;
  });

  // Seskup podle counterparty (fallback description). Klíč skupiny je string.
  const groups = new Map(); // key -> { key, kind: 'counterparty'|'description', display, total, tx_count, descriptions:Set }
  for (const t of incomeTxs) {
    const cp = normCounterparty(t.counterparty_account);
    const key = cp ? `cp:${cp}` : `desc:${(t.description || '').trim() || '(bez popisu)'}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        counterparty: cp,
        display: cp ? cp : ((t.description || '').trim() || '(bez popisu)'),
        total: 0,
        tx_count: 0,
        descriptions: new Set(),
      };
      groups.set(key, g);
    }
    g.total += t.amount;
    g.tx_count += 1;
    if (t.description) g.descriptions.add(t.description);
  }

  // Načti ruční income_sources a aplikuj alias.
  const sources = db.prepare(
    'SELECT id, person, planned_amount, match_pattern, match_counterparty_account, sort_order FROM income_sources WHERE user_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(userId);
  const usedSourceIds = new Set();

  // Pro každou auto-skupinu najdi první matching alias (counterparty má přednost).
  const groupSource = new Map(); // group.key -> source row
  for (const g of groups.values()) {
    let matched = null;
    if (g.counterparty) {
      matched = sources.find(s => {
        const sn = normCounterparty(s.match_counterparty_account);
        return sn && sn === g.counterparty && !usedSourceIds.has(s.id);
      });
    }
    if (!matched) {
      matched = sources.find(s => {
        if (!s.match_pattern || usedSourceIds.has(s.id)) return false;
        const p = s.match_pattern;
        for (const d of g.descriptions) {
          if (d && d.indexOf(p) >= 0) return true;
        }
        return false;
      });
    }
    if (matched) {
      groupSource.set(g.key, matched);
      usedSourceIds.add(matched.id);
    }
  }

  // Sestav výstupní řádky: nejprve ruční zdroje (po sort_order), pak auto-only skupiny.
  const out = [];
  for (const s of sources) {
    if (!usedSourceIds.has(s.id)) {
      // Ruční zdroj bez auto-shody.
      out.push({
        id: s.id,
        person: s.person,
        planned_amount: s.planned_amount,
        match_pattern: s.match_pattern,
        match_counterparty_account: s.match_counterparty_account,
        actual: 0,
        tx_count: 0,
        status: s.planned_amount > 0 ? incomeStatus(s.planned_amount, 0, 0) : null,
        sort_order: s.sort_order,
      });
    } else {
      // Najdi auto-skupinu, ke které byl tento zdroj přiřazen.
      let g = null;
      for (const [key, src] of groupSource.entries()) {
        if (src.id === s.id) { g = groups.get(key); break; }
      }
      out.push({
        id: s.id,
        person: s.person,
        planned_amount: s.planned_amount,
        match_pattern: s.match_pattern,
        match_counterparty_account: s.match_counterparty_account,
        actual: g.total,
        tx_count: g.tx_count,
        status: s.planned_amount > 0 ? incomeStatus(s.planned_amount, g.total, g.tx_count) : null,
        sort_order: s.sort_order,
      });
    }
  }

  // Auto-only skupiny (bez ruční shody) seřazené sestupně dle total.
  const autoOnly = [];
  for (const [key, g] of groups.entries()) {
    if (groupSource.has(key)) continue;
    autoOnly.push({
      id: null,
      person: g.display,
      planned_amount: null,
      match_pattern: null,
      match_counterparty_account: g.counterparty,
      actual: g.total,
      tx_count: g.tx_count,
      status: null,
      sort_order: null,
    });
  }
  autoOnly.sort((a, b) => b.actual - a.actual);

  return [...out, ...autoOnly];
}

module.exports = { incomeSourcesForPeriod, normCounterparty };
