import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Table2 } from 'lucide-react';
import Layout from '../components/Layout';
import SavingsHistoryChart from '../components/SavingsHistoryChart';
import { t, formatCurrency } from '../i18n';
import { shortPeriodLabel, signPrefix } from '../utils/chartScale';

export default function FundHistoryPage() {
  const navigate = useNavigate();
  const [funds, setFunds] = useState([]);
  const [accountId, setAccountId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTable, setShowTable] = useState(false);

  // Seznam fondových účtů — bez něj nevíme, co do přepínače dát.
  useEffect(() => {
    fetch('/api/accounts')
      .then(r => r.json())
      .then(list => {
        const f = (list || []).filter(a => a.is_fund);
        setFunds(f);
        setAccountId(prev => prev ?? (f[0]?.id ?? null));
        if (!f.length) setLoading(false);
      })
      .catch(() => { setError('Načtení účtů se nepovedlo.'); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    fetch(`/api/stats/fund-history?account_id=${accountId}`)
      .then(async r => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Načtení se nepovedlo.');
        return body;
      })
      .then(d => { setError(''); setData(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [accountId]);

  const periods = useMemo(() => data?.periods || [], [data]);
  const values = useMemo(() => data?.values || [], [data]);
  const coverage = data?.coverage || null;

  // Pozice dneška v kalendářním roce — značka na baru čerpání. Roční plán i čerpání
  // jsou vztažené ke kalendářnímu roku, ne k účetnímu období.
  const yearPct = (() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear(), 11, 31);
    const total = Math.round((end - start) / 86400000) + 1;
    const passed = Math.round((now - start) / 86400000);
    return Math.max(0, Math.min(100, (passed / total) * 100));
  })();
  const clickablePeriods = useMemo(() => values.map(v => (v.tx_ids || []).length > 0), [values]);

  function openTransactions(index) {
    const ids = values[index]?.tx_ids || [];
    if (!ids.length) return;
    const period = periods[index]?.key;
    navigate(`/transactions?tx_ids=${ids.join(',')}${period ? `&period=${period}` : ''}`);
  }

  // Proklik na celý letošní rok — čerpání se nově počítá za rok, ne v okně podpoložky,
  // takže seznam musí odpovídat tomu, co je v řádku.
  function openCategory(cat) {
    const year = new Date().getFullYear();
    navigate(`/transactions?category_ids=${cat.category_id}&from=${year}-01-01&to=${year}-12-31`);
  }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{t.nav.fundHistory}</h1>
        <button className="btn btn-ghost" onClick={() => setShowTable(v => !v)}
          title={showTable ? 'Zobrazit graf' : 'Zobrazit tabulku'}>
          {showTable ? <BarChart3 size={18} /> : <Table2 size={18} />}
        </button>
      </div>

      {funds.length > 1 && (
        <div className="tx-chip-row" style={{ marginBottom: 12 }}>
          {funds.map(f => (
            <button key={f.id}
              className={`tx-chip${f.id === accountId ? ' tx-chip-active' : ''}`}
              onClick={() => setAccountId(f.id)}>
              {f.name}
            </button>
          ))}
        </div>
      )}

      {loading ? <div className="page-loading">Načítání…</div> : error ? (
        <div className="text-danger">{error}</div>
      ) : !funds.length ? (
        <div className="text-muted">
          Žádný fondový účet. Fond se označí zaškrtnutím „fondový účet" u účtu na stránce Účty.
        </div>
      ) : (
        <>
          {coverage && (
            <div className="fund-coverage">
              {/* Tři čísla, tři otázky: kolik už z ročního plánu padlo, kolik na účtu
                  podle transakcí je, a kolik by tam mělo být na zbytek roku. */}
              <div className="fund-coverage-head">
                <span>Vyčerpáno z ročního plánu</span>
                <span>
                  <strong>{formatCurrency(coverage.spent)}</strong>
                  <span className="text-muted"> / {formatCurrency(coverage.plan)}</span>
                </span>
              </div>
              <div className="fund-coverage-bar">
                <div
                  className={`fund-coverage-bar-fill${coverage.spent > coverage.plan ? ' is-over' : ''}`}
                  style={{ width: `${coverage.plan > 0 ? Math.min(100, (coverage.spent / coverage.plan) * 100) : 0}%` }}
                />
                {/* Svislá čárka = kde jsme v roce. Rtuť vlevo od ní znamená, že
                    čerpání zaostává za časem, vpravo že předbíhá. Stejná mechanika
                    i CSS třída jako u ročního teploměru na Ročních budgetech. */}
                {yearPct > 0 && yearPct < 100 && (
                  <div className="budget-bar-day-marker" style={{ left: `${yearPct}%` }} />
                )}
              </div>

              <div className="fund-coverage-rows">
                <div className="fund-coverage-row">
                  <span>Na účtu (podle transakcí)</span>
                  <span>
                    {coverage.balance == null
                      ? '—'
                      : `${signPrefix(coverage.balance)}${formatCurrency(coverage.balance)}`}
                  </span>
                </div>
                {coverage.subsidies > 0 && (
                  <div className="fund-coverage-row">
                    <span title={(coverage.subsidy_items || []).map(i => `${i.name}: ${i.months}× ${Math.round(i.amount)}`).join('\n')}>
                      Dotace do konce roku
                    </span>
                    <span className="text-success">+ {formatCurrency(coverage.subsidies)}</span>
                  </div>
                )}
                <div className="fund-coverage-row">
                  <span>Potřeba na zbytek roku</span>
                  <span>− {formatCurrency(coverage.remaining)}</span>
                </div>
                {coverage.balance != null && (
                  <div className={`fund-coverage-row fund-coverage-result ${coverage.diff >= 0 ? 'text-success' : 'text-danger'}`}>
                    <span>{coverage.diff >= 0 ? 'Zbývá po pokrytí' : 'Chybí'}</span>
                    <span>{formatCurrency(coverage.diff)}</span>
                  </div>
                )}
              </div>

              {coverage.balance == null ? (
                <div className="fund-coverage-note text-muted">
                  Zůstatek zatím neznáme — na tomto účtu nedorazila žádná platba se zůstatkem
                  z bankovní notifikace. Doplní se, jakmile první přijde.
                </div>
              ) : coverage.anchor_date && (
                <div className="fund-coverage-note text-muted" style={{ fontSize: 11 }}>
                  Naposledy potvrzeno bankou k {coverage.anchor_date}: {signPrefix(coverage.anchor_balance)}{formatCurrency(coverage.anchor_balance)}
                </div>
              )}
            </div>
          )}

          {coverage?.categories?.length > 0 && (
            <section className="report-section">
              <div className="report-section-header">Roční plán po kategoriích</div>
              <div className="chart-table-scroll">
              <table className="chart-table">
                <thead>
                  <tr>
                    <th>Kategorie</th>
                    <th className="num">Plán</th><th className="num">Vyčerpáno</th><th className="num">Zbývá</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.categories.map(c => (
                    <tr key={c.category_id} style={{ cursor: 'pointer' }} onClick={() => openCategory(c)}
                      title="Klik: letošní transakce této kategorie">
                      <td>{c.category_name}</td>
                      <td className="num">{formatCurrency(c.plan)}</td>
                      <td className={`num${c.spent > c.plan ? ' text-danger' : ''}`}>{formatCurrency(c.spent)}</td>
                      <td className="num">{formatCurrency(c.remaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </section>
          )}

          {showTable ? (
            <div className="chart-table-scroll">
            <table className="chart-table">
              <thead>
                <tr><th>Období</th><th className="num">Saldo</th><th className="num">Zůstatek</th></tr>
              </thead>
              <tbody>
                {values.map((v, i) => (
                  <tr key={v.period}>
                    <td>{shortPeriodLabel(periods[i]?.key || v.period)}</td>
                    <td className="num">{signPrefix(v.net)} {formatCurrency(Math.abs(v.net))}</td>
                    <td className="num">{v.balance_derived == null ? '—' : `${signPrefix(v.balance_derived)}${formatCurrency(v.balance_derived)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <SavingsHistoryChart
              periods={periods}
              values={values}
              onPeriodClick={openTransactions}
              clickablePeriods={clickablePeriods}
              emptyText="Zůstatek zatím neznáme — doplní se z bankovních notifikací tohoto účtu."
              ariaLabel={`Vývoj zůstatku fondu, ${periods.length} období. Šipkami vlevo a vpravo projdete jednotlivá období.`}
            />
          )}
        </>
      )}
    </Layout>
  );
}
