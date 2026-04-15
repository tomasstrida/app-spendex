import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, TrendingDown } from 'lucide-react';
import Layout from '../components/Layout';
import { t, formatCurrency, formatPeriod, addPeriods } from '../i18n';

function BudgetBar({ budget, period }) {
  const navigate = useNavigate();
  const pct = budget.amount > 0 ? Math.min((budget.spent / budget.amount) * 100, 100) : 0;
  const over = budget.spent > budget.amount;
  const remaining = budget.amount - budget.spent;

  return (
    <div
      className="budget-item budget-item-clickable"
      onClick={() => navigate(`/transactions?category_id=${budget.category_id}&period=${period}`)}
    >
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
      <div className="budget-bar-track">
        <div
          className={`budget-bar-fill${over ? ' over' : ''}`}
          style={{ width: `${pct}%`, background: over ? undefined : (budget.category_color || '#6366f1') }}
        />
      </div>
      <div className="budget-item-footer">
        {over
          ? <span className="text-danger">{formatCurrency(Math.abs(remaining))} {t.dashboard.over}</span>
          : <span className="text-muted">{formatCurrency(remaining)} {t.dashboard.remaining}</span>
        }
        <span className="text-muted">{Math.round(pct)} %</span>
      </div>
    </div>
  );
}

function AnnualBudgetBar({ budget, year }) {
  const navigate = useNavigate();
  const pct = budget.amount > 0 ? Math.min((budget.spent / budget.amount) * 100, 100) : 0;
  const over = budget.spent > budget.amount;
  const remaining = budget.amount - budget.spent;

  return (
    <div
      className="budget-item budget-item-clickable"
      onClick={() => navigate(`/transactions?category_id=${budget.category_id}&from=${year}-01-01&to=${year}-12-31`)}
    >
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
      <div className="budget-bar-track">
        <div
          className={`budget-bar-fill${over ? ' over' : ''}`}
          style={{ width: `${pct}%`, background: over ? undefined : (budget.category_color || '#6366f1') }}
        />
      </div>
      <div className="budget-item-footer">
        {over
          ? <span className="text-danger">{formatCurrency(Math.abs(remaining))} přečerpáno za rok</span>
          : <span className="text-muted">{formatCurrency(remaining)} zbývá do konce roku</span>
        }
        <span className="text-muted">{Math.round(pct)} %</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [period, setPeriod] = useState(null);   // periodKey "YYYY-MM"
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [currentPeriod, setCurrentPeriod] = useState(null);
  const [data, setData] = useState(null);
  const [budgets, setBudgets] = useState(null);
  const [annualBudgets, setAnnualBudgets] = useState(null);
  const [loading, setLoading] = useState(true);

  // Načti nastavení → zjisti aktuální období
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(s => {
        setPeriod(s.current_period);
        setCurrentPeriod(s.current_period);
      });
  }, []);

  // Načti data při změně období
  useEffect(() => {
    if (!period) return;
    setLoading(true);
    const year = new Date().getFullYear();
    Promise.all([
      fetch(`/api/stats/overview?period=${period}`).then(r => r.json()),
      fetch(`/api/budgets?period=${period}`).then(r => r.json()),
      fetch(`/api/annual-budgets?year=${year}`).then(r => r.json()),
    ]).then(([stats, buds, annual]) => {
      setData(stats);
      setPeriodStart(stats.period_start);
      setPeriodEnd(stats.period_end);
      setBudgets(buds.budgets);
      setAnnualBudgets(annual.budgets);
    }).finally(() => setLoading(false));
  }, [period]);

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
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setPeriod(p => addPeriods(p, 1))}
              disabled={period >= currentPeriod}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="page-loading">{t.common.loading}</div>
      ) : (
        <div className="dashboard-content">
          <div className="stat-card">
            <div className="stat-card-icon"><TrendingDown size={20} /></div>
            <div>
              <div className="stat-card-label">{t.dashboard.totalSpent}</div>
              <div className="stat-card-value">{formatCurrency(data?.total_spent || 0)}</div>
            </div>
          </div>

          <section className="section">
            <h2 className="section-title">{t.dashboard.budgets}</h2>
            {!budgets?.length ? (
              <div className="empty-state">
                <p>{t.dashboard.noBudgets}</p>
                <p className="text-muted">{t.dashboard.noBudgetsHint}</p>
              </div>
            ) : (
              <div className="budget-list">
                {budgets.map(b => <BudgetBar key={b.category_id} budget={b} period={period} />)}
              </div>
            )}
          </section>

          {annualBudgets?.length > 0 && (
            <section className="section">
              <h2 className="section-title">Roční rozpočty</h2>
              <div className="budget-list">
                {annualBudgets.map(b => <AnnualBudgetBar key={b.id} budget={b} year={new Date().getFullYear()} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </Layout>
  );
}
