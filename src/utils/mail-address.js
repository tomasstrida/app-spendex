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

module.exports = { extractAddress };
