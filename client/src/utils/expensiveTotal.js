// Čisté utraceno za Drahé věci v období: Σ(-amount).
// Výdaj má záporný amount → přičte se kladně; refund (kladný) se odečte.
export function sumExpensiveTotal(items) {
  return (items || []).reduce((sum, it) => sum - it.amount, 0);
}
