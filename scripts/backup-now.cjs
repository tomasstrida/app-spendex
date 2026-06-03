#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { createBackup } = require('../src/services/backup');
const { createR2Client } = require('../src/services/r2Client');

(async () => {
  try {
    const r2 = createR2Client();
    console.log('Spouštím zálohu…');
    const res = await createBackup({ r2 });
    console.log(`Hotovo: ${res.key} (${res.sizeBytes} B), smazáno starých: ${res.prunedCount}`);
    process.exit(0);
  } catch (err) {
    console.error('Záloha selhala:', err);
    process.exit(1);
  }
})();
