'use strict';

/** rawRef = external_id bez koncového "-<čísloúčtu>" suffixu (legacy bez suffixu → celé) */
function rawRef(extId) {
  if (!extId) return null;
  const i = extId.lastIndexOf('-');
  return i > 0 ? extId.slice(0, i) : extId;
}

function pushTo(map, key, row) {
  let arr = map.get(key);
  if (!arr) { arr = []; map.set(key, arr); }
  arr.push(row);
}

/**
 * Najde podezřelé duplicity uživatele ve dvou úrovních.
 * probable: stejný rawRef + stejný account_id (interní převod = stejný rawRef
 *           na různých účtech → různé skupiny → nikdy spolu).
 * possible: stejné date + description + amount + account_id.
 * Pozn.: probable a possible se mohou překrývat (stejný pár vidět v obou) — záměr, dvě úrovně jistoty.
 * @returns {{ probable: {key:string,rows:object[]}[], possible: {...}[] }}
 */
function findDuplicates(db, userId) {
  const rows = db.prepare(`
    SELECT t.id, t.date, t.description, t.amount, t.account_id, t.external_id,
           t.source, t.created_at, t.tx_time, t.note, a.name AS account_name
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.user_id = ?
    ORDER BY t.id ASC
  `).all(userId);

  const prob = new Map();
  const poss = new Map();
  for (const r of rows) {
    const rr = rawRef(r.external_id);
    r.ref = rr;
    if (rr) pushTo(prob, `${rr}|${r.account_id ?? null}`, r);
    const timeKey = r.tx_time ? r.tx_time : `NIL:${r.id}`;
    pushTo(poss, `${r.date}|${r.description}|${r.amount}|${r.account_id ?? null}|${timeKey}`, r);
  }
  // Skupiny ručně označené jako „nejsou duplicity" (klíč = seřazené ID řádků)
  let dismissed = new Set();
  try {
    dismissed = new Set(
      db.prepare('SELECT tx_ids FROM duplicate_dismissals WHERE user_id = ?')
        .all(userId).map(d => d.tx_ids)
    );
  } catch { /* tabulka nemusí existovat (starší DB / testy) */ }
  const idSig = rs => rs.map(r => r.id).sort((a, b) => a - b).join(',');

  const toGroups = m => [...m.entries()]
    .filter(([, rs]) => rs.length > 1)
    .map(([key, rs]) => ({ key, rows: rs }))
    .filter(g => !dismissed.has(idSig(g.rows)))
    .sort((a, b) => (a.rows[0].date < b.rows[0].date ? 1 : a.rows[0].date > b.rows[0].date ? -1 : 0));
  return { probable: toGroups(prob), possible: toGroups(poss) };
}

/**
 * True, pokud by `ids` smazaly VŠECHNY řádky některé vícečlenné
 * possible-skupiny (date+description+amount+account_id+tx_time); řádky
 * s prázdným tx_time nejsou nikdy chráněná skupina (NULL = unikát, ne kopie).
 * Skupina velikosti 1 (žádné duplo) vrací false → běžné mazání jednotlivin neblokuje.
 * Pojistka hlídá possible-dimenzi, ne probable.
 */
function wouldEmptyDuplicateGroup(db, userId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return false;
  const idSet = new Set(ids.map(Number));
  const ph = ids.map(() => '?').join(',');
  const delRows = db.prepare(
    `SELECT id, date, description, amount, account_id, tx_time
     FROM transactions WHERE user_id = ? AND id IN (${ph})`
  ).all(userId, ...ids);

  const groupStmt = db.prepare(
    `SELECT id FROM transactions
     WHERE user_id = ? AND date = ? AND description = ? AND amount = ?
       AND account_id IS ? AND tx_time = ?`
  );
  const seen = new Set();
  for (const r of delRows) {
    if (!r.tx_time) continue; // NULL/prázdný tx_time = nikdy chráněná skupina (pravidlo: unikát)
    const sig = JSON.stringify([r.date, r.description, r.amount, r.account_id, r.tx_time]);
    if (seen.has(sig)) continue;
    seen.add(sig);
    const groupIds = groupStmt.all(userId, r.date, r.description, r.amount, r.account_id, r.tx_time);
    if (groupIds.length > 1 && groupIds.every(g => idSet.has(g.id))) return true;
  }
  return false;
}

module.exports = { findDuplicates, wouldEmptyDuplicateGroup, rawRef };
