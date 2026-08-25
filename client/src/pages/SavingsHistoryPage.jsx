import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { BarChart3, Table2 } from 'lucide-react';
import Layout from '../components/Layout';
import SavingsHistoryChart from '../components/SavingsHistoryChart';
import { t, formatCurrency } from '../i18n';
import { shortPeriodLabel, signPrefix, periodAverage } from '../utils/chartScale';

export default function SavingsHistoryPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTable, setShowTable] = useState(false);
  const [showDerived, setShowDerived] = useState(true);
  const [showActual, setShowActual] = useState(true);

  useEffect(() => {
    const qs = range.from && range.to ? `?from=${range.from}&to=${range.to}` : '';
    setLoading(true);
    fetch(`/api/stats/savings-history${qs}`)
      .then(async r => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Načtení se nepovedlo.');
        return body;
      })
      .then(d => {
        setError('');
        setData(d);
        // Rozsah dopočítává server (default = od ledna, minimálně 6 období,
        // včetně běžícího) → inputy naplní až odpověď.
        setRange(prev => (prev.from && prev.to ? prev : { from: d.from, to: d.to }));
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [range.from, range.to]);

  const periods = useMemo(() => data?.periods || [], [data]);
  const values = useMemo(() => data?.values || [], [data]);
  const hasActual = values.some(v => v.balance_actual != null);

  // Proklik jde přes tx_ids, ne přes období — součty jsou JS-počítané přes dedup
  // noh převodů, takže filtr podle data a účtu by vrátil i zahozené protějšky.
  // `period` musí jet v URL taky — bez něj TransactionsPage AND-uje aktuálně
  // zvolené období z PeriodContext a proklik na jiné období vrátí prázdno
  // (tx_ids se jen zužuje na rozsah, nenahrazuje ho).
  function openTransactions(index) {
    const ids = values[index]?.tx_ids || [];
    if (!ids.length) return;
    const period = periods[index]?.key;
    navigate(`/transactions?tx_ids=${ids.join(',')}${period ? `&period=${period}` : ''}`);
  }

  // Chart nesmí znát tx_ids — jen boolean per období, ať ví, kdy nemá kreslit
  // cursor:pointer (klik na prázdné období je no-op, viz openTransactions výše).
  const clickablePeriods = useMemo(() => values.map(v => (v.tx_ids || []).length > 0), [values]);

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{t.nav.savingsHistory}</h1>
        <Link className="btn btn-ghost" to="/savings">{t.nav.savings}</Link>
      </div>

      <div className="chart-filters">
        <label className="chart-filter">
          <span>Od</span>
          <input type="month" className="input" value={range.from} max={range.to || undefined}
                 onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
        </label>
        <label className="chart-filter">
          <span>Do</span>
          <input type="month" className="input" value={range.to} min={range.from || undefined}
                 onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
        </label>
        <button className={`btn btn-ghost${showTable ? ' active' : ''}`} onClick={() => setShowTable(v => !v)}>
          {showTable ? <BarChart3 size={16} /> : <Table2 size={16} />}
          {showTable ? 'Graf' : 'Tabulka'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!error && data && (
        <div className={`card chart-card${loading ? ' is-loading' : ''}`}>
          <div className="chart-stats">
            <div className="chart-stat">
              <span className="chart-stat-label">Naspořeno za rozsah</span>
              <span className="chart-stat-value">{signPrefix(data.totals.net)}{formatCurrency(data.totals.net)}</span>
              <span className="chart-stat-note">
                vklady {formatCurrency(data.totals.deposits)} · výběry {formatCurrency(data.totals.withdrawals)}
              </span>
            </div>
            <div className="chart-stat">
              <span className="chart-stat-label">Průměr měsíčně</span>
              <span className="chart-stat-value">
                {(() => { const a = periodAverage(values.map(v => v.net)); return <>{signPrefix(a)}{formatCurrency(a)}</>; })()}
              </span>
              <span className="chart-stat-note">{periods.length} období včetně nulových</span>
            </div>
            <div className="chart-stat">
              <span className="chart-stat-label">Poslední známý zůstatek</span>
              <span className="chart-stat-value">
                {data.anchor ? formatCurrency(data.anchor.balance) : '—'}
              </span>
              <span className="chart-stat-note">
                {data.anchor ? `podle notifikace z ${data.anchor.date}` : 'čeká na notifikaci ze spořicího účtu'}
              </span>
            </div>
          </div>

          {showTable ? (
            <SavingsTable periods={periods} values={values} />
          ) : (
            <SavingsHistoryChart
              periods={periods}
              values={values}
              onPeriodClick={openTransactions}
              clickablePeriods={clickablePeriods}
              showDerived={showDerived}
              showActual={showActual}
            />
          )}

          {!showTable && (
            <div className="chart-legend">
              <div className="chart-legend-items">
                <button className={`chart-legend-item${showDerived ? ' on' : ''}`} aria-pressed={showDerived}
                        onClick={() => setShowDerived(v => !v)}>
                  <span className="chart-legend-key" style={{ background: '#6366f1' }} />
                  <span className="chart-legend-name">Zůstatek (dopočtený)</span>
                </button>
                <button className={`chart-legend-item${showActual ? ' on' : ''}`} aria-pressed={showActual}
                        disabled={!hasActual} onClick={() => setShowActual(v => !v)}>
                  <span className="chart-legend-key is-dashed" style={{ color: '#0ea5e9' }} />
                  <span className="chart-legend-name">Zůstatek (z notifikací)</span>
                </button>
              </div>
            </div>
          )}

          {periods.some(p => p.partial) && (
            <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
              Poslední období ještě probíhá — sloupec je světlejší a čísla nejsou konečná.
            </div>
          )}
        </div>
      )}

      {loading && !data && <div className="page-loading">Načítám…</div>}
    </Layout>
  );
}

// Tabulkový pohled — stejná data bez hoveru, aby žádná hodnota nebyla
// dostupná jen přes tooltip.
function SavingsTable({ periods, values }) {
  return (
    <div className="chart-table-scroll">
      <table className="chart-table">
        <thead>
          <tr>
            <th>Období</th>
            <th className="num">Vklady</th>
            <th className="num">Výběry</th>
            <th className="num">Saldo</th>
            <th className="num">Zůstatek (dopočtený)</th>
            <th className="num">Zůstatek (z notifikací)</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p, i) => (
            <tr key={p.key}>
              <td>{shortPeriodLabel(p.key)}{p.partial ? ' (probíhá)' : ''}</td>
              <td className="num">{formatCurrency(values[i].deposits)}</td>
              <td className="num">{formatCurrency(values[i].withdrawals)}</td>
              <td className="num strong">{signPrefix(values[i].net)}{formatCurrency(values[i].net)}</td>
              <td className="num">{values[i].balance_derived == null ? '—' : `${signPrefix(values[i].balance_derived)}${formatCurrency(values[i].balance_derived)}`}</td>
              <td className="num">{values[i].balance_actual == null ? '—' : `${signPrefix(values[i].balance_actual)}${formatCurrency(values[i].balance_actual)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
