import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, LineChart } from 'lucide-react';
import { usePeriod } from '../contexts/PeriodContext';
import Layout from '../components/Layout';
import YearThermometer from '../components/YearThermometer';
import { t, formatCurrency, addPeriods } from '../i18n';

const MONTH_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

// Kumulativní graf čerpání ročního budgetu: skutečnost (běžící součet) vs lineární plán.
function CumulativeChart({ monthly, budget, year, color }) {
  const W = 360, H = 150, padL = 6, padR = 6, padT = 14, padB = 20;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const fill = color || '#6366f1';

  const today = new Date();
  const lastReal = year < today.getFullYear() ? 11
    : year > today.getFullYear() ? -1
    : today.getMonth(); // index 0–11

  const cum = [];
  let run = 0;
  for (let i = 0; i < 12; i++) { run += monthly[i] || 0; cum[i] = run; }

  const plan = i => (budget * (i + 1)) / 12;
  const maxY = Math.max(budget, cum[Math.max(0, lastReal)] || 0, 1) * 1.08;

  const x = i => padL + (i / 11) * innerW;
  const y = v => padT + innerH - (v / maxY) * innerH;

  // plán: lineárně k budgetu přes 12 měsíců
  const planPts = Array.from({ length: 12 }, (_, i) => `${x(i)},${y(plan(i))}`).join(' ');
  // skutečnost: jen do posledního reálného měsíce
  const realIdx = Array.from({ length: lastReal + 1 }, (_, i) => i);
  const realPts = realIdx.map(i => `${x(i)},${y(cum[i])}`).join(' ');
  const areaPath = realIdx.length
    ? `M${x(0)},${y(0)} ` + realIdx.map(i => `L${x(i)},${y(cum[i])}`).join(' ') + ` L${x(lastReal)},${y(0)} Z`
    : '';

  // gridlines (čtvrtiny)
  const grid = [0.25, 0.5, 0.75, 1].map(f => y(maxY * f / 1.08));

  return (
    <div style={{ marginTop: 8 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {grid.map((gy, i) => (
          <line key={i} x1={padL} y1={gy} x2={W - padR} y2={gy}
            stroke="var(--border)" strokeWidth="0.5" />
        ))}
        {areaPath && <path d={areaPath} fill={fill} opacity="0.12" />}
        {/* plán */}
        <polyline points={planPts} fill="none" stroke="var(--text2)"
          strokeWidth="1.5" strokeDasharray="4 3" />
        {/* skutečnost */}
        {realPts && <polyline points={realPts} fill="none" stroke={fill} strokeWidth="2" />}
        {realIdx.map(i => (
          <circle key={i} cx={x(i)} cy={y(cum[i])} r="2.5" fill={fill} />
        ))}
        {MONTH_LABELS.map((m, i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle"
            fontSize="9" fill="var(--text2)">{m}</text>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text2)', marginTop: 2, paddingLeft: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 14, height: 2, background: fill, display: 'inline-block' }} /> kumulativně utraceno
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 14, height: 0, borderTop: '1.5px dashed var(--text2)', display: 'inline-block' }} /> plán
        </span>
      </div>
    </div>
  );
}

export default function AnnualBudgetsPage() {
  const { period, setPeriod, currentPeriod, resetToCurrent } = usePeriod();
  const [budgetItems, setBudgetItems] = useState([]);
  const [yearSpent, setYearSpent] = useState({});   // category_id → roční utraceno
  const [monthSpent, setMonthSpent] = useState({}); // category_id → [12] měsíčně
  const [byCategory, setByCategory] = useState([]);
  const [subcatYearSpent, setSubcatYearSpent] = useState({}); // category_id → [{subcategory_id,name,spent}]
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});       // category_id → bool (rozbalený graf)
  const [subExpanded, setSubExpanded] = useState({}); // category_id → bool (rozbalený rozpad subkategorií)

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
      setMonthSpent(items.category_month_spent || {});
      setSubcatYearSpent(items.category_subcategory_year_spent || {});
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
                    const isOpen = !!expanded[c.id];
                    const monthly = monthSpent[c.id] || Array(12).fill(0);
                    const subcats = subcatYearSpent[c.id] || [];
                    const hasSubcats = subcats.length > 0;
                    const isSubOpen = hasSubcats && !!subExpanded[c.id];
                    const to = `/transactions?category_id=${c.id}&from=${year}-01-01&to=${year}-12-31`;
                    return (
                      <div key={c.id} className="report-budget-card" style={{ color: 'inherit' }}>
                        <Link to={to} className="report-budget-row" style={{ color: 'inherit', textDecoration: 'none' }}>
                          <span className="report-budget-dot" style={{ background: c.color || '#6366f1' }} />
                          <span className="report-budget-name">
                            {hasSubcats && (
                              <button
                                type="button"
                                className="report-subcat-toggle"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSubExpanded(prev => ({ ...prev, [c.id]: !prev[c.id] })); }}
                                title={isSubOpen ? 'Skrýt rozpad subkategorií' : 'Zobrazit rozpad subkategorií'}
                              >
                                {isSubOpen ? '▾' : '▸'}
                              </button>
                            )}
                            {c.name}
                          </span>
                          <span className={`report-budget-spent${over ? ' text-danger' : ''}`}>{formatCurrency(spent)}</span>
                          <span className="text-muted report-budget-limit">{budget > 0 ? `/ ${formatCurrency(budget)}` : ''}</span>
                          <span className="report-budget-status" />
                        </Link>
                        {isSubOpen && (
                          <div className="report-subcat-list">
                            {subcats.map(s => (
                              <Link
                                key={s.subcategory_id}
                                to={`/transactions?category_id=${c.id}&subcategory_id=${s.subcategory_id}&from=${year}-01-01&to=${year}-12-31`}
                                className="report-subcat-row"
                                style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                              >
                                <span className="report-subcat-name">{s.name}</span>
                                <span className="report-subcat-spent">{formatCurrency(s.spent)}</span>
                              </Link>
                            ))}
                          </div>
                        )}
                        {budget > 0 && (
                          <YearThermometer spent={spent} amount={budget} year={year} />
                        )}
                        <button type="button" className="btn btn-ghost"
                          style={{ fontSize: 12, marginTop: 4, padding: '2px 6px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          onClick={() => setExpanded(prev => ({ ...prev, [c.id]: !prev[c.id] }))}>
                          <LineChart size={14} />
                          {isOpen ? 'Skrýt čerpání v čase' : 'Čerpání v čase'}
                        </button>
                        {isOpen && (
                          <CumulativeChart monthly={monthly} budget={budget} year={year} color={c.color} />
                        )}
                      </div>
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
