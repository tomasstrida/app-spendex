import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import Layout from '../components/Layout';
import { t, formatCurrency, formatPeriod, addPeriods } from '../i18n';

const MONTHS = ['Leden','Únor','Březen','Duben','Květen','Červen',
                 'Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];
const MONTHS_SHORT = ['led','úno','bře','dub','kvě','čvn','čvc','srp','zář','říj','lis','pro'];

// ── Teploměr pro Typ 1 ───────────────────────────────────────────────────────

function BudgetThermometer({ spent, amount, periodStart, periodEnd, color }) {
  const spentPct = amount > 0 ? Math.min((spent / amount) * 100, 100) : 0;
  const over = spent > amount;
  const today = new Date();
  const start = new Date(periodStart + 'T00:00:00');
  const end = new Date(periodEnd + 'T00:00:00');
  const periodOver = today > end;
  const totalDays = Math.round((end - start) / 86400000) + 1;
  const daysPassed = Math.max(0, Math.min(Math.round((today - start) / 86400000), totalDays));
  const dayPct = Math.min((daysPassed / totalDays) * 100, 100);
  const projection = daysPassed > 0 ? Math.round((spent / daysPassed) * totalDays) : 0;
  const fillColor = over ? undefined : (spentPct > dayPct ? '#f97316' : (color || '#6366f1'));

  return (
    <div>
      <div className="budget-bar-track" style={{ position: 'relative' }}>
        <div className={`budget-bar-fill${over ? ' over' : ''}`} style={{ width: `${spentPct}%`, background: fillColor }} />
        {dayPct > 0 && dayPct < 100 && <div className="budget-bar-day-marker" style={{ left: `${dayPct}%` }} />}
      </div>
      {!periodOver && projection > 0 && projection > amount && (
        <div className="budget-projection">
          projekce: <strong>{formatCurrency(projection)}</strong>
          <span className="text-danger"> (+{formatCurrency(projection - amount)})</span>
        </div>
      )}
    </div>
  );
}

// ── Formulář pro Typ 1 ───────────────────────────────────────────────────────

function BudgetForm({ initial, categories, period, periodLabel, existingCategoryIds, onSave, onCancel }) {
  const isNew = !initial;
  const [categoryId, setCategoryId] = useState(initial?.category_id ? String(initial.category_id) : '');
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : '');
  const [scope, setScope] = useState('all');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const available = categories.filter(c =>
    (c.type === 1 || !c.type) && (!existingCategoryIds.includes(c.id) || c.id === initial?.category_id)
  );

  async function handleSubmit(e) {
    e.preventDefault();
    if (!categoryId) { setError('Vyberte kategorii.'); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Zadejte kladnou částku.'); return; }
    setSaving(true); setError('');
    try {
      const r = await fetch('/api/budgets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: parseInt(categoryId), period, amount: amt, scope }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Chyba.'); return; }
      onSave();
    } catch { setError('Chyba připojení.'); }
    finally { setSaving(false); }
  }

  return (
    <form className="category-form" onSubmit={handleSubmit}>
      <h3 className="category-form-title">{isNew ? 'Přidat rozpočet' : 'Upravit rozpočet'}</h3>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-group">
        <label className="form-label">Kategorie</label>
        <select className="input" value={categoryId} onChange={e => setCategoryId(e.target.value)} disabled={!isNew}>
          <option value="">— vyberte kategorii —</option>
          {available.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Měsíční limit (Kč)</label>
        <input className="input" type="number" min="1" step="1" placeholder="5 000"
          value={amount} onChange={e => setAmount(e.target.value)} autoFocus={!isNew} style={{ maxWidth: 160 }} />
      </div>
      {!isNew && (
        <div className="budget-edit-scope">
          <label className={`budget-scope-option${scope === 'all' ? ' selected' : ''}`}>
            <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
            <div><div style={{ fontWeight: 500, fontSize: 13 }}>Pro všechna období</div>
              <div className="text-muted" style={{ fontSize: 12 }}>Změní budget ve všech měsících</div></div>
          </label>
          <label className={`budget-scope-option${scope === 'from' ? ' selected' : ''}`}>
            <input type="radio" checked={scope === 'from'} onChange={() => setScope('from')} />
            <div><div style={{ fontWeight: 500, fontSize: 13 }}>Od {periodLabel} dál</div>
              <div className="text-muted" style={{ fontSize: 12 }}>Minulá období zůstanou beze změny</div></div>
          </label>
        </div>
      )}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}><X size={15} /> {t.categories.cancel}</button>
        <button type="submit" className="btn btn-primary" disabled={saving}><Check size={15} /> {saving ? '…' : t.categories.save}</button>
      </div>
    </form>
  );
}

// ── Formulář pro podpoložku Typ 2 ────────────────────────────────────────────

function ItemForm({ initial, categoryId, onSave, onCancel }) {
  const isNew = !initial;
  const [name, setName] = useState(initial?.name || '');
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '');
  const [windowStart, setWindowStart] = useState(initial?.window_start ?? 1);
  const [windowEnd, setWindowEnd] = useState(initial?.window_end ?? 12);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Zadejte název podpoložky.'); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Zadejte kladnou částku.'); return; }
    setSaving(true); setError('');
    try {
      const method = isNew ? 'POST' : 'PATCH';
      const url = isNew ? '/api/budget-items' : `/api/budget-items/${initial.id}`;
      const body = isNew
        ? { category_id: categoryId, name: name.trim(), amount: amt, window_start: windowStart, window_end: windowEnd }
        : { name: name.trim(), amount: amt, window_start: windowStart, window_end: windowEnd };
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Chyba.'); return; }
      onSave(d);
    } catch { setError('Chyba připojení.'); }
    finally { setSaving(false); }
  }

  return (
    <form className="item-form" onSubmit={handleSubmit}>
      {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="item-form-row">
        <input className="input" placeholder="Název (např. Beach zima)" value={name}
          onChange={e => setName(e.target.value)} autoFocus style={{ flex: 2, minWidth: 140 }} />
        <input className="input" type="number" min="1" step="1" placeholder="Částka"
          value={amount} onChange={e => setAmount(e.target.value)} style={{ maxWidth: 110 }} />
        <select className="input" value={windowStart} onChange={e => setWindowStart(parseInt(e.target.value))} style={{ maxWidth: 110 }}>
          {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
        </select>
        <span className="text-muted" style={{ fontSize: 13 }}>–</span>
        <select className="input" value={windowEnd} onChange={e => setWindowEnd(parseInt(e.target.value))} style={{ maxWidth: 110 }}>
          {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
        </select>
        <button type="submit" className="btn btn-primary btn-icon" disabled={saving}><Check size={15} /></button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onCancel}><X size={15} /></button>
      </div>
    </form>
  );
}

// ── Stav podpoložky ───────────────────────────────────────────────────────────

function getItemStatus(item, year) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const cm = now.getMonth() + 1;
  if (item.spent >= item.amount) return 'paid';
  if (year !== currentYear) return item.spent > 0 ? 'partial' : 'missed';
  const sameYear = item.window_start <= item.window_end;
  const inWindow = sameYear
    ? cm >= item.window_start && cm <= item.window_end
    : cm >= item.window_start || cm <= item.window_end;
  const windowPast = sameYear ? cm > item.window_end : false;
  if (inWindow) return 'active';
  if (windowPast) return item.spent > 0 ? 'partial' : 'missed';
  return 'waiting';
}

const STATUS_LABEL = {
  paid:    { icon: '✅', label: 'zaplaceno',  cls: '' },
  active:  { icon: '🟡', label: 'v okně',     cls: 'text-warn' },
  waiting: { icon: '⏳', label: 'čeká',       cls: 'text-muted' },
  partial: { icon: '⚠️', label: 'částečně',   cls: 'text-warn' },
  missed:  { icon: '⚠️', label: 'nezaplaceno', cls: 'text-danger' },
};

function windowLabel(ws, we) {
  if (ws === 1 && we === 12) return 'celý rok';
  if (ws === we) return MONTHS_SHORT[ws - 1];
  return `${MONTHS_SHORT[ws - 1]}–${MONTHS_SHORT[we - 1]}`;
}

// ── Sekce Typ 2 ───────────────────────────────────────────────────────────────

function Type2Section({ categories, year, onYearChange }) {
  const navigate = useNavigate();
  const type2Cats = categories.filter(c => c.type === 2);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addingFor, setAddingFor] = useState(null);   // category_id
  const [editItem, setEditItem] = useState(null);      // item object

  function load() {
    setLoading(true);
    fetch(`/api/budget-items?year=${year}`)
      .then(r => r.json())
      .then(d => setItems(d.items || []))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [year]);

  async function handleDeleteItem(item) {
    if (!confirm(`Smazat podpoložku "${item.name}"?`)) return;
    const r = await fetch(`/api/budget-items/${item.id}`, { method: 'DELETE' });
    if (r.ok) setItems(prev => prev.filter(i => i.id !== item.id));
  }

  function handleSaved(savedItem) {
    if (editItem) {
      setItems(prev => prev.map(i => i.id === savedItem.id ? { ...i, ...savedItem } : i));
      setEditItem(null);
    } else {
      load(); // reload with spent
      setAddingFor(null);
    }
  }

  if (type2Cats.length === 0) return (
    <div className="empty-state">
      <p>Žádné roční/sezónní kategorie.</p>
      <p className="text-muted">Přiřaďte kategorii typ „Roční / sezónní" v sekci Kategorie.</p>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {type2Cats.map(cat => {
        const catItems = items.filter(i => i.category_id === cat.id);
        const totalSpent = catItems.reduce((s, i) => s + i.spent, 0);
        const totalAmount = catItems.reduce((s, i) => s + i.amount, 0);

        return (
          <div key={cat.id} className="budget-item" style={{ cursor: 'default' }}>
            <div className="budget-item-header">
              <div className="budget-item-name">
                <span className="budget-dot" style={{ background: cat.color || '#6366f1' }} />
                <span
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/transactions?category_id=${cat.id}&from=${year}-01-01&to=${year}-12-31`)}
                >
                  {cat.name}
                </span>
              </div>
              {totalAmount > 0 && (
                <div className="budget-item-amounts text-muted" style={{ fontSize: 12 }}>
                  {formatCurrency(totalSpent)} / {formatCurrency(totalAmount)}
                </div>
              )}
            </div>

            {loading ? (
              <div className="text-muted" style={{ fontSize: 13, padding: '8px 0' }}>Načítání…</div>
            ) : (
              <div className="type2-items-list">
                {catItems.map(item => {
                  const st = getItemStatus(item, year);
                  const { icon, label, cls } = STATUS_LABEL[st];
                  return editItem?.id === item.id ? (
                    <ItemForm key={item.id} initial={item} categoryId={cat.id}
                      onSave={handleSaved} onCancel={() => setEditItem(null)} />
                  ) : (
                    <div key={item.id} className="type2-item-row">
                      <span className="type2-item-name">{item.name}</span>
                      <span className="type2-item-window text-muted">{windowLabel(item.window_start, item.window_end)}</span>
                      <span className={`type2-item-spent${item.spent > item.amount ? ' text-danger' : ''}`}>
                        {formatCurrency(item.spent)}
                      </span>
                      <span className="type2-item-amount text-muted">/ {formatCurrency(item.amount)}</span>
                      <span className={`type2-item-status ${cls}`}>{icon} {label}</span>
                      <span className="type2-item-actions">
                        <button className="btn btn-ghost btn-icon"
                          onClick={() => { setAddingFor(null); setEditItem(item); }}>
                          <Pencil size={13} />
                        </button>
                        <button className="btn btn-ghost btn-icon" onClick={() => handleDeleteItem(item)}>
                          <Trash2 size={13} />
                        </button>
                      </span>
                    </div>
                  );
                })}

                {addingFor === cat.id && (
                  <ItemForm categoryId={cat.id}
                    onSave={handleSaved} onCancel={() => setAddingFor(null)} />
                )}

                {addingFor !== cat.id && !editItem && (
                  <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', marginTop: 4 }}
                    onClick={() => { setAddingFor(cat.id); setEditItem(null); }}>
                    <Plus size={13} /> Přidat podpoložku
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Sekce Typ 3 ───────────────────────────────────────────────────────────────

function FundConfigForm({ cat, onSave, onCancel }) {
  const [typicalPrice, setTypicalPrice] = useState(cat.typical_price != null ? String(cat.typical_price) : '');
  const [frequencyMonths, setFrequencyMonths] = useState(cat.frequency_months != null ? String(cat.frequency_months) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const monthly = typicalPrice && frequencyMonths && parseFloat(frequencyMonths) > 0
    ? Math.round(parseFloat(typicalPrice) / parseFloat(frequencyMonths)) : null;

  async function handleSubmit(e) {
    e.preventDefault();
    const tp = parseFloat(typicalPrice);
    const fm = parseInt(frequencyMonths);
    if (!tp || tp <= 0) { setError('Zadejte typickou cenu.'); return; }
    if (!fm || fm <= 0) { setError('Zadejte frekvenci.'); return; }
    setSaving(true); setError('');
    try {
      const r = await fetch(`/api/categories/${cat.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typical_price: tp, frequency_months: fm }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Chyba.'); return; }
      onSave(d);
    } catch { setError('Chyba připojení.'); }
    finally { setSaving(false); }
  }

  return (
    <form className="item-form" onSubmit={handleSubmit}>
      {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="item-form-row">
        <div>
          <div className="text-muted" style={{ fontSize: 11, marginBottom: 3 }}>Typická cena (Kč)</div>
          <input className="input" type="number" min="1" step="1" placeholder="25 000"
            value={typicalPrice} onChange={e => setTypicalPrice(e.target.value)}
            autoFocus style={{ maxWidth: 130 }} />
        </div>
        <div>
          <div className="text-muted" style={{ fontSize: 11, marginBottom: 3 }}>Frekvence (měsíce)</div>
          <input className="input" type="number" min="1" step="1" placeholder="36"
            value={frequencyMonths} onChange={e => setFrequencyMonths(e.target.value)}
            style={{ maxWidth: 100 }} />
        </div>
        {monthly && (
          <div className="text-muted" style={{ fontSize: 12, paddingTop: 18 }}>
            ≈ <strong style={{ color: 'var(--text)' }}>{monthly.toLocaleString('cs-CZ')} Kč</strong> / měsíc
          </div>
        )}
        <div style={{ paddingTop: 18, display: 'flex', gap: 6 }}>
          <button type="submit" className="btn btn-primary btn-icon" disabled={saving}><Check size={15} /></button>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onCancel}><X size={15} /></button>
        </div>
      </div>
    </form>
  );
}

function Type3Section({ categories, year }) {
  const navigate = useNavigate();
  const [funds, setFunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);

  function load() {
    setLoading(true);
    fetch(`/api/categories/fund-status?year=${year}`)
      .then(r => r.json())
      .then(setFunds)
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [year]);

  function handleSaved(updatedCat) {
    setFunds(prev => prev.map(f => f.id === updatedCat.id
      ? {
          ...f,
          typical_price: updatedCat.typical_price,
          frequency_months: updatedCat.frequency_months,
          monthly_contribution: updatedCat.typical_price && updatedCat.frequency_months
            ? Math.round(updatedCat.typical_price / updatedCat.frequency_months) : null,
        }
      : f
    ));
    setEditingId(null);
  }

  const type3Cats = categories.filter(c => c.type === 3);

  if (type3Cats.length === 0) return (
    <div className="empty-state">
      <p>Žádné fondy obnovy.</p>
      <p className="text-muted">Přiřaďte kategorii typ „Fond obnovy" v sekci Kategorie.</p>
    </div>
  );

  if (loading) return <div className="page-loading">{t.common.loading}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {type3Cats.map(cat => {
        const fund = funds.find(f => f.id === cat.id);
        return (
          <div key={cat.id} className="budget-item" style={{ cursor: 'default' }}>
            <div className="budget-item-header">
              <div className="budget-item-name">
                <span className="budget-dot" style={{ background: cat.color || '#6366f1' }} />
                <span style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/transactions?category_id=${cat.id}&from=${year}-01-01&to=${year}-12-31`)}>
                  {cat.name}
                </span>
              </div>
              <button className="btn btn-ghost btn-icon" title="Upravit konfiguraci"
                onClick={() => setEditingId(editingId === cat.id ? null : cat.id)}>
                <Pencil size={14} />
              </button>
            </div>

            {editingId === cat.id && (
              <FundConfigForm cat={fund || cat} onSave={handleSaved} onCancel={() => setEditingId(null)} />
            )}

            {fund ? (
              <div className="fund-info-row">
                {fund.typical_price ? (
                  <span className="fund-info-item">
                    <span className="text-muted">typická cena</span>
                    <strong>{formatCurrency(fund.typical_price)}</strong>
                  </span>
                ) : (
                  <span className="fund-info-item text-muted" style={{ fontStyle: 'italic' }}>
                    konfigurujte typickou cenu →
                  </span>
                )}
                {fund.frequency_months && (
                  <span className="fund-info-item">
                    <span className="text-muted">frekvence</span>
                    <strong>{fund.frequency_months} měs.</strong>
                  </span>
                )}
                {fund.monthly_contribution && (
                  <span className="fund-info-item">
                    <span className="text-muted">příspěvek / měsíc</span>
                    <strong>~{formatCurrency(fund.monthly_contribution)}</strong>
                  </span>
                )}
                <span className="fund-info-item">
                  <span className="text-muted">naposledy</span>
                  <strong>
                    {fund.last_payment_date
                      ? fund.months_since_last === 0
                        ? 'tento měsíc'
                        : `před ${fund.months_since_last} měs.`
                      : 'nikdy'}
                  </strong>
                </span>
                <span className="fund-info-item">
                  <span className="text-muted">letos utraceno</span>
                  <strong>{formatCurrency(fund.total_year)}</strong>
                </span>
              </div>
            ) : (
              <div className="text-muted" style={{ fontSize: 13 }}>Nastavte konfiguraci fondu.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Hlavní stránka ────────────────────────────────────────────────────────────

export default function BudgetsPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState(null);
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [currentPeriod, setCurrentPeriod] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [annualYear, setAnnualYear] = useState(new Date().getFullYear());

  useEffect(() => {
    Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/categories').then(r => r.json()),
    ]).then(([s, cats]) => {
      setPeriod(s.current_period);
      setCurrentPeriod(s.current_period);
      setCategories(cats);
    });
  }, []);

  function loadBudgets(p) {
    setLoading(true);
    fetch(`/api/budgets?period=${p}`)
      .then(r => r.json())
      .then(d => {
        // Zobraz jen Typ 1 (nebo starší záznamy bez typu)
        setBudgets((d.budgets || []).filter(b => !b.category_type || b.category_type === 1));
        setPeriodStart(d.period_start);
        setPeriodEnd(d.period_end);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { if (period) loadBudgets(period); }, [period]);

  async function handleDelete(b) {
    if (!confirm('Smazat tento rozpočet?')) return;
    const id = b.override_id ?? b.default_id;
    const r = await fetch(`/api/budgets/${id}`, { method: 'DELETE' });
    if (r.ok) loadBudgets(period);
  }

  const existingCategoryIds = budgets.map(b => b.category_id);
  const pct = (spent, amount) => amount > 0 ? (spent / amount) * 100 : 0;
  const periodLabel = formatPeriod(periodStart, periodEnd);

  return (
    <Layout>
      {/* ── Typ 1 – Měsíční ── */}
      <div className="page-header">
        <h1 className="page-title">Měsíční rozpočty</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {period && (
            <div className="month-nav">
              <button className="btn btn-ghost btn-icon"
                onClick={() => { setPeriod(p => addPeriods(p, -1)); setShowForm(false); setEditItem(null); }}>
                <ChevronLeft size={18} />
              </button>
              <span className="month-label">{periodLabel}</span>
              <button className="btn btn-ghost btn-icon"
                onClick={() => { setPeriod(p => addPeriods(p, 1)); setShowForm(false); setEditItem(null); }}
                disabled={period >= currentPeriod}>
                <ChevronRight size={18} />
              </button>
            </div>
          )}
          {!showForm && !editItem && categories.some(c => !c.type || c.type === 1) && (
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              <Plus size={16} /> Přidat rozpočet
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <div className="card" style={{ maxWidth: 480, marginBottom: 24 }}>
          <BudgetForm categories={categories} period={period} periodLabel={periodLabel}
            existingCategoryIds={existingCategoryIds}
            onSave={() => { setShowForm(false); loadBudgets(period); }}
            onCancel={() => setShowForm(false)} />
        </div>
      )}

      {loading ? (
        <div className="page-loading">{t.common.loading}</div>
      ) : budgets.length === 0 && !showForm ? (
        <div className="empty-state">
          <p>Žádné měsíční rozpočty.</p>
          <p className="text-muted">Přidejte rozpočet — bude platit pro všechna období.</p>
        </div>
      ) : (
        <div className="budget-list">
          {budgets.map(b => {
            const over = b.spent > b.amount;
            const remaining = b.amount - b.spent;
            const p = pct(b.spent, b.amount);
            return editItem?.category_id === b.category_id ? (
              <div key={b.category_id} className="card" style={{ maxWidth: 640 }}>
                <BudgetForm initial={b} categories={categories} period={period} periodLabel={periodLabel}
                  existingCategoryIds={existingCategoryIds}
                  onSave={() => { setEditItem(null); loadBudgets(period); }}
                  onCancel={() => setEditItem(null)} />
              </div>
            ) : (
              <div key={b.category_id} className="budget-item budget-item-clickable"
                onClick={() => navigate(`/transactions?category_id=${b.category_id}&period=${period}`)}>
                <div className="budget-item-header">
                  <div className="budget-item-name">
                    <span className="budget-dot" style={{ background: b.category_color || '#6366f1' }} />
                    {b.category_name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="budget-item-amounts">
                      <span className={over ? 'text-danger' : ''}>{formatCurrency(b.spent)}</span>
                      <span className="text-muted"> / {formatCurrency(b.amount)}</span>
                    </div>
                    <button className="btn btn-ghost btn-icon" title="Upravit"
                      onClick={e => { e.stopPropagation(); setShowForm(false); setEditItem(b); }}>
                      <Pencil size={14} />
                    </button>
                    <button className="btn btn-ghost btn-icon" title="Smazat"
                      onClick={e => { e.stopPropagation(); handleDelete(b); }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <BudgetThermometer spent={b.spent} amount={b.amount}
                  periodStart={periodStart} periodEnd={periodEnd} color={b.category_color} />
                <div className="budget-item-footer">
                  {over
                    ? <span className="text-danger">{formatCurrency(Math.abs(remaining))} přečerpáno</span>
                    : <span className="text-muted">{formatCurrency(remaining)} zbývá</span>}
                  <span className="text-muted">{Math.round(p)} %</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Typ 2 – Roční / sezónní ── */}
      <div className="page-header" style={{ marginTop: 40 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Roční / sezónní plán</h2>
        <div className="month-nav">
          <button className="btn btn-ghost btn-icon" onClick={() => setAnnualYear(y => y - 1)}>
            <ChevronLeft size={18} />
          </button>
          <span className="month-label">{annualYear}</span>
          <button className="btn btn-ghost btn-icon" onClick={() => setAnnualYear(y => y + 1)}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <Type2Section categories={categories} year={annualYear} />

      {/* ── Typ 3 – Fond obnovy ── */}
      <div className="page-header" style={{ marginTop: 40 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Fond obnovy</h2>
      </div>
      <Type3Section categories={categories} year={annualYear} />
    </Layout>
  );
}
