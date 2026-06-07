'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEmailNotification } = require('./emailParser');
const { parseAirBankCSV } = require('./csvParser');
const { buildExternalId } = require('./externalId');

// Zdrojový účet, který by uživatel vybral při CSV importu (accounts.account_number,
// formát bez kódu banky) — shodný s tím, co e-mail parser vytáhne jako source_account.
const SOURCE_ACCOUNT = '1679014023';

const EMAIL = `zůstatek na účtu Společný číslo 1679014023/3030 se snížil o částku 10,00 CZK. Dostupný zůstatek k 07.06.2026 v 17:47 je 4 934,46 CZK.
Odchozí úhrada na účet Tomáš Střída číslo 1679014138/3030
Datum zaúčtování: 07.06.2026
Zpráva pro plátce: test 10 Kč
Kód transakce: 160610143222`;

const CSV_HEADER = `"Datum provedení";"Směr úhrady";"Typ úhrady";"Kategorie plateb";"Měna účtu";"Částka v měně účtu";"Poplatek v měně účtu";"Původní měna úhrady";"Původní částka úhrady";"Název protistrany";"Číslo účtu protistrany";"Název účtu protistrany";"Variabilní symbol";"Konstantní symbol";"Specifický symbol";"Zdrojová obálka";"Cílová obálka";"Poznámka pro mne";"Zpráva pro příjemce";"Poznámka k úhradě";"Název karty";"Číslo karty";"Držitel karty";"Název zařízení";"Obchodní místo";"Směnný kurz";"Odesílatel poslal";"Poplatky jiných bank";"Datum a čas zadání";"Datum splatnosti";"Datum schválení";"Datum zaúčtování";"Referenční číslo";"Způsob zadání";"Zadal";"Zaúčtováno";"Pojmenování příkazu";"Název, adresa a stát protistrany";"Název, adresa a stát banky protistrany";"Typ poplatku";"Účel úhrady";"Zvláštní pokyny k úhradě";"Související úhrady";"Další identifikace úhrady";"Způsob úhrady"`;
const CSV_ROW = `"07/06/2026";"Odchozí";"Odchozí úhrada";"Cizí";"CZK";"-10,00";;"CZK";"-10,00";"Hlavní";"1679014138/3030";"Hlavní";;;;;;"test 10 Kč";;"test 10 Kč";;;;;"";;"";"";"07/06/2026 17:47:30";"07/06/2026";;"07/06/2026";"160610143222";"Internetové bankovnictví";"Střída Tomáš";"Ano";;;"Air Bank a.s. EVROPSKA 2690/17 16000 PRAGUE ";;"";;;;`;
const CSV = `${CSV_HEADER}\n${CSV_ROW}`;

test('cross-path dedup: e-mail a CSV téže transakce dají identický external_id', () => {
  const emailTx = parseEmailNotification(EMAIL);
  const csvTxs = parseAirBankCSV(CSV);
  assert.equal(csvTxs.length, 1, 'CSV má dát jednu transakci');
  const csvTx = csvTxs[0];

  // Jádro: e-mailový "Kód transakce" == CSV "Referenční číslo"
  assert.equal(emailTx.external_id, '160610143222');
  assert.equal(csvTx.external_id, '160610143222');
  assert.equal(emailTx.external_id, csvTx.external_id);

  // E-mail vytáhne zdrojový účet přímo; u CSV ho volí uživatel (resolvedAccountNumber)
  assert.equal(emailTx.source_account, SOURCE_ACCOUNT);

  // Kanonické external_id musí být identické z obou cest
  const emailExtId = buildExternalId(emailTx.external_id, emailTx.source_account);
  const csvExtId = buildExternalId(csvTx.external_id, SOURCE_ACCOUNT);
  assert.equal(emailExtId, csvExtId);
  assert.equal(emailExtId, '160610143222-1679014023');
});
