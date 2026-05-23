import { useState, useEffect } from 'react';
import { usePeriod } from '../contexts/PeriodContext';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import Layout from '../components/Layout';
import { t, formatCurrency, formatPeriod, addPeriods } from '../i18n';

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

// ── Status fixních plateb ─────────────────────────────────────────────────────

const FIXED_STATUS = {
  ok:       { icon: '✅' },
  mismatch: { icon: '⚠️' },
  missing:  { icon: '❌' },
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
  const [matchPattern, setMatchPattern] = useState(initial?.match_pattern || '');
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
      const body = { name: name.trim(), amount: amt, note: note || null, match_pattern: matchPattern.trim() || null };
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
        <input className="input" placeholder="Pattern transakce (volitelně)"
          value={matchPattern} onChange={e => setMatchPattern(e.target.value)} style={{ maxWidth: 180 }} />
        <button type="submit" className="btn btn-primary btn-icon" disabled={saving}><Check size={15} /></button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onCancel}><X size={15} /></button>
      </div>
    </form>
  );
}

// ── Formulář příjmových zdrojů ────────────────────────────────────────────────

function IncomeSourceForm({ initial, onSave, onCancel }) {
  const isNew = !initial || !initial.id;
  const [person, setPerson] = useState(initial?.person || '');
  const [planned, setPlanned] = useState(initial?.planned_amount != null ? String(initial.planned_amount) : '');
  const [matchPattern, setMatchPattern] = useState(initial?.match_pattern || '');
  const [matchCounterparty, setMatchCounterparty] = useState(initial?.match_counterparty_account || '');
  const [accountId, setAccountId] = useState(initial?.account_id != null ? String(initial.account_id) : '');
  const [accounts, setAccounts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/accounts').then(r => r.ok ? r.json() : []).then(setAccounts).catch(() => setAccounts([]));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!person.trim()) { setError('Zadejte jméno / zdroj.'); return; }
    setSaving(true); setError('');
    try {
      const method = isNew ? 'POST' : 'PATCH';
      const url = isNew ? '/api/income' : `/api/income/${initial.id}`;
      const body = {
        person: person.trim(),
        planned_amount: parseFloat(planned) || 0,
        match_pattern: matchPattern.trim() || null,
        match_counterparty_account: matchCounterparty.trim() || null,
        account_id: accountId === '' ? null : parseInt(accountId),
      };
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
        <input className="input" placeholder="Kdo / zdroj (Tom, Martin, Sudo nájem…)"
          value={person} onChange={e => setPerson(e.target.value)} autoFocus style={{ flex: 1 }} />
        <input className="input" type="number" min="0" step="1" placeholder="Plán"
          value={planned} onChange={e => setPlanned(e.target.value)} style={{ maxWidth: 130 }} />
        <input className="input" placeholder="Pattern transakce (volitelně)"
          value={matchPattern} onChange={e => setMatchPattern(e.target.value)} style={{ maxWidth: 200 }} />
        <input className="input" placeholder="Číslo protiúčtu (volitelné)"
          value={matchCounterparty} onChange={e => setMatchCounterparty(e.target.value)}
          title="Přesná shoda – má přednost před textem popisu"
          style={{ maxWidth: 180 }} />
        <select className="input" value={accountId} onChange={e => setAccountId(e.target.value)}
          title="Omezit alias jen na převody do tohoto cílového účtu"
          style={{ maxWidth: 180 }}>
          <option value="">— libovolný účet —</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary btn-icon" disabled={saving}><Check size={15} /></button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onCancel}><X size={15} /></button>
      </div>
    </form>
  );
}

// ── Hlavní stránka ────────────────────────────────────────────────────────────

export default function ReportPage() {
  const { period, setPeriod, currentPeriod, resetToCurrent } = usePeriod();
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [incomeSources, setIncomeSources] = useState([]);
  const [fixedExpenses, setFixedExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);       // Typ 1
  const [budgetItems, setBudgetItems] = useState([]); // Typ 2 podpoložky
  const [funds, setFunds] = useState([]);             // Typ 3 fond-status
  const [stats, setStats] = useState(null);          // total_spent + by_category
  const [loading, setLoading] = useState(true);
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [editIncome, setEditIncome] = useState(null);
  const [prefillIncome, setPrefillIncome] = useState(null); // pre-fill „Přidat" z auto-only řádku
  const [unaliasedExpanded, setUnaliasedExpanded] = useState(false);
  const [showFixedForm, setShowFixedForm] = useState(false);
  const [editFixed, setEditFixed] = useState(null);

  useEffect(() => {
    if (!period) return;
    setLoading(true);
    const year = Number(period.split('-')[0]);
    Promise.all([
      fetch(`/api/income?period=${period}`).then(r => r.json()),
      fetch(`/api/fixed-expenses?period=${period}`).then(r => r.json()),
      fetch(`/api/budgets?period=${period}`).then(r => r.json()),
      fetch(`/api/stats/overview?period=${period}`).then(r => r.json()),
      fetch(`/api/budget-items?year=${year}`).then(r => r.json()),
      fetch(`/api/categories/fund-status?year=${year}`).then(r => r.json()),
    ]).then(([inc, fixed, bud, st, items, fundStatus]) => {
      setIncomeSources(inc.sources || []);
      setFixedExpenses(Array.isArray(fixed) ? fixed : []);
      setBudgets((bud.budgets || []).filter(b => !b.category_type || b.category_type === 1));
      setPeriodStart(bud.period_start);
      setPeriodEnd(bud.period_end);
      setStats(st);
      setBudgetItems(items.items || []);
      setFunds(Array.isArray(fundStatus) ? fundStatus : []);
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
      setIncomeSources(prev => prev.map(i => i.id === row.id ? { ...i, ...row } : i));
      setEditIncome(null);
    } else {
      setIncomeSources(prev => [...prev, { ...row, actual: 0, tx_count: 0, status: null }]);
      setShowIncomeForm(false);
    }
  }

  async function handleDeleteIncome(id) {
    if (!confirm('Smazat tento příjmový zdroj?')) return;
    const r = await fetch(`/api/income/${id}`, { method: 'DELETE' });
    if (r.ok) setIncomeSources(prev => prev.filter(i => i.id !== id));
  }

  // Výdaje dle typu kategorie (z by_category)
  const byCategory = stats?.by_category || [];
  // Roční plán po kategoriích: součet podpoložek dané kategorie / 12 = měsíční budget
  const type2BudgetByCat = {};
  budgetItems.forEach(i => { type2BudgetByCat[i.category_id] = (type2BudgetByCat[i.category_id] || 0) + (i.amount || 0); });
  const type2Cats  = byCategory.filter(c => c.type === 2 && (c.spent > 0 || (type2BudgetByCat[c.id] || 0) > 0));
  const type2Spent = byCategory.filter(c => c.type === 2 && c.spent > 0);
  const type3Spent = byCategory.filter(c => c.type === 3 && c.spent > 0);
  const chartData  = byCategory.filter(c => c.spent > 0);

  const totalFixed   = fixedExpenses.reduce((s, f) => s + f.amount, 0);
  // Striktní whitelist: do bilance i sekce Příjmy vstupují jen ručně aliasované zdroje
  const aliasedSources   = incomeSources.filter(s => s.id != null);
  const unaliasedSources = incomeSources.filter(s => s.id == null);
  const totalIncome      = aliasedSources.reduce((s, i) => s + (i.actual || 0), 0);
  const unaliasedTotal   = unaliasedSources.reduce((s, i) => s + (i.actual || 0), 0);
  const totalType1       = budgets.reduce((s, b) => s + b.spent, 0);
  const totalType1Budget = budgets.reduce((s, b) => s + b.amount, 0);
  const totalType2   = type2Spent.reduce((s, c) => s + c.spent, 0);
  const totalType3   = type3Spent.reduce((s, c) => s + c.spent, 0);
  // Očekávaný měsíční budget: roční plán /12, fond = součet měsíčních příspěvků
  const type2MonthlyBudget = Math.round(budgetItems.reduce((s, i) => s + (i.amount || 0), 0) / 12);
  const type3MonthlyBudget = funds.reduce((s, f) => s + (f.monthly_contribution || 0), 0);
  const totalSpent   = stats?.total_spent || 0;
  const savings      = stats?.savings || { net: 0 };

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
            <button
              className="btn btn-ghost"
              onClick={resetToCurrent}
              disabled={period === currentPeriod}
              title={t.period.resetToCurrent}
            >
              {t.period.resetToCurrent}
            </button>
          </div>
        )}
      </div>

      {loading ? <div className="page-loading">Načítání…</div> : (
        <div className="report-layout">

          {/* ── BILANCE (Skutečně naspořeno) – první na stránce ── */}
          <section className="report-section report-section--bilance">
            <div className="report-bilance-row">
              <span>Příjmy celkem</span>
              <span>{formatCurrency(totalIncome)}</span>
            </div>
            {totalFixed > 0 && (
              <div className="report-bilance-row">
                <span>Fixní platby</span>
                <span>− {formatCurrency(totalFixed)}</span>
              </div>
            )}
            <div className="report-bilance-row">
              <span>Měsíční výdaje</span>
              <span>
                − {formatCurrency(totalType1)}
                {totalType1Budget > 0 && (
                  <span className="text-muted" style={{ fontWeight: 400 }}> / {formatCurrency(totalType1Budget)}</span>
                )}
              </span>
            </div>
            {(totalType2 > 0 || type2MonthlyBudget > 0) && (
              <div className="report-bilance-row">
                <span>Roční výdaje</span>
                <span>
                  − {formatCurrency(totalType2)}
                  {type2MonthlyBudget > 0 && (
                    <span className="text-muted" style={{ fontWeight: 400 }}> / {formatCurrency(type2MonthlyBudget)}</span>
                  )}
                </span>
              </div>
            )}
            {(totalType3 > 0 || type3MonthlyBudget > 0) && (
              <div className="report-bilance-row">
                <span>Drahé věci</span>
                <span>
                  − {formatCurrency(totalType3)}
                  {type3MonthlyBudget > 0 && (
                    <span className="text-muted" style={{ fontWeight: 400 }}> / {formatCurrency(type3MonthlyBudget)}</span>
                  )}
                </span>
              </div>
            )}
            <div className={`report-bilance-row report-bilance-result ${savings.net >= 0 ? '' : 'text-danger'}`}>
              <span>Skutečně naspořeno</span>
              <span>{savings.net >= 0 ? '+' : '−'} {formatCurrency(Math.abs(savings.net))}</span>
            </div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Výsledek je měřené netto převodů, ne aritmetický rozdíl rozpadu výše.
            </div>
          </section>

          {/* ── PŘÍJMY ── */}
          <section className="report-section">
            <div className="report-section-header">
              <h2 className="report-section-title">Příjmy</h2>
              {!showIncomeForm && !editIncome && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setPrefillIncome(null); setShowIncomeForm(true); }}>
                  <Plus size={14} /> Přidat
                </button>
              )}
            </div>
            {showIncomeForm && !editIncome && (
              <IncomeSourceForm initial={prefillIncome}
                onSave={handleIncomeSaved}
                onCancel={() => { setShowIncomeForm(false); setPrefillIncome(null); }} />
            )}
            {aliasedSources.length === 0 && !showIncomeForm ? (
              <p className="text-muted" style={{ fontSize: 13 }}>
                Žádné příjmové zdroje. Přidejte Tom / Martin / Sudo nájem.
              </p>
            ) : (
              <div className="report-income-list">
                {aliasedSources.map(row => {
                  const rowKey = `id-${row.id}`;
                  if (editIncome?.id === row.id) {
                    return (
                      <IncomeSourceForm key={rowKey} initial={row}
                        onSave={handleIncomeSaved} onCancel={() => setEditIncome(null)} />
                    );
                  }
                  const searchKey = row.match_counterparty_account || row.match_pattern || row.person;
                  const to = `/transactions?q=${encodeURIComponent(searchKey)}`
                    + (periodStart && periodEnd ? `&from=${periodStart}&to=${periodEnd}` : '');
                  return (
                    <Link key={rowKey} to={to} className="report-income-row"
                      style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
                      {row.status && <span title={row.status}>{FIXED_STATUS[row.status].icon}</span>}
                      <span className="report-income-person">{row.person}</span>
                      {row.status === 'mismatch' && (
                        <span className="text-muted" style={{ fontSize: 12 }}>
                          o {formatCurrency(Math.max(0, row.planned_amount - row.actual))} méně, než plán
                          {row.tx_count > 1 ? ` · ${row.tx_count} platby` : ''}
                        </span>
                      )}
                      {row.status === 'missing' && (
                        <span className="text-muted" style={{ fontSize: 12 }}>nepřišlo</span>
                      )}
                      <span className="report-income-amount">{formatCurrency(row.actual || 0)}</span>
                      <button className="btn btn-ghost btn-icon"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowIncomeForm(false); setEditIncome(row); }}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn-ghost btn-icon"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteIncome(row.id); }}>
                        <Trash2 size={13} />
                      </button>
                    </Link>
                  );
                })}
              </div>
            )}
            {aliasedSources.some(i => i.status) && (() => {
              const c = k => aliasedSources.filter(i => i.status === k).length;
              return (
                <div style={{ display: 'flex', gap: 16, fontSize: 13, marginTop: 4 }}>
                  {c('ok') > 0 && <span>✅ {c('ok')} přišlo</span>}
                  {c('mismatch') > 0 && <span>⚠️ {c('mismatch')} nižší částka</span>}
                  {c('missing') > 0 && <span>❌ {c('missing')} nepřišlo</span>}
                </div>
              );
            })()}

            {unaliasedSources.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => setUnaliasedExpanded(e => !e)}
                  style={{ fontSize: 12, padding: '4px 8px' }}
                  title="Auto-detekované příchozí platby, které nejsou přiřazené k žádnému ručnímu zdroji. Nepočítají se do Příjmy celkem.">
                  Detekováno {unaliasedSources.length} dalších plateb v součtu {formatCurrency(unaliasedTotal)} {unaliasedExpanded ? '▲' : '▼'}
                </button>
                {unaliasedExpanded && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 8 }}>
                    {unaliasedSources.map((row, i) => {
                      const autoKey = row.match_counterparty_account || row.person || `idx-${i}`;
                      const to = `/transactions?q=${encodeURIComponent(autoKey)}`
                        + (periodStart && periodEnd ? `&from=${periodStart}&to=${periodEnd}` : '');
                      return (
                        <Link key={`auto-${autoKey}`} to={to}
                          className="report-income-row text-muted"
                          style={{ fontSize: 12, textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
                          <span className="report-income-person">{row.person}</span>
                          {row.tx_count > 1 && (
                            <span style={{ fontSize: 11 }}>· {row.tx_count} plateb</span>
                          )}
                          <span className="report-income-amount">{formatCurrency(row.actual)}</span>
                          <button className="btn btn-ghost btn-sm"
                            title="Přidat jako trvalý příjem (pojmenovat a započítat)"
                            onClick={(e) => {
                              e.preventDefault(); e.stopPropagation();
                              setPrefillIncome({
                                person: '',
                                planned_amount: 0,
                                match_pattern: null,
                                match_counterparty_account: row.match_counterparty_account || '',
                              });
                              setEditIncome(null);
                              setShowIncomeForm(true);
                            }}>
                            <Plus size={12} /> Přidat
                          </button>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div className="report-subtotal">
              <span>Příjmy celkem</span>
              <span>{formatCurrency(totalIncome)}</span>
            </div>
          </section>

          {/* ── FIXNÍ PLATBY ── */}
          <section className="report-section">
            <div className="report-section-header">
              <h2 className="report-section-title">Fixní platby</h2>
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
                      {row.status && <span title={row.status}>{FIXED_STATUS[row.status].icon}</span>}
                      <span className="report-income-person">{row.name}</span>
                      {row.note && <span className="text-muted" style={{ fontSize: 12 }}>{row.note}</span>}
                      {row.status === 'mismatch' && (
                        <span className="text-muted" style={{ fontSize: 12 }}>
                          {row.actual > row.amount ? '+' : '−'}{formatCurrency(Math.abs(row.actual - row.amount))} oproti plánu
                          {row.tx_count > 1 ? ` · ${row.tx_count} platby` : ''}
                        </span>
                      )}
                      {row.status === 'missing' && (
                        <span className="text-muted" style={{ fontSize: 12 }}>chybí</span>
                      )}
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
            {fixedExpenses.some(f => f.status) && (() => {
              const s = k => fixedExpenses.filter(f => f.status === k).length;
              return (
                <div style={{ display: 'flex', gap: 16, fontSize: 13, marginTop: 4 }}>
                  {s('ok') > 0 && <span>✅ {s('ok')} proběhly</span>}
                  {s('mismatch') > 0 && <span>⚠️ {s('mismatch')} jiná částka</span>}
                  {s('missing') > 0 && <span>❌ {s('missing')} chybí</span>}
                </div>
              );
            })()}
            <div className="report-subtotal">
              <span>Fixní platby celkem</span>
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
              <>
                <div className="report-budget-row" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 4 }}>
                  <span className="report-budget-dot" style={{ background: 'transparent' }} />
                  <span className="report-budget-name">Kategorie</span>
                  <span className="report-budget-spent">Utraceno</span>
                  <span className="report-budget-limit">Rozpočet</span>
                  <span className="report-budget-status">Stav</span>
                </div>
              <div className="report-budget-list">
                {budgets.map(b => {
                  const st = budgetStatus(b.spent, b.amount);
                  const inner = (
                    <>
                      <span className="report-budget-dot" style={{ background: b.category_color || '#6366f1' }} />
                      <span className="report-budget-name">{b.category_name}</span>
                      <span className={`report-budget-spent ${STATUS[st].cls}`}>{formatCurrency(b.spent)}</span>
                      <span className="text-muted report-budget-limit">/ {formatCurrency(b.amount)}</span>
                      <span className="report-budget-status">{STATUS[st].icon}</span>
                    </>
                  );
                  if (b.category_id == null) {
                    return (
                      <div key="report-budget-no-category" className="report-budget-row">{inner}</div>
                    );
                  }
                  const to = `/transactions?category_id=${b.category_id}` + (period ? `&period=${period}` : '');
                  return (
                    <Link
                      key={b.category_id}
                      to={to}
                      className="report-budget-row"
                      style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                    >
                      {inner}
                    </Link>
                  );
                })}
              </div>
              </>
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
            {budgets.length > 0 && (() => {
              const ok   = budgets.filter(b => budgetStatus(b.spent, b.amount) === 'ok').length;
              const warn = budgets.filter(b => budgetStatus(b.spent, b.amount) === 'warn').length;
              const over = budgets.filter(b => budgetStatus(b.spent, b.amount) === 'over').length;
              return (
                <div style={{ display: 'flex', gap: 16, fontSize: 13, marginTop: 4 }}>
                  {ok   > 0 && <span>✅ {ok} splněno</span>}
                  {warn > 0 && <span>⚠️ {warn} mírně přes</span>}
                  {over > 0 && <span>🔴 {over} překročeno</span>}
                </div>
              );
            })()}
          </section>

          {/* ── ROČNÍ / SEZÓNNÍ (Typ 2) ── */}
          {type2Cats.length > 0 && (
            <section className="report-section">
              <div className="report-section-header">
                <h2 className="report-section-title">Roční / sezónní výdaje</h2>
              </div>
              <div className="report-budget-row" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 4 }}>
                <span className="report-budget-dot" style={{ background: 'transparent' }} />
                <span className="report-budget-name">Kategorie</span>
                <span className="report-budget-spent">Utraceno</span>
                <span className="report-budget-limit" style={{ whiteSpace: 'nowrap' }}>Indikativní rozpočet</span>
                <span className="report-budget-status" />
              </div>
              <div className="report-budget-list">
                {type2Cats.map(c => {
                  const monthly = Math.round((type2BudgetByCat[c.id] || 0) / 12);
                  const to = `/transactions?category_id=${c.id}` + (period ? `&period=${period}` : '');
                  return (
                    <Link key={c.id} to={to} className="report-budget-row"
                      style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
                      <span className="report-budget-dot" style={{ background: c.color || '#6366f1' }} />
                      <span className="report-budget-name">{c.name}</span>
                      <span className="report-budget-spent">{formatCurrency(c.spent)}</span>
                      <span className="text-muted report-budget-limit">{monthly > 0 ? `/ ${formatCurrency(monthly)}` : ''}</span>
                      <span className="report-budget-status" />
                    </Link>
                  );
                })}
              </div>
              <div className="report-subtotal">
                <span>Roční výdaje celkem</span>
                <span>
                  {formatCurrency(totalType2)}
                  {type2MonthlyBudget > 0 && (
                    <span className="text-muted" style={{ fontWeight: 400 }}> / {formatCurrency(type2MonthlyBudget)}</span>
                  )}
                </span>
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
                  <Link key={c.id} to={`/transactions?category_id=${c.id}` + (period ? `&period=${period}` : '')}
                    className="report-budget-row"
                    style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
                    <span className="report-budget-dot" style={{ background: c.color || '#6366f1' }} />
                    <span className="report-budget-name">{c.name}</span>
                    <span className="report-budget-spent">{formatCurrency(c.spent)}</span>
                    <span className="report-budget-limit" />
                    <span className="report-budget-status" />
                  </Link>
                ))}
              </div>
              <div className="report-subtotal">
                <span>Drahé věci celkem</span>
                <span>
                  {formatCurrency(totalType3)}
                  {type3MonthlyBudget > 0 && (
                    <span className="text-muted" style={{ fontWeight: 400 }}> / {formatCurrency(type3MonthlyBudget)}</span>
                  )}
                </span>
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

        </div>
      )}
    </Layout>
  );
}
