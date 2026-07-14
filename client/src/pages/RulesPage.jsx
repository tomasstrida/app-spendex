import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Pencil, Trash2, Check, X, Search } from 'lucide-react';
import Layout from '../components/Layout';

const EMPTY = { pattern: '', category_id: '', subcategory_id: '', amount_max_abs: '', amount_min_abs: '' };

// Necitlivé na velikost písmen i diakritiku (konvence appky – viz unaccent_lower).
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function RulesPage() {
  const [rules, setRules] = useState([]);
  const [cats, setCats] = useState([]);
  const [subcats, setSubcats] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [adv, setAdv] = useState(false);
  const [err, setErr] = useState('');
  const [query, setQuery] = useState('');
  const formRef = useRef(null);
  const patternRef = useRef(null);

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return rules;
    return rules.filter(r => norm(r.pattern).includes(q) || norm(r.category_name).includes(q));
  }, [rules, query]);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([fetch('/api/rules'), fetch('/api/categories')]);
      if (!r.ok || !c.ok) throw new Error('load');
      const [rj, cj] = [await r.json(), await c.json()];
      setRules(Array.isArray(rj) ? rj : []);
      setCats(Array.isArray(cj) ? cj : []);
    } catch {
      setErr('Nepodařilo se načíst pravidla.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Subkategorie závisí na vybrané kategorii — tento efekt jen NAČÍTÁ options
  // pro dropdown. Reset staré subcategory_id při ruční změně kategorie řeší
  // synchronně onChange u selectu Kategorie (níže), ne tento efekt — jinak
  // vzniká okno mezi změnou kategorie a doběhnutím fetch, kdy jde odeslat
  // neplatná (cizí) subcategory_id (uložení dřív, než fetch skončí, nebo
  // .catch větev). Při předvyplnění z existujícího pravidla (startEdit
  // nastaví category_id i subcategory_id najednou přímo přes setForm, ne
  // přes tento onChange) subcategory_id díky tomu zůstane zachovaná.
  useEffect(() => {
    const catId = form.category_id;
    if (!catId) { setSubcats([]); return; }
    let cancelled = false;
    fetch(`/api/subcategories?category_id=${catId}`)
      .then(r => (r.ok ? r.json() : []))
      .then(list => { if (!cancelled) setSubcats(Array.isArray(list) ? list : []); })
      .catch(() => { if (!cancelled) setSubcats([]); });
    return () => { cancelled = true; };
  }, [form.category_id]);

  function reset() { setForm(EMPTY); setEditId(null); setAdv(false); setErr(''); }

  async function save() {
    setErr('');
    if (!form.pattern.trim()) { setErr('Zadej text v platbě.'); return; }
    if (!form.category_id) { setErr('Vyber kategorii.'); return; }
    const body = {
      pattern: form.pattern.trim(),
      category_id: form.category_id ? Number(form.category_id) : null,
      subcategory_id: form.subcategory_id || null,
      amount_max_abs: form.amount_max_abs === '' ? null : Number(form.amount_max_abs),
      amount_min_abs: form.amount_min_abs === '' ? null : Number(form.amount_min_abs),
    };
    const url = editId ? `/api/rules/${editId}` : '/api/rules';
    const res = await fetch(url, {
      method: editId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { setErr((await res.json()).error || 'Chyba.'); return; }
    reset();
    load();
  }

  function startEdit(r) {
    setEditId(r.id);
    setForm({
      pattern: r.pattern,
      category_id: String(r.category_id),
      subcategory_id: r.subcategory_id ? String(r.subcategory_id) : '',
      amount_max_abs: r.amount_max_abs ?? '',
      amount_min_abs: r.amount_min_abs ?? '',
    });
    setAdv(r.amount_max_abs != null || r.amount_min_abs != null);
    setErr('');
    // Formulář je nad dlouhým seznamem — bez scrollu/focusu vypadá editace
    // jako „nic se nestalo". Scrollni k němu a zaměř pole.
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      patternRef.current?.focus();
    });
  }

  async function remove(id) {
    if (!confirm('Smazat pravidlo?')) return;
    const res = await fetch(`/api/rules/${id}`, { method: 'DELETE' });
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Chyba mazání.'); return; }
    if (editId === id) reset();
    load();
  }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Pravidla</h1>
      </div>

      <p className="text-muted" style={{ marginBottom: 16, fontSize: 13 }}>
        Když popis, poznámka nebo obchodní místo platby obsahuje zadaný text, přiřadí se kategorie.
        Pravidlo se uplatní na nově importované platby.
      </p>

      {err && <div className="alert alert-error" style={{ marginBottom: 12, maxWidth: 900 }}>{err}</div>}

      <div
        ref={formRef}
        className="card"
        style={{
          marginBottom: 16,
          maxWidth: 900,
          ...(editId ? { boxShadow: '0 0 0 2px var(--primary, #6366f1)' } : {}),
        }}
      >
        {editId && (
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 8, fontWeight: 600 }}>
            Upravuješ pravidlo
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 2, minWidth: 200, margin: 0 }}>
            <label className="form-label">Text v platbě</label>
            <input
              ref={patternRef}
              className="input"
              value={form.pattern}
              placeholder="např. ZIZKAVARNA"
              onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))}
            />
          </div>
          <div className="form-group" style={{ flex: 2, minWidth: 200, margin: 0 }}>
            <label className="form-label">Kategorie</label>
            <select
              className="input"
              value={form.category_id}
              onChange={e => setForm(f => ({ ...f, category_id: e.target.value, subcategory_id: '' }))}
            >
              <option value="">— vyber —</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ flex: 2, minWidth: 200, margin: 0 }}>
            <label className="form-label">Subkategorie</label>
            <select
              className="input"
              value={form.subcategory_id}
              disabled={subcats.length === 0}
              onChange={e => setForm(f => ({ ...f, subcategory_id: e.target.value }))}
            >
              <option value="">— žádná —</option>
              {subcats.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={save}>
              {editId ? <><Check size={14} /> Uložit</> : <><Plus size={14} /> Přidat</>}
            </button>
            {editId && (
              <button className="btn btn-ghost" onClick={reset}>
                <X size={14} /> Zrušit
              </button>
            )}
          </div>
        </div>

        <button
          className="btn btn-ghost"
          style={{ marginTop: 8, fontSize: 12 }}
          onClick={() => setAdv(a => !a)}
        >
          {adv ? 'Skrýt pokročilé' : 'Pokročilé'} (omezení částkou)
        </button>

        {adv && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: 11 }}>Jen do částky (Kč)</label>
              <input
                className="input"
                type="number"
                min="0"
                value={form.amount_max_abs}
                style={{ maxWidth: 140 }}
                onChange={e => setForm(f => ({ ...f, amount_max_abs: e.target.value }))}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" style={{ fontSize: 11 }}>Od částky (Kč)</label>
              <input
                className="input"
                type="number"
                min="0"
                value={form.amount_min_abs}
                style={{ maxWidth: 140 }}
                onChange={e => setForm(f => ({ ...f, amount_min_abs: e.target.value }))}
              />
            </div>
          </div>
        )}
      </div>

      {rules.length > 0 && (
        <div style={{ position: 'relative', maxWidth: 900, marginBottom: 12 }}>
          <Search
            size={15}
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text2)' }}
          />
          <input
            className="input"
            value={query}
            placeholder="Hledat pravidlo nebo kategorii…"
            onChange={e => setQuery(e.target.value)}
            style={{ paddingLeft: 32 }}
          />
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden', maxWidth: 900 }}>
        {rules.length === 0 ? (
          <div className="text-muted" style={{ padding: '12px 16px', fontSize: 13 }}>Zatím žádná pravidla.</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted" style={{ padding: '12px 16px', fontSize: 13 }}>
            Žádné pravidlo neodpovídá „{query}".
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text2)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Text v platbě</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Kategorie</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Omezení</th>
                <th style={{ padding: '10px 12px' }} />
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr
                  key={r.id}
                  style={{
                    borderTop: '1px solid var(--border)',
                    background: editId === r.id ? 'var(--surface2, rgba(99,102,241,0.08))' : 'transparent',
                  }}
                >
                  <td style={{ padding: '8px 12px', fontWeight: 500 }}>{r.pattern}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: r.category_color || '#888',
                        flexShrink: 0,
                      }} />
                      {r.category_name || '—'}
                      {r.subcategory_name && <span className="text-muted"> · {r.subcategory_name}</span>}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px' }} className="text-muted">
                    {r.amount_max_abs != null && <span>≤ {r.amount_max_abs} Kč</span>}
                    {r.amount_max_abs != null && r.amount_min_abs != null && ' '}
                    {r.amount_min_abs != null && <span>≥ {r.amount_min_abs} Kč</span>}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-icon" onClick={() => startEdit(r)} title="Upravit">
                      <Pencil size={14} />
                    </button>
                    <button className="btn btn-ghost btn-icon" onClick={() => remove(r.id)} title="Smazat">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
