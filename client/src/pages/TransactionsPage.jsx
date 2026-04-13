import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Trash2, Check, X, Columns3 } from 'lucide-react';
import Layout from '../components/Layout';
import { formatCurrency, formatPeriod, addPeriods } from '../i18n';

const ALL_COLS = [
  { key: 'date',                 label: 'Datum',           default: true,  always: true },
  { key: 'tx_time',              label: 'Čas',             default: false },
  { key: 'description',          label: 'Popis',           default: true,  always: true },
  { key: 'tx_type',              label: 'Typ úhrady',      default: false },
  { key: 'category_name',        label: 'Kategorie',       default: true },
  { key: 'entered_by',           label: 'Kdo zadal',       default: false },
  { key: 'counterparty_account', label: 'Číslo účtu',      default: false },
  { key: 'place',                label: 'Obchodní místo',  default: false },
  { key: 'note',                 label: 'Zpráva/Poznámka', default: false },
  { key: 'amount',               label: 'Částka',          default: true,  always: true },
];

const LS_KEY = 'spendex_tx_cols';

function loadCols() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY));
    if (saved) return saved;
  } catch { /* ignore */ }
  return ALL_COLS.filter(c => c.default).map(c => c.key);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
}

export default function TransactionsPage() {
  const [period, setPeriod] = useState(null);
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [currentPeriod, setCurrentPeriod] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filterCat, setFilterCat] = useState('');
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});
  const [visibleCols, setVisibleCols] = useState(loadCols);
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const pickerRef = useRef();

  useEffect(() => {
    Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/categories').then(r => r.json()),
    ]).then(([s, cats]) => {
      setPeriod(s.current_period);
      setCurrentPeriod(s.current_period);
      setPeriodStart(s.period_start);
      setPeriodEnd(s.period_end);
      setCustomFrom(s.period_start);
      setCustomTo(s.period_end);
      setCategories(cats);
    });
  }, []);

  const loadTransactions = useCallback(() => {
    if (customMode) {
      if (!customFrom || !customTo) return;
      setLoading(true);
      const params = new URLSearchParams({ from: customFrom, to: customTo });
      if (filterCat) params.set('category_id', filterCat);
      fetch(`/api/transactions?${params}`)
        .then(r => r.json())
        .then(data => { setTransactions(data); setSelected(new Set()); })
        .finally(() => setLoading(false));
      return;
    }
    if (!period) return;
    setLoading(true);
    fetch(`/api/settings?period=${period}`)
      .then(r => r.json())
      .then(s => {
        setPeriodStart(s.period_start);
        setPeriodEnd(s.period_end);
        const params = new URLSearchParams({ from: s.period_start, to: s.period_end });
        if (filterCat) params.set('category_id', filterCat);
        return fetch(`/api/transactions?${params}`).then(r => r.json());
      })
      .then(data => { setTransactions(data); setSelected(new Set()); })
      .finally(() => setLoading(false));
  }, [period, filterCat, customMode, customFrom, customTo]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  // Zavři picker kliknutím ven
  useEffect(() => {
    function onClick(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setColPickerOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function toggleCol(key) {
    setVisibleCols(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      localStorage.setItem(LS_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function handleDelete(id) {
    if (!confirm('Smazat tuto transakci?')) return;
    const r = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
    if (r.ok) {
      setTransactions(prev => prev.filter(t => t.id !== id));
      setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  async function handleDeleteSelected() {
    if (!confirm(`Smazat ${selected.size} označených transakcí?`)) return;
    setDeleting(true);
    const ids = [...selected];
    const r = await fetch('/api/transactions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (r.ok) {
      setTransactions(prev => prev.filter(t => !selected.has(t.id)));
      setSelected(new Set());
    }
    setDeleting(false);
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  function toggleSelectAll() {
    if (selected.size === transactions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(transactions.map(t => t.id)));
    }
  }

  function startEdit(tx) {
    setEditId(tx.id);
    setEditData({
      description: tx.description || '',
      category_id: tx.category_id ? String(tx.category_id) : '',
      amount: String(Math.abs(tx.amount)),
      date: tx.date,
      note: tx.note || '',
    });
  }

  async function saveEdit(tx) {
    const body = {
      description: editData.description,
      category_id: editData.category_id ? parseInt(editData.category_id) : null,
      amount: tx.amount < 0 ? -Math.abs(parseFloat(editData.amount)) : Math.abs(parseFloat(editData.amount)),
      date: editData.date,
      note: editData.note,
    };
    const r = await fetch(`/api/transactions/${tx.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      const updated = await r.json();
      const cat = categories.find(c => c.id === updated.category_id);
      setTransactions(prev => prev.map(t =>
        t.id === updated.id
          ? { ...updated, category_name: cat?.name, category_color: cat?.color }
          : t
      ));
      setEditId(null);
    }
  }

  const totalSpent = transactions.reduce((s, t) => t.amount < 0 ? s + Math.abs(t.amount) : s, 0);
  const cols = ALL_COLS.filter(c => visibleCols.includes(c.key));
  const allSelected = transactions.length > 0 && selected.size === transactions.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Transakce</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {!customMode && period && (
            <div className="month-nav">
              <button className="btn btn-ghost btn-icon" onClick={() => setPeriod(p => addPeriods(p, -1))}>
                <ChevronLeft size={18} />
              </button>
              <span className="month-label">{formatPeriod(periodStart, periodEnd)}</span>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => setPeriod(p => addPeriods(p, 1))}
                disabled={period >= currentPeriod}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
          {customMode && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="input"
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                style={{ maxWidth: 140 }}
              />
              <span className="text-muted" style={{ fontSize: 13 }}>–</span>
              <input
                className="input"
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                style={{ maxWidth: 140 }}
              />
            </div>
          )}
          <button
            className={`btn btn-ghost`}
            style={{ fontSize: 12, padding: '5px 10px' }}
            onClick={() => {
              setCustomMode(m => !m);
              setSelected(new Set());
            }}
            title={customMode ? 'Přepnout na billing období' : 'Vlastní rozsah dat'}
          >
            {customMode ? 'Billing období' : 'Vlastní rozsah'}
          </button>
          <select
            className="input"
            style={{ maxWidth: 180, fontSize: 13 }}
            value={filterCat}
            onChange={e => setFilterCat(e.target.value)}
          >
            <option value="">Všechny kategorie</option>
            <option value="none">— bez kategorie —</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {/* Přepínač sloupců */}
          <div className="col-picker-wrap" ref={pickerRef}>
            <button
              className={`btn btn-ghost${colPickerOpen ? ' active' : ''}`}
              onClick={() => setColPickerOpen(o => !o)}
              title="Zobrazené sloupce"
            >
              <Columns3 size={16} /> Sloupce
            </button>
            {colPickerOpen && (
              <div className="col-picker-dropdown">
                {ALL_COLS.map(c => (
                  <label key={c.key} className={`col-picker-item${c.always ? ' disabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={visibleCols.includes(c.key)}
                      disabled={c.always}
                      onChange={() => !c.always && toggleCol(c.key)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">Načítání…</div>
      ) : transactions.length === 0 ? (
        <div className="empty-state">
          <p>Žádné transakce pro toto období.</p>
        </div>
      ) : (
        <>
          <div className="tx-summary">
            <span className="text-muted" style={{ fontSize: 13 }}>{transactions.length} transakcí</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Výdaje: {formatCurrency(totalSpent)}</span>
          </div>

          {selected.size > 0 && (
            <div className="tx-bulk-bar">
              <span className="text-muted" style={{ fontSize: 13 }}>Označeno: <strong style={{ color: 'var(--text)' }}>{selected.size}</strong></span>
              <button
                className="btn btn-danger"
                onClick={handleDeleteSelected}
                disabled={deleting}
              >
                <Trash2 size={15} />
                {deleting ? 'Mažu…' : `Smazat ${selected.size}`}
              </button>
            </div>
          )}

          <div className="tx-table">
            {/* Hlavička */}
            <div className="tx-header-row" style={{ gridTemplateColumns: colsToGrid(cols) }}>
              <span className="tx-th">
                <input
                  type="checkbox"
                  className="tx-checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleSelectAll}
                />
              </span>
              {cols.map(c => (
                <span key={c.key} className={`tx-th${c.key === 'amount' ? ' tx-th-right' : ''}`}>{c.label}</span>
              ))}
              <span className="tx-th" />
            </div>

            {transactions.map(tx => editId === tx.id ? (
              <div key={tx.id} className="tx-edit-row">
                <div className="tx-edit-grid">
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Datum</label>
                    <input
                      className="input"
                      type="date"
                      value={editData.date}
                      onChange={e => setEditData(d => ({ ...d, date: e.target.value }))}
                      style={{ maxWidth: 140 }}
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Popis</label>
                    <input
                      className="input"
                      value={editData.description}
                      onChange={e => setEditData(d => ({ ...d, description: e.target.value }))}
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Kategorie</label>
                    <select
                      className="input"
                      value={editData.category_id}
                      onChange={e => setEditData(d => ({ ...d, category_id: e.target.value }))}
                    >
                      <option value="">— bez kategorie —</option>
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontSize: 11 }}>Částka (Kč)</label>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={editData.amount}
                      onChange={e => setEditData(d => ({ ...d, amount: e.target.value }))}
                      style={{ maxWidth: 120 }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="btn btn-ghost" onClick={() => setEditId(null)}>
                    <X size={14} /> Zrušit
                  </button>
                  <button className="btn btn-primary" onClick={() => saveEdit(tx)}>
                    <Check size={14} /> Uložit
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={tx.id}
                className={`tx-row${selected.has(tx.id) ? ' tx-row-selected' : ''}`}
                style={{ gridTemplateColumns: colsToGrid(cols) }}
              >
                <span className="tx-cell">
                  <input
                    type="checkbox"
                    className="tx-checkbox"
                    checked={selected.has(tx.id)}
                    onChange={() => toggleSelect(tx.id)}
                  />
                </span>
                {cols.map(c => (
                  <span key={c.key} className={`tx-cell tx-cell-${c.key}`}>
                    {renderCell(c.key, tx, categories)}
                  </span>
                ))}
                <span className="tx-actions">
                  <button className="btn btn-ghost btn-icon" onClick={() => startEdit(tx)} title="Upravit">
                    <Pencil size={14} />
                  </button>
                  <button className="btn btn-ghost btn-icon" onClick={() => handleDelete(tx.id)} title="Smazat">
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Layout>
  );
}

function colsToGrid(cols) {
  const dataCols = cols.map(c => {
    if (c.key === 'date') return '56px';
    if (c.key === 'tx_time') return '52px';
    if (c.key === 'amount') return '110px';
    if (c.key === 'category_name') return '140px';
    if (c.key === 'tx_type') return '130px';
    if (c.key === 'entered_by') return '120px';
    if (c.key === 'counterparty_account') return '140px';
    return '1fr';
  }).join(' ');
  return `28px ${dataCols} 72px`;
}

function renderCell(key, tx, categories) {
  switch (key) {
    case 'date':
      return <span className="tx-date">{formatDate(tx.date)}</span>;
    case 'tx_time':
      return <span className="text-muted" style={{ fontSize: 12 }}>{tx.tx_time || '—'}</span>;
    case 'description':
      return <span className="tx-desc">{tx.description || <span className="text-muted">—</span>}</span>;
    case 'tx_type':
      return <span className="text-muted" style={{ fontSize: 12 }}>{tx.tx_type || '—'}</span>;
    case 'category_name':
      return tx.category_name ? (
        <span className="tx-cat-badge" style={{
          background: (tx.category_color || '#6366f1') + '33',
          color: tx.category_color || '#6366f1',
        }}>
          {tx.category_name}
        </span>
      ) : <span className="text-muted" style={{ fontSize: 12 }}>—</span>;
    case 'entered_by':
      return <span style={{ fontSize: 13 }}>{tx.entered_by || '—'}</span>;
    case 'counterparty_account':
      return <span className="text-muted" style={{ fontSize: 12 }}>{tx.counterparty_account || '—'}</span>;
    case 'place':
      return <span style={{ fontSize: 13 }}>{tx.place || '—'}</span>;
    case 'note':
      return <span className="text-muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.note || '—'}</span>;
    case 'amount':
      return (
        <span className={`tx-amount ${tx.amount < 0 ? 'tx-amount-out' : 'tx-amount-in'}`}>
          {tx.amount < 0 ? '−' : '+'}{formatCurrency(Math.abs(tx.amount))}
        </span>
      );
    default:
      return null;
  }
}
