'use strict';
const { normCounterparty } = require('./income');
const { savingsAccount, savingsNet } = require('./recurring');

// Obě nohy interního převodu jsou v datech: noha na běžném účtu (spořicí je
// protistrana) a noha zaúčtovaná přímo na spořicím účtu. Bez párování by se
// každý převod počítal dvakrát.
// Párovací okno: obě nohy nesou datum zaúčtování téhož převodu, takže v datech
// vycházejí na stejný den (ověřeno na celé historii: 49 z 49 párů). Tolerance je
// pojistka pro případ, kdy banka strany zaúčtuje přes půlnoc nebo přes víkend.
const PAIR_WINDOW_DAYS = 3;
const dayDiff = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

/**
 * ID spořicího účtu v `accounts`. Hledá se přes normalizované číslo, ne exact
 * match na sloupec — jinak by stačila mezera navíc a sledování by tiše vyplo.
 */
function findSavingsAccountId(db, userId) {
  const target = normCounterparty(savingsAccount);
  return db.prepare('SELECT id, account_number FROM accounts WHERE user_id = ?')
    .all(userId)
    .filter(a => normCounterparty(a.account_number) === target)
    .map(a => a.id)[0] || null;
}

/**
 * Pohyby na spořicím účtu v rozsahu dat, dedupované na jednu nohu převodu.
 * `deposits`/`withdrawals` jsou z pohledu spořicího účtu (kladné = přibylo).
 */
function savingsMovements(db, userId, start, end) {
  const savingsNumber = normCounterparty(savingsAccount);
  const savingsAccountId = findSavingsAccountId(db, userId);

  // `amount` je u běžné nohy z pohledu zdrojového účtu (záporné = vklad na spořicí),
  // u `external` řádků z pohledu spořicího účtu (kladné = přibylo). Převod na jednotný
  // pohled dělá `onSavings` níž i klient. is_regular = standardní měsíční vklad 25 000.
  // REPLACE v porovnání protiúčtu: čísla účtů chodí i s mezerami, exact LIKE by je minul.
  const rows = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount, t.counterparty_account, t.note,
           a.name AS account_name, a.account_number AS account_number
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
    WHERE t.user_id = ? AND t.date >= ? AND t.date <= ?
      AND (REPLACE(t.counterparty_account, ' ', '') LIKE ? || '%' OR t.account_id = ?)
    ORDER BY t.date DESC, t.id DESC
  `).all(userId, start, end, savingsNumber, savingsAccountId);

  // Noha zaúčtovaná na běžném účtu (spořicí je protistrana) je referenční — z ní se
  // pohyb počítá vždy. Noha zaúčtovaná na spořicím účtu se zahodí jen tehdy, když k ní
  // referenční protějšek v datech SKUTEČNĚ existuje (stejné datum, opačná částka, 1:1).
  const pool = rows
    .filter(t => normCounterparty(t.counterparty_account) === savingsNumber)
    .map(t => ({ date: t.date, amount: -t.amount, used: false }));   // částka z pohledu spořicího

  // Spotřebuje protějšek pro danou nohu (nejbližší datum vyhrává), nebo vrátí false.
  function takeCounterpartyLeg(t) {
    let best = null;
    for (const p of pool) {
      if (p.used || p.amount !== t.amount) continue;
      const d = dayDiff(p.date, t.date);
      if (d > PAIR_WINDOW_DAYS) continue;
      if (!best || d < best.d) best = { p, d };
      if (d === 0) break;
    }
    if (!best) return false;
    best.p.used = true;
    return true;
  }

  const transfers = rows
    .map(t => {
      if (normCounterparty(t.counterparty_account) === savingsNumber) {
        return { ...t, external: 0, is_regular: t.amount === -25000 };
      }
      if (takeCounterpartyLeg(t)) return null;    // druhá noha už započteného převodu
      return { ...t, external: 1, is_regular: false };
    })
    .filter(Boolean);

  // Pohled spořicího účtu: kladné = přibylo (vklad), záporné = ubylo (výběr).
  const sav = transfers.reduce((acc, t) => {
    const v = t.external ? t.amount : -t.amount;
    if (v > 0) acc.deposits += v;
    else acc.withdrawals += -v;
    return acc;
  }, { deposits: 0, withdrawals: 0 });

  return { transfers, deposits: sav.deposits, withdrawals: sav.withdrawals, net: savingsNet(sav) };
}

module.exports = { savingsMovements, findSavingsAccountId, PAIR_WINDOW_DAYS };
