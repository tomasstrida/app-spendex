// Tok peněz transakce „zdroj → cíl" (from → to) pro sloupec „Účet (z → do)".
// Orientace podle znaménka částky; strany se překládají na lidské názvy interních
// účtů domácnosti, jinak číslo účtu, jinak obchodník (place), jinak „—".
import { accountNameFor } from './accountName.js';

const DASH = '—';

// Náš účet transakce = z account_id přes mapu id→název; nespárováno → „—".
function ourSide(tx, accountById) {
  if (tx.account_id != null && accountById && accountById.has(tx.account_id)) {
    return accountById.get(tx.account_id);
  }
  return DASH;
}

// Protistrana: interní účet domácnosti → název; jinak číslo; jinak obchodník; jinak „—".
function otherSide(tx, accountNameMap) {
  const internalName = accountNameFor(tx.counterparty_account, accountNameMap);
  if (internalName) return internalName;
  if (tx.counterparty_account) return tx.counterparty_account;
  if (tx.place) return tx.place;
  return DASH;
}

export function accountFlow(tx, { accountById, accountNameMap } = {}) {
  const ours = ourSide(tx, accountById);
  const other = otherSide(tx, accountNameMap);
  // amount < 0 = odchozí (náš účet → protistrana); jinak příchozí (protistrana → náš účet).
  return tx.amount < 0 ? { from: ours, to: other } : { from: other, to: ours };
}
