import { formatCurrency } from '../i18n';
import { budgetFillColor } from '../utils/budgetColor';

// Teploměr ročního čerpání: rtuť = utraceno / roční rozpočet,
// svislá čárka = aktuální pozice v roce podle dnešního dne.
export default function YearThermometer({ spent, amount, year }) {
  if (!(amount > 0)) return null;
  const today = new Date();
  const start = new Date(`${year}-01-01T00:00:00`);
  const end   = new Date(`${year}-12-31T00:00:00`);
  const periodOver = today > end;
  const spentPct   = Math.min((spent / amount) * 100, 100);
  const over       = spent > amount;
  const totalDays  = Math.round((end - start) / 86400000) + 1;
  const daysPassed = Math.max(0, Math.min(Math.round((today - start) / 86400000), totalDays));
  const dayPct     = Math.min((daysPassed / totalDays) * 100, 100);
  const projection = daysPassed > 0 ? Math.round((spent / daysPassed) * totalDays) : 0;
  const fillColor  = budgetFillColor({ spent, amount, daysPassed, totalDays });
  return (
    <div>
      <div className="budget-bar-track" style={{ position: 'relative' }}>
        <div className={`budget-bar-fill${over ? ' over' : ''}`}
          style={{ width: `${spentPct}%`, background: fillColor }} />
        {dayPct > 0 && dayPct < 100 && (
          <div className="budget-bar-day-marker" style={{ left: `${dayPct}%` }} />
        )}
      </div>
      {!periodOver && projection > 0 && projection > amount && (
        <div className="budget-projection">
          projekce: <strong>{formatCurrency(projection)}</strong>
          <span className="text-danger"> (+{formatCurrency(projection - amount)})</span>
        </div>
      )}
    </div>
  );
}
