'use strict';

// Vytáhne e-mailovou adresu z hlavičky `From`. Formát "Jméno <adresa@domena>" —
// adresa v úhlových závorkách MÁ PŘEDNOST před celým řetězcem, protože display
// name je čistě kosmetický text, který si odesílatel volí zcela sám (SPF/DMARC
// ho nijak nekryje) — porovnávat proti němu substringem je bezpečnostní díra.
// Bez závorek bereme celý (ořezaný) řetězec jako adresu.
function extractAddress(fromHeader) {
  const raw = String(fromHeader || '').trim();
  if (!raw) return '';
  const m = raw.match(/<([^<>]+)>/);
  const addr = m ? m[1] : raw;
  return addr.trim().toLowerCase();
}

// Rozdělí konfiguraci typu "a@b.cz, Jméno <c@d.cz>" na pole normalizovaných adres.
// Uživatel může mít víc Apple ID a přeposílat faktury z různých schránek, takže
// whitelist přeposílatele je seznam, ne jedna hodnota. Prázdné položky vypadnou.
function parseAddressList(value) {
  return String(value || '')
    .split(',')
    .map(part => extractAddress(part))
    .filter(Boolean);
}

module.exports = { extractAddress, parseAddressList };
