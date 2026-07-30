import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PrepaidPackageCard from '../components/PrepaidPackageCard';
import { t } from '../i18n';

export default function PrepaidPage() {
  const [searchParams] = useSearchParams();
  const [packages, setPackages] = useState([]);
  const [status, setStatus] = useState('active');
  const [loading, setLoading] = useState(true);

  const category = searchParams.get('category') || '';
  const period = searchParams.get('period') || '';

  function load() {
    const qs = new URLSearchParams({ status });
    if (category) qs.set('category', category);
    if (period) qs.set('period', period);
    setLoading(true);
    fetch(`/api/prepaid?${qs}`)
      .then(r => r.json())
      .then(d => setPackages(d.packages || []))
      .finally(() => setLoading(false));
  }

  useEffect(load, [status, category, period]);

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{t.nav.prepaid}</h1>
        <div className="month-nav">
          {['active', 'closed', 'all'].map(s => (
            <button key={s} className={`btn ${status === s ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setStatus(s)}>
              {s === 'active' ? 'Aktivní' : s === 'closed' ? 'Uzavřené' : 'Vše'}
            </button>
          ))}
        </div>
      </div>

      {loading ? <div className="page-loading">{t.common.loading}</div> : (
        packages.length === 0 ? (
          <div className="empty-state">
            <p>Žádné předplacené balíčky.</p>
            <p className="text-muted">
              Balíček založíš v Transakcích u platby, kterou jsi ho zaplatil.
            </p>
          </div>
        ) : (
          <div className="prepaid-list">
            {packages.map(p => (
              <PrepaidPackageCard key={p.id} pkg={p} onChanged={load} />
            ))}
          </div>
        )
      )}
    </Layout>
  );
}
