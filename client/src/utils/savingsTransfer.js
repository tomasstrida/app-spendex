// Jeden řádek v rozpisu pohybů na spořicím účtu: částka z pohledu spořicího účtu
// a tok „odkud → kam".
//
// `/api/stats/overview` vrací dva druhy řádků:
//  - běžný interní převod (`external: 0`) — transakce je zaúčtovaná na běžném účtu
//    a spořicí je protistrana, takže `amount` je z pohledu běžného účtu
//    (záporné = na spořicí přibylo);
//  - pohyb bez druhé nohy (`external: 1`) — příchozí platba zvenku nebo připsaný
//    úrok, zaúčtované přímo na spořicím účtu, takže `amount` už JE z pohledu
//    spořicího účtu a strany toku jsou obrácené.

export function savingsTransferView(tr) {
  const onSavings = tr.external ? tr.amount : -tr.amount;

  // U interního převodu je naše strana běžný účet (account_name) a protistranou
  // spořicí (description). U externího pohybu je to naopak: transakce sedí na
  // spořicím účtu, protistranou je odesílatel/příjemce z popisu.
  const savingsSide = (tr.external ? tr.account_name : tr.description) || 'Spořicí účet';
  const otherSide = tr.external
    ? (tr.description || tr.counterparty_account || '')
    : tr.account_name;

  const flow = otherSide
    ? (onSavings >= 0 ? `${otherSide} → ${savingsSide}` : `${savingsSide} → ${otherSide}`)
    : savingsSide;

  return { onSavings, flow };
}
