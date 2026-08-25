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
  const clickablePeriods = useMemo(() => values.map(v => (v.tx_ids || []).length > 0), [values]);

  function openTransactions(index) {
    const ids = values[index]?.tx_ids || [];
    if (!ids.length) return;
    const period = periods[index]?.key;
    navigate(`/transactions?tx_ids=${ids.join(',')}${period ? `&period=${period}` : ''}`);
  }

  function openItem(item) {
    navigate(`/transactions?category_ids=${item.category_id}&from=${item.window_from}&to=${item.window_to}`);
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
          Žádný fondový účet. Fond se označí zaškrtnutím „fondový účet" u účtu v Nastavení.
        </div>
      ) : (
        <>
          {coverage && coverage.balance == null ? (
            <div className="fund-coverage">
              <div className="text-muted">
                Zůstatek zatím neznáme — na tomto účtu nedorazila žádná platba se zůstatkem
                z bankovní notifikace. Krytí se ukáže, jakmile první přijde.
              </div>
              <div className="fund-coverage-rows">
                <div className="fund-coverage-row">
                  <span>Zbývá vyčerpat do konce roku</span>
                  <span>{formatCurrency(coverage.remaining)}</span>
                </div>
              </div>
            </div>
          ) : coverage && (
            <div className="fund-coverage">
              <div className={`fund-coverage-value ${coverage.diff >= 0 ? 'text-success' : 'text-danger'}`}>
                {coverage.diff >= 0 ? 'Zbývá po pokrytí ' : 'Chybí '}
                {signPrefix(coverage.diff)} {formatCurrency(Math.abs(coverage.diff))}
              </div>
              <div className="fund-coverage-note text-muted">
                {coverage.diff >= 0
                  ? 'Fond pokryje roční výdaje, které z něj do konce roku ještě odejdou.'
                  : 'Fond nepokryje roční výdaje, které z něj do konce roku ještě odejdou.'}
              </div>
              <div className="fund-coverage-rows">
                <div className="fund-coverage-row">
                  <span>Zůstatek k {coverage.balance_date}</span>
                  <span>{formatCurrency(coverage.balance)}</span>
                </div>
                <div className="fund-coverage-row">
                  <span>Zbývá vyčerpat do konce roku</span>
                  <span>− {formatCurrency(coverage.remaining)}</span>
                </div>
              </div>
            </div>
          )}

          {coverage?.items?.length > 0 && (
            <section className="report-section">
              <div className="report-section-header">Z čeho se skládá „zbývá vyčerpat"</div>
              <div className="chart-table-scroll">
              <table className="chart-table">
                <thead>
                  <tr>
                    <th>Položka</th><th>Kategorie</th>
                    <th className="num">Plán</th><th className="num">Vyčerpáno</th><th className="num">Zbývá</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.items.map(i => (
                    <tr key={i.budget_item_id} style={{ cursor: 'pointer' }} onClick={() => openItem(i)}
                      title="Klik: transakce kategorie v okně této položky">
                      <td>{i.name}</td>
                      <td className="text-muted">{i.category_name}</td>
                      <td className="num">{formatCurrency(i.amount)}</td>
                      <td className="num">{formatCurrency(i.spent)}</td>
                      <td className="num">{formatCurrency(i.remaining)}</td>
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
                    <td className="num">{v.balance_derived == null ? '—' : formatCurrency(v.balance_derived)}</td>
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
            />
          )}
        </>
      )}
    </Layout>
  );
}
