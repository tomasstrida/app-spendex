import { useState, useEffect } from 'react';
import { usePeriod } from '../contexts/PeriodContext';
import { usePeriodKeys } from '../hooks/usePeriodKeys';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Layout from '../components/Layout';
import { t, formatCurrency, formatPeriod, addPeriods } from '../i18n';
import { computeMeetingSurplus } from '../utils/meetingBalance';

export default function SavingsPage() {
  const { period, setPeriod, currentPeriod, resetToCurrent } = usePeriod();
  usePeriodKeys();
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [stats, setStats] = useState(null);            // savings + by_category + variable_pool_funded
  const [incomeSources, setIncomeSources] = useState([]);
  const [fixedExpenses, setFixedExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);           // Typ 1
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!period) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/stats/overview?period=${period}`).then(r => r.json()),
      fetch(`/api/income?period=${period}`).then(r => r.json()),
      fetch(`/api/fixed-expenses?period=${period}`).then(r => r.json()),
      fetch(`/api/budgets?period=${period}`).then(r => r.json()),
    ]).then(([st, inc, fixed, bud]) => {
      setStats(st);
      setIncomeSources(inc.sources || []);
      setFixedExpenses(Array.isArray(fixed) ? fixed : []);
      setBudgets((bud.budgets || []).filter(b => !b.category_type || b.category_type === 1));
      setPeriodStart(bud.period_start);
      setPeriodEnd(bud.period_end);
    }).finally(() => setLoading(false));
  }, [period]);

  const savings = stats?.savings || { deposits: 0, withdrawals: 0, net: 0, transfers: [] };
  const transfers = savings.transfers || [];

  // Plánovaný přebytek ze Schůzky — stejná pravda přes sdílený helper.
  const { surplus } = computeMeetingSurplus({
    incomeSources,
    fixedExpenses,
    budgetsType1: budgets,
    byCategory: stats?.by_category || [],
    variablePoolFunded: stats?.variable_pool_funded || 0,
  });

  function txLink(extra) {
    const base = period ? `period=${period}` : '';
    return `/transactions?${base}${extra ? '&' + extra : ''}`;
  }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Spořicí účet</h1>
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
            <button className="btn btn-ghost" onClick={resetToCurrent} disabled={period === currentPeriod}
              title={t.period.resetToCurrent}>
              {t.period.resetToCurrent}
            </button>
          </div>
        )}
      </div>

      {loading ? <div className="page-loading">Načítání…</div> : (
        <div className="report-layout">

          {/* ── PŘEVEDENO NA SPOŘICÍ (net) ── */}
          <section className="report-section">
            <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
              <div className="text-muted" style={{ fontSize: 13, marginBottom: 4 }}>Převedeno na spořicí</div>
              <div className={`savings-net ${savings.net >= 0 ? 'text-success' : 'text-danger'}`}
                style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1 }}>
                {savings.net >= 0 ? '+' : '−'} {formatCurrency(Math.abs(savings.net))}
              </div>
              <div className="text-muted" style={{ fontSize: 13, marginTop: 6 }}>
                vklady {formatCurrency(savings.deposits)} · výběry {formatCurrency(savings.withdrawals)}
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
              <div className="report-bilance-row">
                <span>Na spořicí (přebytek)</span>
                <span>{surplus >= 0 ? '+' : '−'} {formatCurrency(Math.abs(surplus))}</span>
              </div>
            </div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
              „Na spořicí (přebytek)" = přebytek ze Schůzky (příjmy minus výdaje).
            </div>
          </section>

          {/* ── PŘEVODY V OBDOBÍ ── */}
          <section className="report-section">
            <div className="report-section-header">
              <h2 className="report-section-title">Převody v období</h2>
            </div>
            {transfers.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>
                V tomto období žádné převody na spořicí účet.
              </p>
            ) : (
              <div className="report-budget-list">
                {transfers.map(tr => {
                  // amount je z pohledu zdrojového účtu: záporné = vklad na spořicí
                  // (na spoření přibylo), kladné = výběr zpět na provoz.
                  const onSavings = -tr.amount;   // z pohledu spořicího účtu
                  return (
                    <Link key={tr.id} to={txLink(`highlight=${tr.id}`)}
                      className="report-budget-row"
                      style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
                      <span className="report-budget-name">
                        <span className="text-muted" style={{ marginRight: 8 }}>
                          {`${+tr.date.slice(8, 10)}. ${+tr.date.slice(5, 7)}.`}
                        </span>
                        {tr.description || (onSavings >= 0 ? 'Vklad na spořicí' : 'Výběr ze spořicího')}
                        {tr.is_regular && (
                          <span className="text-muted" style={{ fontSize: 11, marginLeft: 6 }}>· pravidelný</span>
                        )}
                        {tr.note && <span className="text-muted" style={{ display: 'block', fontSize: 11 }}>{tr.note}</span>}
                      </span>
                      <span className={onSavings >= 0 ? 'text-success' : 'text-danger'} style={{ fontWeight: 600 }}>
                        {onSavings >= 0 ? '+' : '−'} {formatCurrency(Math.abs(onSavings))}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
            <div className="report-subtotal">
              <span>Net za období</span>
              <span className={savings.net >= 0 ? 'text-success' : 'text-danger'}>
                {savings.net >= 0 ? '+' : '−'} {formatCurrency(Math.abs(savings.net))}
              </span>
            </div>
          </section>

        </div>
      )}
    </Layout>
  );
}
