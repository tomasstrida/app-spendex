'use strict';

// Sdílený SQL fragment „co se počítá jako výdaj domácnosti" (fáze A).
// Kromě účtů role='spending' (a account_id IS NULL) zahrne i výdaje se skutečnou
// kategorií (typ 1/2/3, kromě 'Mimo systém'/'Pravidelné platby') zaúčtované na
// účtech role='ignored' — aby platba omylem z jiného účtu ze statistik nezmizela.
// income (OSVČ) a fixed účty se nezapočítají nikdy.
//
// Fragment PŘEDPOKLÁDÁ, že tabulka transactions má alias `t`. Vlastní aliasy
// (sfa/sfa2/sfc) jsou zvolené tak, aby nekolidovaly s aliasy volajícího (t/c/a/sc).
const SPENDING_WHERE = `(
    t.account_id IS NULL
    OR EXISTS (SELECT 1 FROM accounts sfa WHERE sfa.id = t.account_id AND sfa.role = 'spending')
    OR (
      EXISTS (SELECT 1 FROM accounts sfa2 WHERE sfa2.id = t.account_id AND sfa2.role = 'ignored')
      AND EXISTS (
        SELECT 1 FROM categories sfc
        WHERE sfc.id = t.category_id AND sfc.user_id = t.user_id
          AND sfc.type IN (1, 2, 3)
          AND sfc.name NOT IN ('Mimo systém', 'Pravidelné platby')
      )
    )
  )`;

// Verze s úvodním ' AND ' pro vložení za existující WHERE podmínky.
const SPENDING_AND = ` AND ${SPENDING_WHERE}`;

module.exports = { SPENDING_WHERE, SPENDING_AND };
