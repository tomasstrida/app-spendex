'use strict';
// L0: protistrana ∈ vlastní účty → Převody. L1: účet → kategorie.
// L2: AB kategorie → Spendex. L3: textový pattern (popis/note) → kategorie.
module.exports = {
  internalTransferCategory: 'Převody',
  fallbackCategory: 'Ostatní',

  // Kompletní čísla účtů vč. kódu banky — porovnává se exact celý string.
  ownAccountNumbers: [
    '1679014015/3030', '1679014023/3030', '1679014031/3030', '1679014058/3030',
    '1679014066/3030', '1679014074/3030', '1679014082/3030', '1679014103/3030',
    '1679014111/3030', '1679014138/3030',
  ],

  accountRules: {
    '1679014111/3030': 'Licence', // účet Licence → vše Licence
  },

  abCategoryMap: {
    'Jídlo': 'Jídlo a běžné nákupy',
    'Nakupy Jidlo': 'Jídlo a běžné nákupy',
    'Lékárna': 'Jídlo a běžné nákupy',
    'Nákupy': 'Jídlo a běžné nákupy',
    'Restaurace': 'Restaurace a kávičky',
    'Doprava': 'Auto Moto - PHM',
    'Sport': 'Sport',
    'Zábava': 'Zábava',
    'Bydlení': 'Nákupy bydlení',
    'Licence Apple apod': 'Licence',
    'Drahe-veci': 'Drahé věci',
    'Zdravotní': 'Terapie',
    'Terapie': 'Terapie',
    'Služby': 'Beauty',
    'Dárky': 'Dárky',
    'Tom osobni': 'Tom osobní',
    'Pravidelne mesicni': 'Pravidelné platby',
    'Pojištění': 'Y - Pojistky',
    'Sociální': 'Ostatní',
    'Splátky': 'Ostatní',
    'Výběr hotovosti': 'Ostatní',
    'OSVC': 'Ostatní',
    'Nezařazeno': 'Ostatní',
    'Vzdelavani': 'Ostatní',
    'Příchozí úhrada': 'Příjmy',
  },

  // pořadí = priorita (první shoda vyhrává).
  // Volitelné amount_max_abs / amount_min_abs zužují match podle absolutní částky.
  textOverrides: [
    { pattern: 'MAX FITNESS', category: 'Sport' },
    { pattern: 'MAXFITNESS', category: 'Sport' },
    { pattern: 'PIDLitacka', category: 'Y - Lítačka' },
    { pattern: 'PID Litacka', category: 'Y - Lítačka' },
    { pattern: 'Klinika Infekcnich', category: 'Y - Léky, PrEP, Optika' },
    { pattern: 'PrEP', category: 'Y - Léky, PrEP, Optika' },
    { pattern: 'ROHLIK', category: 'Jídlo a běžné nákupy' },
    { pattern: 'ROHLÍK', category: 'Jídlo a běžné nákupy' },
    // Benzinky pod 200 Kč = občerstvení/káva, ne PHM. Musí stát PŘED případnými
    // generickými PHM patterny, aby se uplatnily jako specifičtější výjimka.
    { pattern: 'SHELL',     category: 'Restaurace a kávičky', amount_max_abs: 200 },
    { pattern: 'OMV',       category: 'Restaurace a kávičky', amount_max_abs: 200 },
    { pattern: 'MOL ',      category: 'Restaurace a kávičky', amount_max_abs: 200 },
    { pattern: 'BENZINA',   category: 'Restaurace a kávičky', amount_max_abs: 200 },
    { pattern: 'EUROOIL',   category: 'Restaurace a kávičky', amount_max_abs: 200 },
    { pattern: 'ORLEN',     category: 'Restaurace a kávičky', amount_max_abs: 200 },
    { pattern: 'CIRCLE K',  category: 'Restaurace a kávičky', amount_max_abs: 200 },
    // Tracker fixních plateb → Pravidelné platby (mimo měsíční budgety)
    { pattern: 'JANA HRDLIČKOVÁ', category: 'Pravidelné platby' },
    { pattern: 'Pražská energetika', category: 'Pravidelné platby' },
    { pattern: 'Toyota Financial', category: 'Pravidelné platby' },
    // T-Mobile: substring match → chytne i případný nákup HW/dobíječky u T-Mobile (vědomý tradeoff, domácnost má 1 tarif)
    { pattern: 'T-Mobile', category: 'Pravidelné platby' },
    { pattern: 'Nordic Telecom', category: 'Pravidelné platby' },
    { pattern: 'ČESKÁ TELEVIZE', category: 'Pravidelné platby' },
    { pattern: 'TV poplatek', category: 'Pravidelné platby' },
    // Digitální předplatné → Licence (Typ 2, roční)
    { pattern: 'OPENAI', category: 'Licence' },
    { pattern: 'Google Workspace', category: 'Licence' },
    { pattern: 'DISCORD', category: 'Licence' },
    { pattern: 'NUELINK', category: 'Licence' },
    { pattern: 'OPUS CLIP', category: 'Licence' },
    { pattern: 'P.SKOOL.COM', category: 'Licence' },
  ],
};
