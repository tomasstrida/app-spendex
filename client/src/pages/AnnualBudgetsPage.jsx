import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePeriod } from '../contexts/PeriodContext';
import Layout from '../components/Layout';
import YearThermometer from '../components/YearThermometer';
import { t, formatCurrency, addPeriods } from '../i18n';

export default function AnnualBudgetsPage() {
  const { period, setPeriod, currentPeriod, resetToCurrent } = usePeriod();
  const [budgetItems, setBudgetItems] = useState([]);
  const [yearSpent, setYearSpent] = useState({});   // category_id → roční utraceno
  const [byCategory, setByCategory] = useState([]);
  const [loading, setLoading] = useState(true);

  const year = period ? Number(period.split('-')[0]) : new Date().getFullYear();
  const currentYear = currentPeriod ? Number(currentPeriod.split('-')[0]) : year;

  useEffect(() => {
    if (!period) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/budget-items?year=${year}`).then(r => r.json()),
      fetch(`/api/stats/overview?period=${period}`).then(r => r.json()),
    ]).then(([items, st]) => {
      setBudgetItems(items.items || []);
      setYearSpent(items.category_year_spent || {});
      setByCategory(st?.by_category || []);
    }).finally(() => setLoading(false));
  }, [period, year]);

  // Roční rozpočet po kategoriích = součet podpoložek dané kategorie
  const budgetByCat = {};
  budgetItems.forEach(i => { budgetByCat[i.category_id] = (budgetByCat[i.category_id] || 0) + (i.amount || 0); });

  // Zobraz roční kategorii (Typ 2), pokud má roční utraceno > 0 NEBO roční rozpočet > 0
  const cats = byCategory.filter(c => c.type === 2 && ((yearSpent[c.id] || 0) > 0 || (budgetByCat[c.id] || 0) > 0));
  const totalSpent  = Object.values(yearSpent).reduce((s, n) => s + (n || 0), 0);
  const totalBudget = Object.values(budgetByCat).reduce((s, n) => s + (n || 0), 0);

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{t.nav.annualBudgets}</h1>
        {period && (
          <div className="month-nav">
            <button className="btn btn-ghost btn-icon" onClick={() => setPeriod(p => addPeriods(p, -12))}>
              <ChevronLeft size={18} />
            </button>
            <span className="month-label">{year}</span>
            <button className="btn btn-ghost btn-icon"
              onClick={() => setPeriod(p => addPeriods(p, 12))}
              disabled={year >= currentYear}>
              <ChevronRight size={18} />
            </button>
            <button className="btn btn-ghost" onClick={resetToCurrent}
              disabled={year === currentYear} title={t.period.resetToCurrent}>
              {t.period.resetToCurrent}
            </button>
          </div>
        )}
      </div>

      {loading ? <div className="page-loading">Načítání…</div> : (
        <div className="report-layout">
          <section className="report-section">
            {cats.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>Žádné roční rozpočty pro rok {year}.</p>
            ) : (
              <>
                <div className="report-budget-row" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 4 }}>
                  <span className="report-budget-dot" style={{ background: 'transparent' }} />
                  <span className="report-budget-name">Kategorie</span>
                  <span className="report-budget-spent">Utraceno za rok</span>
                  <span className="report-budget-limit" style={{ whiteSpace: 'nowrap' }}>Roční rozpočet</span>
                  <span className="report-budget-status" />
                </div>
                <div className="report-budget-list">
                  {cats.map(c => {
                    const spent = yearSpent[c.id] || 0;
                    const budget = budgetByCat[c.id] || 0;
                    const over = budget > 0 && spent > budget;
                    const to = `/transactions?category_id=${c.id}&from=${year}-01-01&to=${year}-12-31`;
                    return (
                      <Link key={c.id} to={to} className="report-budget-card" style={{ color: 'inherit' }}>
                        <div className="report-budget-row">
                          <span className="report-budget-dot" style={{ background: c.color || '#6366f1' }} />
                          <span className="report-budget-name">{c.name}</span>
                          <span className={`report-budget-spent${over ? ' text-danger' : ''}`}>{formatCurrency(spent)}</span>
                          <span className="text-muted report-budget-limit">{budget > 0 ? `/ ${formatCurrency(budget)}` : ''}</span>
                          <span className="report-budget-status" />
                        </div>
                        {budget > 0 && (
                          <YearThermometer spent={spent} amount={budget} year={year} color={c.color} />
                        )}
                      </Link>
                    );
                  })}
                </div>
                <div className="report-subtotal">
                  <span>Roční budgety celkem · {year}</span>
                  <span>
                    {formatCurrency(totalSpent)}
                    {totalBudget > 0 && (
                      <span className="text-muted" style={{ fontWeight: 400 }}> / {formatCurrency(totalBudget)}</span>
                    )}
                  </span>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </Layout>
  );
}
