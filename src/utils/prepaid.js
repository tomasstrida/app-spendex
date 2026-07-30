'use strict';

// Čisté výpočty nad předplaceným balíčkem. Bez DB, aby šly testovat samostatně.
// Balíček (`pkg`) je řádek prepaid_packages, `draws` pole řádků prepaid_draws.

function unitAmount(totalAmount, unitsTotal) {
  const units = Number(unitsTotal);
  if (!(units > 0)) throw new Error('Počet jednotek musí být kladný.');
  return Number(totalAmount) / units;
}

function drawAmount(unitAmountValue, units) {
  return Number(unitAmountValue) * Number(units);
}

function packageSummary(pkg, draws = []) {
  const drawnUnits = draws.reduce((s, d) => s + Number(d.units || 0), 0);
  const drawnAmount = draws.reduce((s, d) => s + Number(d.amount || 0), 0);
  const dates = draws.map(d => d.date).filter(Boolean).sort();
  return {
    drawn_units: drawnUnits,
    drawn_amount: drawnAmount,
    remaining_units: Math.max(0, Number(pkg.units_total) - drawnUnits),
    remaining_amount: Math.max(0, Number(pkg.total_amount) - drawnAmount),
    last_draw_date: dates.length ? dates[dates.length - 1] : null,
  };
}

// Zbytek k doúčtování při uzavření balíčku. Počítá se z částek, ne z jednotek —
// srovná i drobný rozdíl u nedělitelné ceny jednotky (1000 / 3).
function writeOffAmount(pkg, draws = []) {
  const drawnAmount = draws.reduce((s, d) => s + Number(d.amount || 0), 0);
  return Math.max(0, Number(pkg.total_amount) - drawnAmount);
}

module.exports = { unitAmount, drawAmount, packageSummary, writeOffAmount };
