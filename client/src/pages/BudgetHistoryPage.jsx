import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Table2 } from 'lucide-react';
import Layout from '../components/Layout';
import SpendLineChart from '../components/SpendLineChart';
import { t, formatCurrency } from '../i18n';
import { assignColors, shortPeriodLabel, signPrefix, periodAverage, summarizeLimit } from '../utils/chartScale';

const DEFAULT_ACTIVE = 5;   // víc křivek naráz už se nedá číst

export default function BudgetHistoryPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeIds, setActiveIds] = useState(null);   // null = ještě nevybráno
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const qs = range.from && range.to ? `?from=${range.from}&to=${range.to}` : '';
    setLoading(true);
    fetch(`/api/stats/budget-history${qs}`)
      .then(async r => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Načtení se nepovedlo.');
        return body;
      })
      .then(d => {
        setError('');
        setData(d);
        // Rozsah se dopočítá na serveru (default = posledních 12 období),
        // takže inputy naplní až odpověď.
        setRange(prev => (prev.from && prev.to ? prev : { from: d.from, to: d.to }));
        setActiveIds(prev => {
          const available = new Set(d.series.map(s => s.category_id));
          const kept = prev ? [...prev].filter(id => available.has(id)) : [];
          return new Set(kept.length ? kept : d.series.slice(0, DEFAULT_ACTIVE).map(s => s.category_id));
        });
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  // Referenčně stabilní pole — graf si na jejich identitě drží stav zaměřovače,
  // takže nová instance při každém renderu by hover shazovala.
  const series = useMemo(() => data?.series || [], [data]);
  const periods = useMemo(() => data?.periods || [], [data]);
  // Barvy se přiřazují CELÉ sadě, ne jen zapnutým sériím — jinak by vypnutí
  // jedné kategorie přebarvilo zbytek grafu.
  const colors = useMemo(() => assignColors(series), [series]);
  const activeSeries = useMemo(
    () => series.filter(s => activeIds?.has(s.category_id)),
    [series, activeIds]
  );

  function toggle(id) {
    setActiveIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function openTransactions(categoryId, periodIndex) {
    const key = periods[periodIndex]?.key;
    if (!key) return;
    navigate(`/transactions?period=${key}&category_id=${categoryId}&spending_only=1`);
  }

  // Souhrnná čísla dávají smysl jen u jediné vybrané kategorie — u víc sérií
  // by „průměr" a „limit" nebylo jasné, čeho se týkají.
  const solo = activeSeries.length === 1 ? activeSeries[0] : null;
  const soloLimit = solo ? summarizeLimit(solo.limits) : null;

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{t.nav.budgetHistory}</h1>
      </div>

      <div className="chart-filters">
        <label className="chart-filter">
          <span>Od</span>
          <input
            type="month" className="input" value={range.from}
            max={range.to || undefined}
            onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
          />
        </label>
        <label className="chart-filter">
          <span>Do</span>
          <input
            type="month" className="input" value={range.to}
            min={range.from || undefined}
            onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
          />
        </label>
        <button
          className={`btn btn-ghost${showTable ? ' active' : ''}`}
          onClick={() => setShowTable(v => !v)}
        >
          {showTable ? <BarChart3 size={16} /> : <Table2 size={16} />}
          {showTable ? 'Graf' : 'Tabulka'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!error && data && series.length === 0 && (
        <div className="card empty-state">Ve zvoleném rozsahu nejsou žádné výdaje.</div>
      )}

      {!error && data && series.length > 0 && (
        // Při načítání nového rozsahu zůstává předchozí vykreslení ztlumené —
        // žádný skeleton a žádný poskok layoutu.
        <div className={`card chart-card${loading ? ' is-loading' : ''}`}>
          {solo && (
            <div className="chart-stats">
              <div className="chart-stat">
                <span className="chart-stat-label">Celkem za období</span>
                <span className="chart-stat-value">{signPrefix(solo.total)}{formatCurrency(solo.total)}</span>
                <span className="chart-stat-note">{solo.name}</span>
              </div>
              <div className="chart-stat">
                <span className="chart-stat-label">Průměr měsíčně</span>
                <span className="chart-stat-value">
                  {(() => { const a = periodAverage(solo.values); return <>{signPrefix(a)}{formatCurrency(a)}</>; })()}
                </span>
                <span className="chart-stat-note">{periods.length} období včetně nulových</span>
              </div>
              <div className="chart-stat">
                <span className="chart-stat-label">Měsíční limit</span>
                <span className="chart-stat-value">
                  {soloLimit
                    ? (soloLimit.varies
                        ? `${formatCurrency(soloLimit.min)} – ${formatCurrency(soloLimit.max)}`
                        : formatCurrency(soloLimit.max))
                    : '—'}
                </span>
                <span className="chart-stat-note">
                  {soloLimit ? (soloLimit.varies ? 'liší se podle období' : 'rozpočet kategorie') : 'bez měsíčního rozpočtu'}
                </span>
              </div>
            </div>
          )}

          {showTable ? (
            <HistoryTable periods={periods} series={activeSeries} colors={colors} />
          ) : (
            <SpendLineChart
              periods={periods}
              series={activeSeries}
              colors={colors}
              onPointClick={openTransactions}
            />
          )}

          <div className="chart-legend">
            <div className="chart-legend-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setActiveIds(new Set(series.map(s => s.category_id)))}>Vše</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setActiveIds(new Set())}>Nic</button>
            </div>
            {series.map(s => {
              const on = activeIds?.has(s.category_id);
              return (
                <button
                  key={s.category_id}
                  className={`chart-legend-item${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggle(s.category_id)}
                >
                  <span className="chart-legend-key" style={{ background: colors.get(s.category_id) }} />
                  <span className="chart-legend-name">{s.name}</span>
                  <span className="chart-legend-total">{signPrefix(s.total)}{formatCurrency(s.total)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loading && !data && <div className="page-loading">Načítám…</div>}
    </Layout>
  );
}

// Tabulkový pohled — stejná data bez hoveru, aby žádná hodnota nebyla
// dostupná jen přes tooltip.
function HistoryTable({ periods, series, colors }) {
  if (!series.length) return <div className="empty-state">Zapněte alespoň jednu kategorii.</div>;
  return (
    <div className="chart-table-scroll">
      <table className="chart-table">
        <thead>
          <tr>
            <th>Období</th>
            {series.map(s => (
              <th key={s.category_id} className="num">
                <span className="chart-legend-key" style={{ background: colors.get(s.category_id) }} />
                {s.name}
              </th>
            ))}
            <th className="num">Celkem</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p, i) => {
            const sum = series.reduce((acc, s) => acc + (s.values[i] || 0), 0);
            return (
              <tr key={p.key}>
                <td>{shortPeriodLabel(p.key)}</td>
                {series.map(s => (
                  <td key={s.category_id} className="num">
                    {signPrefix(s.values[i])}{formatCurrency(s.values[i] || 0)}
                  </td>
                ))}
                <td className="num strong">{signPrefix(sum)}{formatCurrency(sum)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
