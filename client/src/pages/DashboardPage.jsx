import { useState, useEffect } from 'react';
import { usePeriod } from '../contexts/PeriodContext';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Layout from '../components/Layout';
import { t, formatCurrency, formatPeriod, addPeriods } from '../i18n';

// ── Teploměr Typ 1 ────────────────────────────────────────────────────────────

function Thermometer({ spent, amount, periodStart, periodEnd, color }) {
  const spentPct = amount > 0 ? Math.min((spent / amount) * 100, 100) : 0;
  const over = spent > amount;
  const today = new Date();
  const start = new Date(periodStart + 'T00:00:00');
  const end = new Date(periodEnd + 'T00:00:00');
  const periodOver = today > end;
  const totalDays = Math.round((end - start) / 86400000) + 1;
  const daysPassed = Math.max(0, Math.min(Math.round((today - start) / 86400000), totalDays));
  const dayPct = Math.min((daysPassed / totalDays) * 100, 100);
  const projection = daysPassed > 0 ? Math.round((spent / daysPassed) * totalDays) : 0;
  const fillColor = over ? undefined : (spentPct > dayPct ? '#f97316' : (color || '#6366f1'));

  return (
    <div>
      <div className="budget-bar-track" style={{ position: 'relative' }}>
        <div className={`budget-bar-fill${over ? ' over' : ''}`} style={{ width: `${spentPct}%`, background: fillColor }} />
        {dayPct > 0 && dayPct < 100 && <div className="budget-bar-day-marker" style={{ left: `${dayPct}%` }} />}
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

function BudgetBar({ budget, period, periodStart, periodEnd }) {
  const navigate = useNavigate();
  const over = budget.spent > budget.amount;
  const remaining = budget.amount - budget.spent;
  const pct = budget.amount > 0 ? (budget.spent / budget.amount) * 100 : 0;

  return (
    <div className="budget-item budget-item-clickable"
      onClick={() => navigate(`/transactions?category_id=${budget.category_id}&period=${period}`)}>
      <div className="budget-item-header">
        <div className="budget-item-name">
          <span className="budget-dot" style={{ background: budget.category_color || '#6366f1' }} />
          {budget.category_name}
        </div>
        <div className="budget-item-amounts">
          <span className={over ? 'text-danger' : ''}>{formatCurrency(budget.spent)}</span>
          <span className="text-muted"> / {formatCurrency(budget.amount)}</span>
        </div>
      </div>
      <Thermometer spent={budget.spent} amount={budget.amount} periodStart={periodStart} periodEnd={periodEnd} color={budget.category_color} />
      <div className="budget-item-footer">
        {over
          ? <span className="text-danger">{formatCurrency(Math.abs(remaining))} {t.dashboard.over}</span>
          : <span className="text-muted">{formatCurrency(remaining)} {t.dashboard.remaining}</span>}
        <span className="text-muted">{Math.round(pct)} %</span>
      </div>
    </div>
  );
}

// ── Hlavní komponenta ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate();
  const { period, setPeriod, currentPeriod, resetToCurrent } = usePeriod();
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [data, setData] = useState(null);
  const [budgets, setBudgets] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!period) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/stats/overview?period=${period}`).then(r => r.json()),
      fetch(`/api/budgets?period=${period}`).then(r => r.json()),
      fetch('/api/categories').then(r => r.json()),
    ]).then(([stats, buds, cats]) => {
      setData(stats);
      setPeriodStart(stats.period_start);
      setPeriodEnd(stats.period_end);
      // Měsíční rozpočty: jen Typ 1
      setBudgets((buds.budgets || []).filter(b => !b.category_type || b.category_type === 1));
      setCategories(cats);
    }).finally(() => setLoading(false));
  }, [period]);

  const type3Cats = categories.filter(c => c.type === 3);
  const expensiveItems = data?.expensive_items || [];

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{t.dashboard.title}</h1>
        {period && (
          <div className="month-nav">
            <button className="btn btn-ghost btn-icon" onClick={() => setPeriod(p => addPeriods(p, -1))}>
              <ChevronLeft size={18} />
            </button>
            <span className="month-label">{formatPeriod(periodStart, periodEnd)}</span>
            <button className="btn btn-ghost btn-icon"
              onClick={() => setPeriod(p => addPeriods(p, 1))}
              disabled={period >= currentPeriod}>
              <ChevronRight size={18} />
            </button>
            <button
              className="btn btn-ghost"
              onClick={resetToCurrent}
              disabled={period === currentPeriod}
              title={t.period.resetToCurrent}
            >
              {t.period.resetToCurrent}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="page-loading">{t.common.loading}</div>
      ) : (
        <div className="dashboard-content">
          {/* Typ 1 – Měsíční */}
          <section className="section">
            {!budgets?.length ? (
              <div className="empty-state">
                <p>{t.dashboard.noBudgets}</p>
                <p className="text-muted">{t.dashboard.noBudgetsHint}</p>
              </div>
            ) : (
              <div className="budget-list">
                {budgets.map(b => (
                  <BudgetBar key={b.category_id} budget={b} period={period}
                    periodStart={periodStart} periodEnd={periodEnd} />
                ))}
              </div>
            )}
          </section>

          {/* Typ 3 – Drahé věci: seznam položek v zobrazeném období */}
          {type3Cats.length > 0 && (
            <section className="section">
              <h2 className="section-title">Drahé věci</h2>
              {expensiveItems.length === 0 ? (
                <div className="empty-state">
                  <p className="text-muted">Žádné drahé věci v tomto období.</p>
                </div>
              ) : (
                <div className="report-budget-list" style={{ maxWidth: 640 }}>
                  {expensiveItems.map(it => (
                    <div key={it.id} className="report-budget-row"
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/transactions?category_id=${it.category_id}&period=${period}`)}>
                      <span className="report-budget-dot" style={{ background: it.category_color || '#6366f1' }} />
                      <span className="report-budget-name">
                        <span className="text-muted" style={{ marginRight: 8 }}>
                          {`${+it.date.slice(8, 10)}. ${+it.date.slice(5, 7)}.`}
                        </span>
                        {it.description || it.category_name}
                        <span className="text-muted" style={{ display: 'block', fontSize: 11 }}>{it.category_name}</span>
                      </span>
                      <span className={`report-budget-spent${it.amount < 0 ? '' : ' text-success'}`}>
                        {formatCurrency(-it.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </Layout>
  );
}
