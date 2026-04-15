import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import Layout from '../components/Layout';
import { formatCurrency, formatPeriod, addPeriods } from '../i18n';

// ── Status budgetu ────────────────────────────────────────────────────────────

function budgetStatus(spent, budget) {
  if (spent <= budget) return 'ok';
  if (spent <= budget * 1.1) return 'warn';
  return 'over';
}
const STATUS = {
  ok:   { icon: '✅', cls: '' },
  warn: { icon: '⚠️', cls: 'text-warn' },
  over: { icon: '🔴', cls: 'text-danger' },
};

// ── Donut chart (SVG) ────────────────────────────────────────────────────────

function polarToXY(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, ri, startDeg, sweep) {
  if (sweep >= 359.99) sweep = 359.99;
  const end = startDeg + sweep;
  const s = polarToXY(cx, cy, r, startDeg);
  const e = polarToXY(cx, cy, r, end);
  const si = polarToXY(cx, cy, ri, end);
  const ei = polarToXY(cx, cy, ri, startDeg);
  const lg = sweep > 180 ? 1 : 0;
  return [
    `M${s.x} ${s.y}`,
    `A${r} ${r} 0 ${lg} 1 ${e.x} ${e.y}`,
    `L${si.x} ${si.y}`,
    `A${ri} ${ri} 0 ${lg} 0 ${ei.x} ${ei.y}`,
    'Z',
  ].join(' ');
}

function DonutChart({ data, total }) {
  const cx = 90, cy = 90, r = 78, ri = 52;
  const filtered = data.filter(d => d.spent > 0);
  if (!filtered.length || !total) return null;

  let angle = 0;
  const segments = filtered.map(d => {
    const sweep = (d.spent / total) * 360;
    const seg = { ...d, startAngle: angle, sweep };
    angle += sweep;
    return seg;
  });

  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 180 180" width="180" height="180" style={{ flexShrink: 0 }}>
        {segments.map((s, i) => (
          <path key={i} d={arcPath(cx, cy, r, ri, s.startAngle, s.sweep)}
            fill={s.color || '#6366f1'} />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="var(--text)"
          fontSize="13" fontWeight="700">
          {Math.round(total / 1000)}k
        </text>
        <text x={cx} y={cx + 10} textAnchor="middle" fill="var(--text2)" fontSize="10">Kč celkem</text>
      </svg>
      <div className="donut-legend">
        {filtered.slice(0, 12).map((d, i) => (
          <div key={i} className="donut-legend-item">
            <span className="donut-legend-dot" style={{ background: d.color || '#6366f1' }} />
            <span className="donut-legend-name">{d.name}</span>
            <span className="donut-legend-val">{formatCurrency(d.spent)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Formulář pevných výdajů ──────────────────────────────────────────────────

function FixedExpenseForm({ initial, onSave, onCancel }) {
  const isNew = !initial;
  const [name, setName] = useState(initial?.name || '');
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '');
  const [note, setNote] = useState(initial?.note || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Zadejte název.'); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Zadejte kladnou částku.'); return; }
    setSaving(true); setError('');
    try {
      const method = isNew ? 'POST' : 'PATCH';
      const url = isNew ? '/api/fixed-expenses' : `/api/fixed-expenses/${initial.id}`;
      const body = { name: name.trim(), amount: amt, note: note || null };
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Chyba.'); return; }
      onSave(d);
    } catch { setError('Chyba připojení.'); }
    finally { setSaving(false); }
  }

  return (
    <form className="income-form" onSubmit={handleSubmit}>
      {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="income-form-row">
        <input className="input" placeholder="Název (Nájem, Telefon, Lítačka…)"
          value={name} onChange={e => setName(e.target.value)} autoFocus style={{ flex: 2 }} />
        <input className="input" type="number" min="0" step="1" placeholder="Částka"
          value={amount} onChange={e => setAmount(e.target.value)} style={{ maxWidth: 130 }} />
        <input className="input" placeholder="Poznámka (volitelně)"
          value={note} onChange={e => setNote(e.target.value)} style={{ maxWidth: 180 }} />
        <button type="submit" className="btn btn-primary btn-icon" disabled={saving}><Check size={15} /></button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onCancel}><X size={15} /></button>
      </div>
    </form>
  );
}

// ── Formulář příjmů ───────────────────────────────────────────────────────────

function IncomeForm({ initial, period, usedPersons, onSave, onCancel }) {
  const isNew = !initial;
  const [person, setPerson] = useState(initial?.person || '');
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '');
  const [note, setNote] = useState(initial?.note || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!person.trim()) { setError('Zadejte jméno / zdroj.'); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Zadejte kladnou částku.'); return; }
    setSaving(true); setError('');
    try {
      const method = isNew ? 'POST' : 'PATCH';
      const url = isNew ? '/api/income' : `/api/income/${initial.id}`;
      const body = isNew
        ? { person: person.trim(), amount: amt, period, note }
        : { person: person.trim(), amount: amt, note };
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Chyba.'); return; }
      onSave(d);
    } catch { setError('Chyba připojení.'); }
    finally { setSaving(false); }
  }

  const SUGGESTIONS = ['Tom', 'Martin', 'Sudo'].filter(p => !usedPersons.includes(p) || p === initial?.person);

  return (
    <form className="income-form" onSubmit={handleSubmit}>
      {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="income-form-row">
        <div style={{ flex: 1 }}>
          <input className="input" placeholder="Kdo / zdroj (Tom, Martin, Sudo…)"
            value={person} onChange={e => setPerson(e.target.value)}
            list="income-persons" autoFocus style={{ width: '100%' }} />
          <datalist id="income-persons">
            {SUGGESTIONS.map(s => <option key={s} value={s} />)}
          </datalist>
        </div>
        <input className="input" type="number" min="0" step="1" placeholder="Částka"
          value={amount} onChange={e => setAmount(e.target.value)} style={{ maxWidth: 130 }} />
        <input className="input" placeholder="Poznámka (volitelně)"
          value={note} onChange={e => setNote(e.target.value)} style={{ maxWidth: 180 }} />
        <button type="submit" className="btn btn-primary btn-icon" disabled={saving}><Check size={15} /></button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onCancel}><X size={15} /></button>
      </div>
    </form>
  );
}

// ── Hlavní stránka ────────────────────────────────────────────────────────────

export default function ReportPage() {
  const [period, setPeriod] = useState(null);
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [currentPeriod, setCurrentPeriod] = useState(null);
  const [income, setIncome] = useState([]);
  const [fixedExpenses, setFixedExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);       // Typ 1
  const [stats, setStats] = useState(null);          // total_spent + by_category
  const [loading, setLoading] = useState(true);
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [editIncome, setEditIncome] = useState(null);
  const [showFixedForm, setShowFixedForm] = useState(false);
  const [editFixed, setEditFixed] = useState(null);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(s => {
      setPeriod(s.current_period);
      setCurrentPeriod(s.current_period);
    });
  }, []);

  useEffect(() => {
    if (!period) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/income?period=${period}`).then(r => r.json()),
      fetch('/api/fixed-expenses').then(r => r.json()),
      fetch(`/api/budgets?period=${period}`).then(r => r.json()),
      fetch(`/api/stats/overview?period=${period}`).then(r => r.json()),
    ]).then(([inc, fixed, bud, st]) => {
      setIncome(inc.income || []);
      setFixedExpenses(Array.isArray(fixed) ? fixed : []);
      setBudgets((bud.budgets || []).filter(b => !b.category_type || b.category_type === 1));
      setPeriodStart(bud.period_start);
      setPeriodEnd(bud.period_end);
      setStats(st);
    }).finally(() => setLoading(false));
  }, [period]);

  function handleFixedSaved(row) {
    if (editFixed) {
      setFixedExpenses(prev => prev.map(f => f.id === row.id ? row : f));
      setEditFixed(null);
    } else {
      setFixedExpenses(prev => [...prev, row]);
      setShowFixedForm(false);
    }
  }

  async function handleDeleteFixed(id) {
    if (!confirm('Smazat tento fixní výdaj?')) return;
    const r = await fetch(`/api/fixed-expenses/${id}`, { method: 'DELETE' });
    if (r.ok) setFixedExpenses(prev => prev.filter(f => f.id !== id));
  }

  function handleIncomeSaved(row) {
    if (editIncome) {
      setIncome(prev => prev.map(i => i.id === row.id ? row : i));
      setEditIncome(null);
    } else {
      setIncome(prev => [...prev, row]);
      setShowIncomeForm(false);
    }
  }

  async function handleDeleteIncome(id) {
    if (!confirm('Smazat tento příjem?')) return;
    const r = await fetch(`/api/income/${id}`, { method: 'DELETE' });
    if (r.ok) setIncome(prev => prev.filter(i => i.id !== id));
  }

  // Výdaje dle typu kategorie (z by_category)
  const byCategory = stats?.by_category || [];
  const type2Spent = byCategory.filter(c => c.type === 2 && c.spent > 0);
  const type3Spent = byCategory.filter(c => c.type === 3 && c.spent > 0);
  const chartData  = byCategory.filter(c => c.spent > 0);

  const totalFixed   = fixedExpenses.reduce((s, f) => s + f.amount, 0);
  const totalIncome  = income.reduce((s, i) => s + i.amount, 0);
  const totalType1       = budgets.reduce((s, b) => s + b.spent, 0);
  const totalType1Budget = budgets.reduce((s, b) => s + b.amount, 0);
  const totalType2   = type2Spent.reduce((s, c) => s + c.spent, 0);
  const totalType3   = type3Spent.reduce((s, c) => s + c.spent, 0);
  const totalSpent   = stats?.total_spent || 0;
  const bilance      = totalIncome - totalFixed - totalSpent;
  const usedPersons  = income.map(i => i.person);

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Měsíční schůzka</h1>
        {period && (
          <div className="month-nav">
            <button className="btn btn-ghost btn-icon" onClick={() => setPeriod(p => addPeriods(p, -1))}>
              <ChevronLeft size={18} />
            </button>
            <span className="month-label">{formatPeriod(periodStart, periodEnd)}</span>
            <button className="btn btn-ghost btn-icon"
              onClick={() => setPeriod(p => addPeriods(p, 1))}
              disabled={period >= currentPeriod}>
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      {loading ? <div className="page-loading">Načítání…</div> : (
        <div className="report-layout">

          {/* ── PŘÍJMY ── */}
          <section className="report-section">
            <div className="report-section-header">
              <h2 className="report-section-title">Příjmy</h2>
              {!showIncomeForm && !editIncome && (
                <button className="btn btn-ghost btn-sm" onClick={() => setShowIncomeForm(true)}>
                  <Plus size={14} /> Přidat
                </button>
              )}
            </div>
            {showIncomeForm && !editIncome && (
              <IncomeForm period={period} usedPersons={usedPersons}
                onSave={handleIncomeSaved} onCancel={() => setShowIncomeForm(false)} />
            )}
            {income.length === 0 && !showIncomeForm ? (
              <p className="text-muted" style={{ fontSize: 13 }}>Zatím žádné příjmy pro toto období.</p>
            ) : (
              <div className="report-income-list">
                {income.map(row => (
                  editIncome?.id === row.id ? (
                    <IncomeForm key={row.id} initial={row} period={period} usedPersons={usedPersons}
                      onSave={handleIncomeSaved} onCancel={() => setEditIncome(null)} />
                  ) : (
                    <div key={row.id} className="report-income-row">
                      <span className="report-income-person">{row.person}</span>
                      {row.note && <span className="text-muted" style={{ fontSize: 12 }}>{row.note}</span>}
                      <span className="report-income-amount">{formatCurrency(row.amount)}</span>
                      <button className="btn btn-ghost btn-icon"
                        onClick={() => { setShowIncomeForm(false); setEditIncome(row); }}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn-ghost btn-icon" onClick={() => handleDeleteIncome(row.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )
                ))}
              </div>
            )}
            <div className="report-subtotal">
              <span>Příjmy celkem</span>
              <span>{formatCurrency(totalIncome)}</span>
            </div>
          </section>

          {/* ── PEVNÉ VÝDAJE ── */}
          <section className="report-section">
            <div className="report-section-header">
              <h2 className="report-section-title">Pevné výdaje</h2>
              {!showFixedForm && !editFixed && (
                <button className="btn btn-ghost btn-sm" onClick={() => setShowFixedForm(true)}>
                  <Plus size={14} /> Přidat
                </button>
              )}
            </div>
            {showFixedForm && !editFixed && (
              <FixedExpenseForm
                onSave={handleFixedSaved}
                onCancel={() => setShowFixedForm(false)}
              />
            )}
            {fixedExpenses.length === 0 && !showFixedForm ? (
              <p className="text-muted" style={{ fontSize: 13 }}>Žádné fixní výdaje. Přidejte nájem, telefon, lítačku…</p>
            ) : (
              <div className="report-income-list">
                {fixedExpenses.map(row => (
                  editFixed?.id === row.id ? (
                    <FixedExpenseForm
                      key={row.id}
                      initial={row}
                      onSave={handleFixedSaved}
                      onCancel={() => setEditFixed(null)}
                    />
                  ) : (
                    <div key={row.id} className="report-income-row">
                      <span className="report-income-person">{row.name}</span>
                      {row.note && <span className="text-muted" style={{ fontSize: 12 }}>{row.note}</span>}
                      <span className="report-income-amount">{formatCurrency(row.amount)}</span>
                      <button className="btn btn-ghost btn-icon"
                        onClick={() => { setShowFixedForm(false); setEditFixed(row); }}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn-ghost btn-icon" onClick={() => handleDeleteFixed(row.id)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )
                ))}
              </div>
            )}
            <div className="report-subtotal">
              <span>Pevné výdaje celkem</span>
              <span>{formatCurrency(totalFixed)}</span>
            </div>
          </section>

          {/* ── MĚSÍČNÍ VÝDAJE (Typ 1) ── */}
          <section className="report-section">
            <div className="report-section-header">
              <h2 className="report-section-title">Měsíční výdaje</h2>
            </div>
            {budgets.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>Žádné měsíční rozpočty.</p>
            ) : (
              <div className="report-budget-list">
                {budgets.map(b => {
                  const st = budgetStatus(b.spent, b.amount);
                  return (
                    <div key={b.category_id} className="report-budget-row">
                      <span className="report-budget-dot" style={{ background: b.category_color || '#6366f1' }} />
                      <span className="report-budget-name">{b.category_name}</span>
                      <span className={`report-budget-spent ${STATUS[st].cls}`}>{formatCurrency(b.spent)}</span>
                      <span className="text-muted report-budget-limit">/ {formatCurrency(b.amount)}</span>
                      <span className="report-budget-status">{STATUS[st].icon}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="report-subtotal">
              <span>Měsíční výdaje celkem</span>
              <span>
                {formatCurrency(totalType1)}
                {totalType1Budget > 0 && (
                  <span className="text-muted" style={{ fontWeight: 400 }}> / {formatCurrency(totalType1Budget)}</span>
                )}
              </span>
            </div>
          </section>

          {/* ── ROČNÍ / SEZÓNNÍ (Typ 2) ── */}
          {type2Spent.length > 0 && (
            <section className="report-section">
              <div className="report-section-header">
                <h2 className="report-section-title">Roční / sezónní výdaje</h2>
              </div>
              <div className="report-budget-list">
                {type2Spent.map(c => (
                  <div key={c.id} className="report-budget-row">
                    <span className="report-budget-dot" style={{ background: c.color || '#6366f1' }} />
                    <span className="report-budget-name">{c.name}</span>
                    <span className="report-budget-spent">{formatCurrency(c.spent)}</span>
                    <span className="report-budget-limit" />
                    <span className="report-budget-status" />
                  </div>
                ))}
              </div>
              <div className="report-subtotal">
                <span>Roční výdaje celkem</span>
                <span>{formatCurrency(totalType2)}</span>
              </div>
            </section>
          )}

          {/* ── DRAHÉ VĚCI (Typ 3) ── */}
          {type3Spent.length > 0 && (
            <section className="report-section">
              <div className="report-section-header">
                <h2 className="report-section-title">Drahé věci</h2>
              </div>
              <div className="report-budget-list">
                {type3Spent.map(c => (
                  <div key={c.id} className="report-budget-row">
                    <span className="report-budget-dot" style={{ background: c.color || '#6366f1' }} />
                    <span className="report-budget-name">{c.name}</span>
                    <span className="report-budget-spent">{formatCurrency(c.spent)}</span>
                    <span className="report-budget-limit" />
                    <span className="report-budget-status" />
                  </div>
                ))}
              </div>
              <div className="report-subtotal">
                <span>Drahé věci celkem</span>
                <span>{formatCurrency(totalType3)}</span>
              </div>
            </section>
          )}

          {/* ── GRAF VÝDAJŮ ── */}
          {chartData.length > 0 && (
            <section className="report-section">
              <div className="report-section-header">
                <h2 className="report-section-title">Výdaje dle kategorií</h2>
              </div>
              <DonutChart data={chartData} total={totalSpent} />
            </section>
          )}

          {/* ── BILANCE ── */}
          <section className="report-section report-section--bilance">
            <div className="report-bilance-row">
              <span>Příjmy celkem</span>
              <span>{formatCurrency(totalIncome)}</span>
            </div>
            {totalFixed > 0 && (
              <div className="report-bilance-row">
                <span>Pevné výdaje</span>
                <span>− {formatCurrency(totalFixed)}</span>
              </div>
            )}
            <div className="report-bilance-row">
              <span>Variabilní výdaje</span>
              <span>− {formatCurrency(totalSpent)}</span>
            </div>
            <div className={`report-bilance-row report-bilance-result ${bilance >= 0 ? '' : 'text-danger'}`}>
              <span>Bilance</span>
              <span>{bilance >= 0 ? '+' : '−'} {formatCurrency(Math.abs(bilance))}</span>
            </div>
          </section>

        </div>
      )}
    </Layout>
  );
}
