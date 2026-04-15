import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, TrendingDown } from 'lucide-react';
import Layout from '../components/Layout';
import { t, formatCurrency, formatPeriod, addPeriods } from '../i18n';

const MONTHS_SHORT = ['led','úno','bře','dub','kvě','čvn','čvc','srp','zář','říj','lis','pro'];

function windowLabel(ws, we) {
  if (ws === 1 && we === 12) return 'celý rok';
  if (ws === we) return MONTHS_SHORT[ws - 1];
  return `${MONTHS_SHORT[ws - 1]}–${MONTHS_SHORT[we - 1]}`;
}

function getItemStatus(item, year) {
  const now = new Date();
  const cm = now.getMonth() + 1;
  if (item.spent >= item.amount) return 'paid';
  if (year !== now.getFullYear()) return item.spent > 0 ? 'partial' : 'missed';
  const sameYear = item.window_start <= item.window_end;
  const inWindow = sameYear
    ? cm >= item.window_start && cm <= item.window_end
    : cm >= item.window_start || cm <= item.window_end;
  const windowPast = sameYear ? cm > item.window_end : false;
  if (inWindow) return 'active';
  if (windowPast) return item.spent > 0 ? 'partial' : 'missed';
  return 'waiting';
}

const STATUS_ICON = { paid: '✅', active: '🟡', waiting: '⏳', partial: '⚠️', missed: '⚠️' };
const STATUS_CLS  = { paid: '',   active: 'text-warn', waiting: 'text-muted', partial: 'text-warn', missed: 'text-danger' };

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

// ── Typ 2 na dashboardu ───────────────────────────────────────────────────────

function Type2Card({ cat, items, year }) {
  const navigate = useNavigate();
  if (items.length === 0) return null;

  return (
    <div className="budget-item" style={{ cursor: 'default' }}>
      <div className="budget-item-header">
        <div className="budget-item-name">
          <span className="budget-dot" style={{ background: cat.color || '#6366f1' }} />
          <span style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/transactions?category_id=${cat.id}&from=${year}-01-01&to=${year}-12-31`)}>
            {cat.name}
          </span>
        </div>
      </div>
      <div className="type2-items-list type2-items-list--compact">
        {items.map(item => {
          const st = getItemStatus(item, year);
          return (
            <div key={item.id} className="type2-item-row">
              <span className="type2-item-name">{item.name}</span>
              <span className="type2-item-window text-muted">{windowLabel(item.window_start, item.window_end)}</span>
              <span className={`type2-item-spent${item.spent > item.amount ? ' text-danger' : ''}`}>
                {formatCurrency(item.spent)}
              </span>
              <span className="type2-item-amount text-muted">/ {formatCurrency(item.amount)}</span>
              <span className={STATUS_CLS[st]}>{STATUS_ICON[st]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Typ 3 na dashboardu ───────────────────────────────────────────────────────

function FundCard({ fund }) {
  const navigate = useNavigate();
  const year = new Date().getFullYear();
  return (
    <div className="budget-item" style={{ cursor: 'default' }}>
      <div className="budget-item-header">
        <div className="budget-item-name">
          <span className="budget-dot" style={{ background: fund.color || '#6366f1' }} />
          <span style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/transactions?category_id=${fund.id}&from=${year}-01-01&to=${year}-12-31`)}>
            {fund.name}
          </span>
        </div>
      </div>
      <div className="fund-info-row">
        {fund.typical_price && (
          <span className="fund-info-item">
            <span className="text-muted">typická cena</span>
            <strong>{formatCurrency(fund.typical_price)}</strong>
          </span>
        )}
        {fund.monthly_contribution && (
          <span className="fund-info-item">
            <span className="text-muted">příspěvek / měsíc</span>
            <strong>~{formatCurrency(fund.monthly_contribution)}</strong>
          </span>
        )}
        <span className="fund-info-item">
          <span className="text-muted">naposledy</span>
          <strong>
            {fund.last_payment_date
              ? fund.months_since_last === 0 ? 'tento měsíc' : `před ${fund.months_since_last} měs.`
              : 'nikdy'}
          </strong>
        </span>
        <span className="fund-info-item">
          <span className="text-muted">letos</span>
          <strong>{formatCurrency(fund.total_year)}</strong>
        </span>
      </div>
    </div>
  );
}

// ── Hlavní komponenta ─────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [period, setPeriod] = useState(null);
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [currentPeriod, setCurrentPeriod] = useState(null);
  const [data, setData] = useState(null);
  const [budgets, setBudgets] = useState(null);
  const [categories, setCategories] = useState([]);
  const [budgetItems, setBudgetItems] = useState([]);
  const [funds, setFunds] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(s => {
      setPeriod(s.current_period);
      setCurrentPeriod(s.current_period);
    });
  }, []);

  useEffect(() => {
    if (!period) return;
    setLoading(true);
    const year = new Date().getFullYear();
    Promise.all([
      fetch(`/api/stats/overview?period=${period}`).then(r => r.json()),
      fetch(`/api/budgets?period=${period}`).then(r => r.json()),
      fetch('/api/categories').then(r => r.json()),
      fetch(`/api/budget-items?year=${year}`).then(r => r.json()),
      fetch(`/api/categories/fund-status?year=${year}`).then(r => r.json()),
    ]).then(([stats, buds, cats, items, fundStatus]) => {
      setData(stats);
      setPeriodStart(stats.period_start);
      setPeriodEnd(stats.period_end);
      // Měsíční rozpočty: jen Typ 1
      setBudgets((buds.budgets || []).filter(b => !b.category_type || b.category_type === 1));
      setCategories(cats);
      setBudgetItems(items.items || []);
      setFunds(fundStatus || []);
    }).finally(() => setLoading(false));
  }, [period]);

  const type2Cats = categories.filter(c => c.type === 2);
  const type3Cats = categories.filter(c => c.type === 3);
  const year = new Date().getFullYear();

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

          {/* Typ 1 – Měsíční */}
          <section className="section">
            <h2 className="section-title">{t.dashboard.budgets}</h2>
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

          {/* Typ 2 – Roční / sezónní */}
          {type2Cats.length > 0 && (
            <section className="section">
              <h2 className="section-title">Roční / sezónní</h2>
              <div className="budget-list">
                {type2Cats.map(cat => {
                  const items = budgetItems.filter(i => i.category_id === cat.id);
                  return <Type2Card key={cat.id} cat={cat} items={items} year={year} />;
                }).filter(Boolean)}
              </div>
              {type2Cats.every(cat => budgetItems.filter(i => i.category_id === cat.id).length === 0) && (
                <div className="empty-state">
                  <p className="text-muted">Žádné podpoložky. Nakonfigurujte je v sekci Rozpočty.</p>
                </div>
              )}
            </section>
          )}

          {/* Typ 3 – Fond obnovy */}
          {type3Cats.length > 0 && (
            <section className="section">
              <h2 className="section-title">Fond obnovy</h2>
              <div className="budget-list">
                {funds.map(f => <FundCard key={f.id} fund={f} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </Layout>
  );
}
