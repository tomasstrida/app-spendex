import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, TrendingDown } from 'lucide-react';
import Layout from '../components/Layout';
import { t, formatCurrency, formatMonth, currentMonth, addMonths } from '../i18n';

function BudgetBar({ budget }) {
  const pct = budget.amount > 0 ? Math.min((budget.spent / budget.amount) * 100, 100) : 0;
  const over = budget.spent > budget.amount;
  const remaining = budget.amount - budget.spent;

  return (
    <div className="budget-item">
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

export default function DashboardPage() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState(null);
  const [budgets, setBudgets] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/stats/overview?month=${month}`).then(r => r.json()),
      fetch(`/api/budgets?month=${month}`).then(r => r.json()),
    ]).then(([stats, buds]) => {
      setData(stats);
      setBudgets(buds);
    }).finally(() => setLoading(false));
  }, [month]);

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{t.dashboard.title}</h1>
        <div className="month-nav">
          <button className="btn btn-ghost btn-icon" onClick={() => setMonth(m => addMonths(m, -1))}>
            <ChevronLeft size={18} />
          </button>
          <span className="month-label">{formatMonth(month)}</span>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setMonth(m => addMonths(m, 1))}
            disabled={month >= currentMonth()}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">{t.common.loading}</div>
      ) : (
        <div className="dashboard-content">
          {/* Celkem utraceno */}
          <div className="stat-card">
            <div className="stat-card-icon"><TrendingDown size={20} /></div>
            <div>
              <div className="stat-card-label">{t.dashboard.totalSpent}</div>
              <div className="stat-card-value">{formatCurrency(data?.total_spent || 0)}</div>
            </div>
          </div>

          {/* Rozpočty */}
          <section className="section">
            <h2 className="section-title">{t.dashboard.budgets}</h2>
            {budgets?.length === 0 ? (
              <div className="empty-state">
                <p>{t.dashboard.noBudgets}</p>
                <p className="text-muted">{t.dashboard.noBudgetsHint}</p>
              </div>
            ) : (
              <div className="budget-list">
                {budgets?.map(b => <BudgetBar key={b.id} budget={b} />)}
              </div>
            )}
          </section>
        </div>
      )}
    </Layout>
  );
}
