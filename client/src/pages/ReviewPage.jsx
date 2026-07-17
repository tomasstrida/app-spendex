import { useState, useEffect, useCallback } from 'react';
import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { formatCurrency } from '../i18n';

export default function ReviewPage() {
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // id právě zpracovávané položky

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/review/misplaced').then(r => r.ok ? r.json() : []),
      fetch('/api/categories').then(r => r.ok ? r.json() : []),
    ]).then(([mis, c]) => {
      setItems(Array.isArray(mis) ? mis : []);
      setCats(Array.isArray(c) ? c : []);
    }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function changeCategory(tx, categoryId) {
    setBusy(tx.id);
    try {
      const r = await fetch(`/api/transactions/${tx.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: categoryId, subcategory_id: null }),
      });
      if (r.ok) setItems(prev => prev.filter(i => i.id !== tx.id)); // po přeřazení může zmizet
      else load();
    } finally { setBusy(null); }
  }

  async function dismiss(tx) {
    setBusy(tx.id);
    try {
      const r = await fetch('/api/review/dismiss', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tx.id }),
      });
      if (r.ok) setItems(prev => prev.filter(i => i.id !== tx.id));
    } finally { setBusy(null); }
  }

  const fmtDate = d => `${+d.slice(8, 10)}. ${+d.slice(5, 7)}. ${d.slice(0, 4)}`;

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Revize zařazení</h1>
      </div>

      <p className="text-muted" style={{ fontSize: 13, maxWidth: 720, marginBottom: 16 }}>
        Výdaje se skutečnou kategorií (běžný / roční / drahá věc), které jsou zaúčtované na
        účtu mimo evidenci (role „ignorováno") — proto se nikde nezapočítávají. Buď oprav
        kategorii (když je zařazení špatné), nebo potvrď „Nechat, je to OK".
      </p>

      {loading ? (
        <div className="page-loading">Načítání…</div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text2)' }}>
          Žádné výdaje na neobvyklém účtu — vše sedí. ✅
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map(tx => (
            <div key={tx.id} className="card" style={{ padding: 14, opacity: busy === tx.id ? 0.5 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 240 }}>
                  <div style={{ fontWeight: 600 }}>
                    <span className="text-muted" style={{ marginRight: 8, fontWeight: 400 }}>{fmtDate(tx.date)}</span>
                    {tx.description || tx.place || '—'}
                  </div>
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                    účet: {tx.account_name}
                    {tx.note ? ` · ${tx.note}` : ''}
                  </div>
                </div>
                <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>− {formatCurrency(-tx.amount)}</div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <span className="text-muted" style={{ fontSize: 12 }}>Kategorie:</span>
                <select
                  className="input"
                  style={{ maxWidth: 260, fontSize: 13 }}
                  value={tx.category_id ?? ''}
                  disabled={busy === tx.id}
                  onChange={e => changeCategory(tx, e.target.value === '' ? null : parseInt(e.target.value))}
                >
                  {cats.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <Link to={`/transactions?highlight=${tx.id}`} className="text-muted" style={{ fontSize: 12 }}>
                  otevřít v Transakcích →
                </Link>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 'auto' }}
                  disabled={busy === tx.id}
                  onClick={() => dismiss(tx)}
                  title="Zařazení je správné, jen čeká na budoucí započítání — skrýt z revize"
                >
                  <Check size={14} /> Nechat, je to OK
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
