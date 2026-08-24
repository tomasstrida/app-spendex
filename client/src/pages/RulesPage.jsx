import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Pencil, Trash2, Check, X, Search, ChevronRight, ChevronDown, AlertTriangle } from 'lucide-react';
import Layout from '../components/Layout';
import { formatCurrency } from '../i18n';

const EMPTY = { pattern: '', category_id: '', subcategory_id: '', amount_max_abs: '', amount_min_abs: '' };

// Necitlivé na velikost písmen i diakritiku (konvence appky – viz unaccent_lower).
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: '2-digit' }) : '');

// České plurály 1 / 2–4 / 5+.
const mismatchLabel = (n) => (n === 1 ? '1 platba má' : n < 5 ? `${n} platby mají` : `${n} plateb má`);

export default function RulesPage() {
  const [rules, setRules] = useState([]);
  const [cats, setCats] = useState([]);
  const [subcats, setSubcats] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [adv, setAdv] = useState(false);
  const [err, setErr] = useState('');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [scanning, setScanning] = useState(false);
  // Výsledek posledního skenu — bez něj tlačítko při nulovém nálezu neudělá nic viditelného.
  const [scanMsg, setScanMsg] = useState('');
  // Roste s každým skenem — jako `key` vynutí remount, takže se animace
  // přehraje znovu i když je text stejný jako minule.
  const [scanRun, setScanRun] = useState(0);
  // Detail plateb pod návrhem: id → { loading, error, data }. Lazy-load při prvním rozbalení.
  const [expanded, setExpanded] = useState(null);
  const [details, setDetails] = useState({});
  const formRef = useRef(null);
  const patternRef = useRef(null);

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return rules;
    return rules.filter(r => norm(r.pattern).includes(q) || norm(r.category_name).includes(q));
  }, [rules, query]);

  const load = useCallback(async () => {
    try {
      const [r, c, s] = await Promise.all([
        fetch('/api/rules'), fetch('/api/categories'), fetch('/api/rules/suggestions'),
      ]);
      if (!r.ok || !c.ok) throw new Error('load');
      const [rj, cj, sj] = [await r.json(), await c.json(), s.ok ? await s.json() : []];
      setRules(Array.isArray(rj) ? rj : []);
      setCats(Array.isArray(cj) ? cj : []);
      setSuggestions(Array.isArray(sj) ? sj : []);
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
    // Protiúčtová pravidla (pattern='') tenhle formulář needituje — vyžaduje text
    // v platbě, takže by uložení buď spadlo, nebo by z pravidla udělalo AND(text,
    // protiúčet) a přestalo by matchovat. Editace = smazat a založit znovu z návrhu.
    if (r.match_counterparty_account) {
      setErr('Toto pravidlo je založené na protiúčtu a nedá se tu editovat. Smaž ho a založ znovu přes návrh (sekce Návrhy pravidel nebo review fronta v Importu).');
      return;
    }
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

  // Rozbalí/sbalí detail plateb návrhu. Data se tahají až při prvním rozbalení
  // a drží se v cache — sbalení a znovurozbalení už síť netrápí.
  async function toggleDetail(id) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (details[id]) return;
    setDetails(d => ({ ...d, [id]: { loading: true } }));
    try {
      const res = await fetch(`/api/rules/suggestions/${id}/transactions`);
      if (!res.ok) throw new Error('load');
      const data = await res.json();
      setDetails(d => ({ ...d, [id]: { data } }));
    } catch {
      setDetails(d => ({ ...d, [id]: { error: 'Nepodařilo se načíst platby.' } }));
    }
  }

  async function approveSuggestion(id) {
    const res = await fetch(`/api/rules/suggestions/${id}/approve`, { method: 'POST' });
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Chyba.'); return; }
    if (expanded === id) setExpanded(null);
    load();
  }

  async function dismissSuggestion(id) {
    const res = await fetch(`/api/rules/suggestions/${id}/dismiss`, { method: 'POST' });
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Chyba.'); return; }
    if (expanded === id) setExpanded(null);
    load();
  }

  async function scanHistory() {
    setScanning(true);
    setScanMsg('');
    setScanRun(n => n + 1);
    try {
      const res = await fetch('/api/rules/suggestions/scan', { method: 'POST' });
      if (!res.ok) { setErr('Chyba při kontrole historie.'); return; }
      // Pozor: `found` je počet PENDING návrhů po skenu, ne počet nově vzniklých —
      // upsert přeskóruje i ty, které už čekaly. Proto neutrální „nalezeno".
      const found = (await res.json().catch(() => ({}))).found ?? 0;
      setScanMsg(found > 0
        ? `Nalezeno návrhů: ${found}.`
        : 'Nic k automatizaci — v historii není další opakující se protiúčet.');
      load();
    } finally { setScanning(false); }
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

      <div className="card" style={{ marginBottom: 16, maxWidth: 900 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>Návrhy pravidel</strong>{' '}
            <span className="text-muted" style={{ fontSize: 12 }}>
              podle opakujícího se čísla protiúčtu, ne textu
            </span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <button className="btn btn-ghost" disabled={scanning} onClick={scanHistory}>
              {scanning ? 'Kontroluji…' : 'Zkontrolovat historii'}
            </button>
            {scanMsg && <div key={scanRun} className="scan-result">{scanMsg}</div>}
          </div>
        </div>
        {suggestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {suggestions.map(s => (
              <div key={s.id} style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', gap: 12,
                }}>
                  <button
                    type="button"
                    onClick={() => toggleDetail(s.id)}
                    title="Zobrazit historické platby tohoto protiúčtu"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, textAlign: 'left',
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit',
                    }}
                  >
                    {expanded === s.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span>
                      Protiúčet <strong>{s.counterparty_account}</strong> → {s.category_name}
                      {s.subcategory_name && <span className="text-muted"> · {s.subcategory_name}</span>}
                      <span className="text-muted"> ({s.coverage_count}× plateb, {(s.purity * 100).toFixed(0)} % shoda)</span>
                    </span>
                  </button>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => approveSuggestion(s.id)}>
                      Založit
                    </button>
                    <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => dismissSuggestion(s.id)}>
                      Zamítnout
                    </button>
                  </div>
                </div>
                {expanded === s.id && (
                  <SuggestionDetail state={details[s.id]} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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
                  <td style={{ padding: '8px 12px', fontWeight: 500 }}>
                    {r.pattern || (r.match_counterparty_account
                      ? <span className="text-muted">protiúčet {r.match_counterparty_account}</span>
                      : '—')}
                  </td>
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

// Rozbalený detail návrhu: všechny historické platby daného protiúčtu.
// Řádky s jinou kategorií jsou zvýrazněné — právě ty pravidlo přeštítkuje,
// protože protiúčtové pravidlo je bezesměrové (zasáhne i příchozí vratky).
function SuggestionDetail({ state }) {
  const wrap = { borderTop: '1px solid var(--border)', padding: '10px 12px' };
  if (!state || state.loading) return <div style={wrap} className="text-muted">Načítám platby…</div>;
  if (state.error) return <div style={wrap} className="text-muted">{state.error}</div>;

  const { transactions = [], mismatch_count: mismatch = 0, suggested_category_name: target } = state.data || {};
  if (!transactions.length) return <div style={wrap} className="text-muted">Žádné platby k zobrazení.</div>;

  const th = { textAlign: 'left', fontWeight: 600, padding: '4px 8px', whiteSpace: 'nowrap' };
  const td = { padding: '4px 8px', verticalAlign: 'top' };
  // Oranžová = stejný semafor jako u teploměrů a varování na Schůzce.
  const WARN = '#f97316';

  return (
    <div style={wrap}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr className="text-muted">
              <th style={th}>Datum</th>
              <th style={th}>Popis</th>
              <th style={{ ...th, textAlign: 'right' }}>Částka</th>
              <th style={th}>Kategorie</th>
              <th style={th}>Účet</th>
              <th style={th}>VS</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map(tx => (
              <tr
                key={tx.id}
                style={{
                  borderTop: '1px solid var(--border)',
                  background: tx.matches_suggestion ? 'transparent' : '#f9731614',
                }}
              >
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(tx.date)}</td>
                <td style={td}>{tx.description || tx.place || tx.note || '—'}</td>
                <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {tx.amount < 0 ? '−' : '+'}{formatCurrency(Math.abs(tx.amount))}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {!tx.matches_suggestion && (
                    <AlertTriangle size={12} color={WARN} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                  )}
                  {tx.category_name || 'nezařazeno'}
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }} className="text-muted">{tx.account_name || '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }} className="text-muted">{tx.variable_symbol || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mismatch > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={14} color={WARN} style={{ flexShrink: 0 }} />
          <span>
            {mismatchLabel(mismatch)} jinou kategorii — pravidlo {mismatch === 1 ? 'ji' : 'je'} přeštítkuje
            na <strong>{target}</strong>.
          </span>
        </div>
      )}
    </div>
  );
}
