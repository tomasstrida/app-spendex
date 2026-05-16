'use strict';
// annualBudgets: roční strop na kategorii. budgetItems: sezónní položky s okny (měsíce 1-12).
module.exports = {
  annualBudgets: [
    { category: 'Y - Auto Moto - Servis', amount: 30000 },
    { category: 'Y - Tom cvíčo', amount: 33000 },
    { category: 'Licence', amount: 72000 },
    { category: 'Y - Léky, PrEP, Optika', amount: 20000 },
    { category: 'Y - Pojistky', amount: 7200 },
  ],
  budgetItems: [
    { category: 'Y - Lítačka', name: 'Lítačka Tom', amount: 3650, window_start: 4, window_end: 5 },
    { category: 'Y - Lítačka', name: 'Lítačka Martin', amount: 3650, window_start: 8, window_end: 9 },
    { category: 'Y - Beach volejbal', name: 'Beach léto 2026', amount: 10500, window_start: 5, window_end: 9 },
    { category: 'Y - Beach volejbal', name: 'Beach zima 2026', amount: 21000, window_start: 9, window_end: 12 },
  ],
};
