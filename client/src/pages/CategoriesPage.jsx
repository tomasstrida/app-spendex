import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import Layout from '../components/Layout';
import { t } from '../i18n';

const COLORS = [
  '#6366f1','#8b5cf6','#a855f7','#ec4899','#ef4444',
  '#f97316','#eab308','#84cc16','#22c55e','#14b8a6',
  '#06b6d4','#3b82f6','#64748b','#f43f5e','#10b981','#f59e0b',
];

function ColorPicker({ value, onChange }) {
  return (
    <div className="color-picker">
      {COLORS.map(c => (
        <button
          key={c}
          type="button"
          className={`color-swatch${value === c ? ' selected' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

function CategoryForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [color, setColor] = useState(initial?.color || COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Zadejte název.'); return; }
    setSaving(true);
    setError('');
    try {
      const method = initial ? 'PATCH' : 'POST';
      const url = initial ? `/api/categories/${initial.id}` : '/api/categories';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color }),
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
      <h3 className="category-form-title">{initial ? t.categories.edit : t.categories.add}</h3>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-group">
        <label className="form-label">{t.categories.name}</label>
        <input
          className="input"
          placeholder={t.categories.namePlaceholder}
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
        />
      </div>
      <div className="form-group">
        <label className="form-label">{t.categories.color}</label>
        <ColorPicker value={color} onChange={setColor} />
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

export default function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);

  useEffect(() => {
    fetch('/api/categories')
      .then(r => r.json())
      .then(d => { setCategories(d); setLoading(false); });
  }, []);

  function handleSaved(cat) {
    if (editItem) {
      setCategories(prev => prev.map(c => c.id === cat.id ? cat : c));
      setEditItem(null);
    } else {
      setCategories(prev => [...prev, cat]);
      setShowForm(false);
    }
  }

  async function handleDelete(cat) {
    if (!confirm(t.categories.deleteConfirm)) return;
    const r = await fetch(`/api/categories/${cat.id}`, { method: 'DELETE' });
    if (r.ok) setCategories(prev => prev.filter(c => c.id !== cat.id));
  }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{t.categories.title}</h1>
        {!showForm && !editItem && (
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={16} /> {t.categories.add}
          </button>
        )}
      </div>

      {(showForm && !editItem) && (
        <div className="card" style={{ maxWidth: 480, marginBottom: 24 }}>
          <CategoryForm onSave={handleSaved} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {loading ? (
        <div className="page-loading">{t.common.loading}</div>
      ) : categories.length === 0 && !showForm ? (
        <div className="empty-state">
          <p>{t.categories.noCategories}</p>
        </div>
      ) : (
        <div className="category-list">
          {categories.map(cat => (
            editItem?.id === cat.id ? (
              <div key={cat.id} className="card" style={{ maxWidth: 480 }}>
                <CategoryForm
                  initial={cat}
                  onSave={handleSaved}
                  onCancel={() => setEditItem(null)}
                />
              </div>
            ) : (
              <div key={cat.id} className="category-row">
                <div className="category-row-info">
                  <span className="budget-dot" style={{ background: cat.color, width: 14, height: 14 }} />
                  <span className="category-row-name">{cat.name}</span>
                </div>
                <div className="category-row-actions">
                  <button className="btn btn-ghost btn-icon" onClick={() => { setShowForm(false); setEditItem(cat); }}>
                    <Pencil size={15} />
                  </button>
                  <button className="btn btn-ghost btn-icon" onClick={() => handleDelete(cat)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )
          ))}
        </div>
      )}
    </Layout>
  );
}
