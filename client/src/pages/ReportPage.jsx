import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import Layout from '../components/Layout';
import { formatCurrency, formatPeriod, addPeriods } from '../i18n';

const STATUS = {
  ok:   { label: '✅', cls: '' },
  warn: { label: '⚠️', cls: 'text-warn' },
  over: { label: '🔴', cls: 'text-danger' },
};

function incomeStatus(spent, budget) {
  if (spent <= budget) return 'ok';
  if (spent <= budget * 1.1) return 'warn';
  return 'over';
}

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
      const body = isNew ? { person: person.trim(), amount: amt, period, note } : { person: person.trim(), amount: amt, note };
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
          <input
            className="input" placeholder="Kdo / zdroj (Tom, Martin, Sudo…)"
            value={person} onChange={e => setPerson(e.target.value)}
            list="income-persons" autoFocus style={{ width: '100%' }}
          />
          <datalist id="income-persons">
            {SUGGESTIONS.map(s => <option key={s} value={s} />)}
          </datalist>
        </div>
        <input
          className="input" type="number" min="0" step="1" placeholder="Částka"
          value={amount} onChange={e => setAmount(e.target.value)}
          style={{ maxWidth: 130 }}
        />
        <input
          className="input" placeholder="Poznámka (volitelně)"
          value={note} onChange={e => setNote(e.target.value)}
          style={{ maxWidth: 180 }}
        />
        <button type="submit" className="btn btn-primary btn-icon" disabled={saving}>
          <Check size={15} />
        </button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onCancel}>
          <X size={15} />
        </button>
      </div>
    </form>
  );
}

export default function ReportPage() {
  const [period, setPeriod] = useState(null);
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [currentPeriod, setCurrentPeriod] = useState(null);
  const [income, setIncome] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [editIncome, setEditIncome] = useState(null);

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
      fetch(`/api/budgets?period=${period}`).then(r => r.json()),
    ]).then(([inc, bud]) => {
      setIncome(inc.income || []);
      setBudgets(bud.budgets || []);
      setPeriodStart(bud.period_start);
      setPeriodEnd(bud.period_end);
    }).finally(() => setLoading(false));
  }, [period]);

  async function handleDeleteIncome(id) {
    if (!confirm('Smazat tento příjem?')) return;
    const r = await fetch(`/api/income/${id}`, { method: 'DELETE' });
    if (r.ok) setIncome(prev => prev.filter(i => i.id !== id));
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

  const totalIncome = income.reduce((s, i) => s + i.amount, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.spent, 0);
  const bilance = totalIncome - totalSpent;
  const usedPersons = income.map(i => i.person);

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
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setPeriod(p => addPeriods(p, 1))}
              disabled={period >= currentPeriod}
            >
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

            {(showIncomeForm && !editIncome) && (
              <IncomeForm
                period={period}
                usedPersons={usedPersons}
                onSave={handleIncomeSaved}
                onCancel={() => setShowIncomeForm(false)}
              />
            )}

            {income.length === 0 && !showIncomeForm ? (
              <p className="text-muted" style={{ fontSize: 13 }}>Zatím žádné příjmy pro toto období.</p>
            ) : (
              <div className="report-income-list">
                {income.map(row => (
                  editIncome?.id === row.id ? (
                    <IncomeForm
                      key={row.id}
                      initial={row}
                      period={period}
                      usedPersons={usedPersons}
                      onSave={handleIncomeSaved}
                      onCancel={() => setEditIncome(null)}
                    />
                  ) : (
                    <div key={row.id} className="report-income-row">
                      <span className="report-income-person">{row.person}</span>
                      {row.note && <span className="text-muted" style={{ fontSize: 12 }}>{row.note}</span>}
                      <span className="report-income-amount">{formatCurrency(row.amount)}</span>
                      <button className="btn btn-ghost btn-icon" onClick={() => { setShowIncomeForm(false); setEditIncome(row); }}>
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

          {/* ── VARIABILNÍ VÝDAJE ── */}
          <section className="report-section">
            <div className="report-section-header">
              <h2 className="report-section-title">Variabilní výdaje</h2>
            </div>
            {budgets.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>Žádné rozpočty pro toto období.</p>
            ) : (
              <div className="report-budget-list">
                {budgets.map(b => {
                  const st = incomeStatus(b.spent, b.amount);
                  return (
                    <div key={b.category_id} className="report-budget-row">
                      <span className="report-budget-dot" style={{ background: b.category_color || '#6366f1' }} />
                      <span className="report-budget-name">{b.category_name}</span>
                      <span className={`report-budget-spent ${STATUS[st].cls}`}>{formatCurrency(b.spent)}</span>
                      <span className="text-muted report-budget-limit">/ {formatCurrency(b.amount)}</span>
                      <span className="report-budget-status">{STATUS[st].label}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="report-subtotal">
              <span>Výdaje celkem</span>
              <span>{formatCurrency(totalSpent)}</span>
            </div>
          </section>

          {/* ── BILANCE ── */}
          <section className="report-section report-section--bilance">
            <div className="report-bilance-row">
              <span>Příjmy celkem</span>
              <span>{formatCurrency(totalIncome)}</span>
            </div>
            <div className="report-bilance-row">
              <span>Výdaje celkem</span>
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
