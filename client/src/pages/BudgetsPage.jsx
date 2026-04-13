import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import Layout from '../components/Layout';
import { t, formatCurrency, formatPeriod, addPeriods } from '../i18n';

const i = {
  title: 'Rozpočty',
  addBudget: 'Přidat rozpočet',
  editBudget: 'Upravit rozpočet',
  category: 'Kategorie',
  limit: 'Měsíční limit (Kč)',
  selectCategory: '— vyberte kategorii —',
  noBudgets: 'Žádné rozpočty pro toto období.',
  noBudgetsHint: 'Přidejte rozpočet pro kategorii.',
  noCategories: 'Nejprve vytvořte kategorie v sekci Kategorie.',
  deleteConfirm: 'Smazat tento rozpočet?',
  spent: 'utraceno',
  remaining: 'zbývá',
  over: 'přečerpáno',
};

function BudgetForm({ initial, categories, period, existingCategoryIds, onSave, onCancel }) {
  const [categoryId, setCategoryId] = useState(initial?.category_id ? String(initial.category_id) : '');
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const availableCategories = categories.filter(c =>
    !existingCategoryIds.includes(c.id) || c.id === initial?.category_id
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
        body: JSON.stringify({ category_id: parseInt(categoryId), period, amount: amt }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Chyba.'); return; }
      onSave(d);
    } catch {
      setError('Chyba připojení.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="category-form" onSubmit={handleSubmit}>
      <h3 className="category-form-title">{initial ? i.editBudget : i.addBudget}</h3>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="form-group">
        <label className="form-label">{i.category}</label>
        <select
          className="input"
          value={categoryId}
          onChange={e => setCategoryId(e.target.value)}
          disabled={!!initial}
        >
          <option value="">{i.selectCategory}</option>
          {availableCategories.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">{i.limit}</label>
        <input
          className="input"
          type="number"
          min="1"
          step="1"
          placeholder="5 000"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          autoFocus={!!initial}
          style={{ maxWidth: 160 }}
        />
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          <X size={15} /> {t.categories.cancel}
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          <Check size={15} /> {saving ? '…' : t.categories.save}
        </button>
      </div>
    </form>
  );
}

export default function BudgetsPage() {
  const [period, setPeriod] = useState(null);
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [currentPeriod, setCurrentPeriod] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);

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

  useEffect(() => {
    if (!period) return;
    setLoading(true);
    fetch(`/api/budgets?period=${period}`)
      .then(r => r.json())
      .then(d => {
        setBudgets(d.budgets || []);
        setPeriodStart(d.period_start);
        setPeriodEnd(d.period_end);
      })
      .finally(() => setLoading(false));
  }, [period]);

  const existingCategoryIds = budgets.map(b => b.category_id);

  function handleSaved(budget) {
    setBudgets(prev => {
      const idx = prev.findIndex(b => b.id === budget.id);
      if (idx >= 0) {
        const next = [...prev]; next[idx] = budget; return next;
      }
      // nový — reload pro správná data (spent atd.)
      fetch(`/api/budgets?period=${period}`).then(r => r.json()).then(d => setBudgets(d.budgets || []));
      return prev;
    });
    setShowForm(false);
    setEditItem(null);
  }

  async function handleDelete(budget) {
    if (!confirm(i.deleteConfirm)) return;
    const r = await fetch(`/api/budgets/${budget.id}`, { method: 'DELETE' });
    if (r.ok) setBudgets(prev => prev.filter(b => b.id !== budget.id));
  }

  const pct = (spent, amount) => amount > 0 ? Math.min((spent / amount) * 100, 100) : 0;

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{i.title}</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {period && (
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
          {!showForm && !editItem && categories.length > 0 && (
            <button className="btn btn-primary" onClick={() => setShowForm(true)}>
              <Plus size={16} /> {i.addBudget}
            </button>
          )}
        </div>
      </div>

      {categories.length === 0 && !loading && (
        <div className="empty-state"><p>{i.noCategories}</p></div>
      )}

      {showForm && !editItem && (
        <div className="card" style={{ maxWidth: 480, marginBottom: 24 }}>
          <BudgetForm
            categories={categories}
            period={period}
            existingCategoryIds={existingCategoryIds}
            onSave={handleSaved}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {loading ? (
        <div className="page-loading">{t.common.loading}</div>
      ) : budgets.length === 0 && !showForm ? (
        categories.length > 0 && <div className="empty-state"><p>{i.noBudgets}</p><p className="text-muted">{i.noBudgetsHint}</p></div>
      ) : (
        <div className="budget-list">
          {budgets.map(b => {
            const over = b.spent > b.amount;
            const remaining = b.amount - b.spent;
            const p = pct(b.spent, b.amount);

            return editItem?.id === b.id ? (
              <div key={b.id} className="card" style={{ maxWidth: 640 }}>
                <BudgetForm
                  initial={b}
                  categories={categories}
                  period={period}
                  existingCategoryIds={existingCategoryIds}
                  onSave={handleSaved}
                  onCancel={() => setEditItem(null)}
                />
              </div>
            ) : (
              <div key={b.id} className="budget-item">
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
                    <button className="btn btn-ghost btn-icon" onClick={() => { setShowForm(false); setEditItem(b); }}>
                      <Pencil size={14} />
                    </button>
                    <button className="btn btn-ghost btn-icon" onClick={() => handleDelete(b)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="budget-bar-track">
                  <div
                    className={`budget-bar-fill${over ? ' over' : ''}`}
                    style={{ width: `${p}%`, background: over ? undefined : (b.category_color || '#6366f1') }}
                  />
                </div>
                <div className="budget-item-footer">
                  {over
                    ? <span className="text-danger">{formatCurrency(Math.abs(remaining))} {i.over}</span>
                    : <span className="text-muted">{formatCurrency(remaining)} {i.remaining}</span>
                  }
                  <span className="text-muted">{Math.round(p)} %</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
