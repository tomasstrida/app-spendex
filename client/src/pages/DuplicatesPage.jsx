import { useState, useEffect, useCallback } from 'react';
import { Trash2, RefreshCw } from 'lucide-react';
import Layout from '../components/Layout';
import { formatCurrency } from '../i18n';

function GroupCard({ group, selected, onToggle }) {
  const r0 = group.rows[0];
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>
        {r0.date} · {formatCurrency(r0.amount)} · {r0.description} · {r0.account_name || '—'} · {group.rows.length}×
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {group.rows.map(row => (
          <label key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              className="tx-checkbox"
              checked={selected.has(row.id)}
              onChange={() => onToggle(row.id)}
            />
            <span style={{ flex: 1 }}>{row.date} · {row.description}</span>
            <span style={{ minWidth: 90, textAlign: 'right' }}>{formatCurrency(row.amount)}</span>
            <span className="text-muted" style={{ minWidth: 150, fontSize: 12 }}>{row.external_id || '—'}</span>
            <span className="text-muted" style={{ minWidth: 70, fontSize: 12 }}>{row.source || '—'}</span>
            <span className="text-muted" style={{ minWidth: 130, fontSize: 12 }}>{row.created_at || ''}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function DuplicatesPage() {
  const [data, setData] = useState({ probable: [], possible: [] });
  const [tab, setTab] = useState('probable');
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true); setError('');
    fetch('/api/transactions/duplicates')
      .then(r => r.json())
      .then(d => {
        const safe = { probable: d.probable || [], possible: d.possible || [] };
        setData(safe);
        const pre = new Set();
        [...safe.probable, ...safe.possible].forEach(g => {
          const minId = Math.min(...g.rows.map(x => x.id));
          g.rows.forEach(x => { if (x.id !== minId) pre.add(x.id); });
        });
        setSelected(pre);
      })
      .catch(() => setError('Chyba načítání.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggle(id) {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  const groups = data[tab] || [];
  const visibleIds = new Set(groups.flatMap(g => g.rows.map(r => r.id)));
  const toDelete = [...selected].filter(id => visibleIds.has(id));

  async function handleDelete() {
    if (toDelete.length === 0) return;
    if (!confirm(`Smazat ${toDelete.length} transakcí? Akce je nevratná.`)) return;
    setDeleting(true); setError('');
    try {
      const r = await fetch('/api/transactions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: toDelete, guardDuplicateGroups: true }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Chyba mazání.'); return; }
      load();
    } catch { setError('Chyba připojení.'); }
    finally { setDeleting(false); }
  }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Duplicity</h1>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> Obnovit
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn btn-sm ${tab === 'probable' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('probable')}>
          Pravděpodobné ({data.probable.length})
        </button>
        <button className={`btn btn-sm ${tab === 'possible' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('possible')}>
          Možné ({data.possible.length})
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div className="page-loading">Načítání…</div>
      ) : groups.length === 0 ? (
        <p className="text-muted">Žádné duplicity 🎉</p>
      ) : (
        <>
          {groups.map(g => (
            <GroupCard key={g.key} group={g} selected={selected} onToggle={toggle} />
          ))}
          <div className="tx-bulk-bar" style={{ position: 'sticky', bottom: 0 }}>
            <span className="text-muted" style={{ fontSize: 13 }}>
              Vybráno k smazání: <strong style={{ color: 'var(--text)' }}>{toDelete.length}</strong>
            </span>
            <button className="btn btn-danger btn-sm" onClick={handleDelete}
              disabled={deleting || toDelete.length === 0}>
              <Trash2 size={14} /> {deleting ? 'Mažu…' : `Smazat ${toDelete.length}`}
            </button>
          </div>
        </>
      )}
    </Layout>
  );
}
