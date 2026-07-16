'use strict';
const { getPeriodDates } = require('./period');
const { incomeStatus } = require('./recurring');

/**
 * Normalizuje counterparty_account: identita účtu = KOMPLETNÍ číslo
 * `[předčíslí-]číslo/kódbanky` — nic se nezahazuje, jen se ořežou mezery.
 * Porovnává se exact celý string; uložené matchery i vlastní účty proto musí
 * být v plném formátu včetně kódu banky. Vrátí null pokud vstup nezačíná číslem.
 */
function normCounterparty(s) {
  if (!s) return null;
  const v = String(s).replace(/\s+/g, '');
  const m = v.match(/^(?:\d+-)?\d+(?:\/\d+)?/);
  return m ? m[0] : null;
}

/**
 * Vrátí příjmy uživatele za období: auto-detekce z transakcí + ruční aliasy
 * z income_sources (match_counterparty_account / match_pattern / account_id).
 *
 * Pravidla:
 *  - Incoming = amount > 0 na libovolném účtu uživatele.
 *  - Interní převod (vyloučeno): counterparty == vlastní účet s rolí
 *    spending/fixed/ignored. Účet s rolí 'income' = whitelisted source.
 *  - Skupina = (counterparty | description fallback) × cílový account_id.
 *  - Alias matchne, pokud counterparty/pattern sedí AND (alias.account_id == null
 *    NEBO alias.account_id == group.account_id).
 */
function incomeSourcesForPeriod(db, userId, period, billingDay) {
  const { start, end } = getPeriodDates(billingDay, period);

  const accounts = db.prepare(
    'SELECT id, account_number, name, role FROM accounts WHERE user_id = ?'
  ).all(userId);
  const internalRoles = new Set(['spending', 'fixed', 'ignored']);
  const internalNumbers = new Set();
  const incomeAccountNumbers = new Set();
  const accountNameById = new Map();
  for (const a of accounts) {
    accountNameById.set(a.id, a.name);
    const num = normCounterparty(a.account_number);
    if (!num) continue;
    if (a.role === 'income') incomeAccountNumbers.add(num);
    else if (internalRoles.has(a.role)) internalNumbers.add(num);
  }

  const txs = db.prepare(`
    SELECT id, amount, date, description, counterparty_account, account_id
    FROM transactions
    WHERE user_id = ? AND amount > 0 AND date >= ? AND date <= ?
  `).all(userId, start, end);

  const incomeTxs = txs.filter(t => {
    const cp = normCounterparty(t.counterparty_account);
    if (cp && internalNumbers.has(cp) && !incomeAccountNumbers.has(cp)) return false;
    return true;
  });

  // Group key = (counterparty|description fallback) × account_id (destination).
  const groups = new Map();
  for (const t of incomeTxs) {
    const cp = normCounterparty(t.counterparty_account);
    const keyPart = cp ? `cp:${cp}` : `desc:${(t.description || '').trim() || '(bez popisu)'}`;
    const accPart = `acc:${t.account_id == null ? 'null' : t.account_id}`;
    const key = `${keyPart}|${accPart}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        counterparty: cp,
        account_id: t.account_id == null ? null : t.account_id,
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

  const sources = db.prepare(
    'SELECT id, person, planned_amount, match_pattern, match_counterparty_account, account_id, sort_order FROM income_sources WHERE user_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(userId);
  const usedSourceIds = new Set();
  const groupSource = new Map();

  function matchAccountConstraint(alias, g) {
    if (alias.account_id == null) return true;
    return alias.account_id === g.account_id;
  }

  for (const g of groups.values()) {
    let matched = null;
    if (g.counterparty) {
      matched = sources.find(s => {
        if (usedSourceIds.has(s.id)) return false;
        const sn = normCounterparty(s.match_counterparty_account);
        if (!sn || sn !== g.counterparty) return false;
        return matchAccountConstraint(s, g);
      });
    }
    if (!matched) {
      matched = sources.find(s => {
        if (!s.match_pattern || usedSourceIds.has(s.id)) return false;
        if (!matchAccountConstraint(s, g)) return false;
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

  const out = [];
  for (const s of sources) {
    const accountName = s.account_id != null ? (accountNameById.get(s.account_id) || null) : null;
    if (!usedSourceIds.has(s.id)) {
      out.push({
        id: s.id,
        person: s.person,
        planned_amount: s.planned_amount,
        match_pattern: s.match_pattern,
        match_counterparty_account: s.match_counterparty_account,
        account_id: s.account_id,
        account_name: accountName,
        actual: 0,
        tx_count: 0,
        status: s.planned_amount > 0 ? incomeStatus(s.planned_amount, 0, 0) : null,
        sort_order: s.sort_order,
      });
    } else {
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
        account_id: s.account_id,
        account_name: accountName,
        actual: g.total,
        tx_count: g.tx_count,
        status: s.planned_amount > 0 ? incomeStatus(s.planned_amount, g.total, g.tx_count) : null,
        sort_order: s.sort_order,
      });
    }
  }

  const autoOnly = [];
  for (const [key, g] of groups.entries()) {
    if (groupSource.has(key)) continue;
    const accountName = g.account_id ? (accountNameById.get(g.account_id) || null) : null;
    autoOnly.push({
      id: null,
      person: g.display,
      planned_amount: null,
      match_pattern: null,
      match_counterparty_account: g.counterparty,
      account_id: g.account_id,
      account_name: accountName,
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
