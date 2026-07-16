import { useState, useEffect } from 'react';
import { usePeriod } from '../contexts/PeriodContext';
import { usePeriodKeys } from '../hooks/usePeriodKeys';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import Layout from '../components/Layout';
import { t, formatCurrency, formatPeriod, addPeriods } from '../i18n';
import { fixedActualTotal, surplusToSavings } from '../utils/meetingBalance';

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

  const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 4, display: 'block' };
  const hintStyle = { fontSize: 11, color: 'var(--text2)', marginTop: 4, display: 'block', lineHeight: 1.4 };

  return (
    <form className="card income-form" onSubmit={handleSubmit} style={{ maxWidth: 560 }}>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>Kdo / zdroj</label>
          <input className="input" value={person} onChange={e => setPerson(e.target.value)} autoFocus
            placeholder="Tom, Martin, Sudo nájem…" />
          <span style={hintStyle}>
            Jméno osoby nebo název zdroje. Zobrazí se jako řádek v sekci Příjmy na Schůzce.
          </span>
        </div>

        <div>
          <label style={labelStyle}>Plánovaná částka (Kč / měsíc)</label>
          <input className="input" type="number" min="0" step="1"
            value={planned} onChange={e => setPlanned(e.target.value)}
            placeholder="162000" style={{ maxWidth: 180 }} />
          <span style={hintStyle}>
            Očekávaný měsíční příjem. Když skutečnost neodpovídá, řádek dostane status
            ✅ (dorazilo), ⚠️ (nižší než plán) nebo ❌ (nepřišlo). Nech 0, pokud nechceš porovnání plánu.
          </span>
        </div>

        <div>
          <label style={labelStyle}>Pattern v popisu transakce (volitelné)</label>
          <input className="input" value={matchPattern} onChange={e => setMatchPattern(e.target.value)}
            placeholder="např. Bísek" />
          <span style={hintStyle}>
            Hledá tento podřetězec v <strong>popisu</strong> příchozí transakce. Použij, když nemáš
            číslo protiúčtu (např. Martinova výplata má v popisu „Bísek Libor"). Velikost písmen
            i diakritika musí přesně sedět.
          </span>
        </div>

        <div>
          <label style={labelStyle}>Číslo protiúčtu (volitelné)</label>
          <input className="input" value={matchCounterparty} onChange={e => setMatchCounterparty(e.target.value)}
            placeholder="např. 1679014031" style={{ maxWidth: 220 }} />
          <span style={hintStyle}>
            Přesná shoda na číslo účtu odesílatele. <strong>Má přednost před patternem v popisu.</strong>
            Spolehlivější, protože popis banka může měnit, číslo účtu ne.
          </span>
        </div>

        <div>
          <label style={labelStyle}>Cílový účet (volitelné)</label>
          <select className="input" value={accountId} onChange={e => setAccountId(e.target.value)}
            style={{ maxWidth: 280 }}>
            <option value="">— libovolný účet —</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <span style={hintStyle}>
            Omezí alias jen na převody, které <strong>dorazily na tento konkrétní účet</strong>.
            Užitečné, když ti odesílatel posílá na víc tvých účtů a chceš započítat jen jeden
            (např. OSVČ → Hlavní jako příjem, OSVČ → Spořicí ignorovat).
            „— libovolný účet —" znamená matchnout libovolnou destinaci.
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          <Check size={14} /> {saving ? 'Ukládám…' : 'Uložit'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          <X size={14} /> Zrušit
        </button>
      </div>
    </form>
  );
}

// ── Hlavní stránka ────────────────────────────────────────────────────────────

export default function ReportPage() {
  const { period, setPeriod, currentPeriod, resetToCurrent } = usePeriod();
  usePeriodKeys();
  const [periodStart, setPeriodStart] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [incomeSources, setIncomeSources] = useState([]);
  const [fixedExpenses, setFixedExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);       // Typ 1
  const [funds, setFunds] = useState([]);             // Typ 3 fond-status
  const [stats, setStats] = useState(null);          // total_spent + by_category
  const [loading, setLoading] = useState(true);
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [editIncome, setEditIncome] = useState(null);
  const [prefillIncome, setPrefillIncome] = useState(null); // pre-fill „Přidat" z ručního formuláře
  const [expandedSubcats, setExpandedSubcats] = useState({}); // per-kategorie rozklik subkategorií

  useEffect(() => {
    if (!period) return;
    setLoading(true);
    const year = Number(period.split('-')[0]);
    Promise.all([
      fetch(`/api/income?period=${period}`).then(r => r.json()),
      fetch(`/api/fixed-expenses?period=${period}`).then(r => r.json()),
      fetch(`/api/budgets?period=${period}`).then(r => r.json()),
      fetch(`/api/stats/overview?period=${period}`).then(r => r.json()),
      fetch(`/api/categories/fund-status?year=${year}`).then(r => r.json()),
    ]).then(([inc, fixed, bud, st, fundStatus]) => {
      setIncomeSources(inc.sources || []);
      setFixedExpenses(Array.isArray(fixed) ? fixed : []);
      setBudgets((bud.budgets || []).filter(b => !b.category_type || b.category_type === 1));
      setPeriodStart(bud.period_start);
      setPeriodEnd(bud.period_end);
      setStats(st);
      setFunds(Array.isArray(fundStatus) ? fundStatus : []);
    }).finally(() => setLoading(false));
  }, [period]);

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
  const bySubcategory = stats?.by_subcategory || [];
  const accounting = stats?.accounting || [];
  const type3Spent = byCategory.filter(c => c.type === 3 && c.spent > 0);
  const expensiveItems = stats?.expensive_items || [];

  function toggleSubcatExpand(categoryId) {
    setExpandedSubcats(prev => ({ ...prev, [categoryId]: !prev[categoryId] }));
  }

  const totalFixed   = fixedActualTotal(fixedExpenses);
  // Striktní whitelist: do bilance i sekce Příjmy vstupují jen ručně aliasované zdroje
  const aliasedSources   = incomeSources.filter(s => s.id != null);
  const totalIncome      = aliasedSources.reduce((s, i) => s + (i.actual || 0), 0);
  const totalPlanned = aliasedSources.reduce((s, i) => s + (i.planned_amount || 0), 0);
  const totalDiff    = Math.round(totalIncome - totalPlanned);
  const totalType1       = budgets.reduce((s, b) => s + b.spent, 0);
  const totalType1Budget = budgets.reduce((s, b) => s + b.amount, 0);
  const totalType3   = type3Spent.reduce((s, c) => s + c.spent, 0);
  // Očekávaný měsíční příspěvek do fondů (Typ 3)
  const type3MonthlyBudget = funds.reduce((s, f) => s + (f.monthly_contribution || 0), 0);
  const variablePoolFunded = stats?.variable_pool_funded || 0;
  // „Na spořicí" = přebytek za období (příjmy − všechny výdaje). Skutečné pohyby
  // na spořicím účtu Schůzka nezobrazuje — jsou v Transakcích.
  const surplus = surplusToSavings({
    totalIncome,
    totalFixed,
    variablePoolFunded,
    totalType1,
    totalType3,
  });

  // Account numbers used in bilance row links (musí sedět s recurring.js v backendu)
  const VARIABLE_ACCOUNT_NUM = '1679014074';
  const typ1CatIds = byCategory.filter(c => c.type === 1).map(c => c.id).join(',');
  const typ3CatIds = byCategory.filter(c => c.type === 3).map(c => c.id).join(',');
  function txLink(extra) {
    // Posíláme `period=YYYY-MM`, ne `from/to`, aby Transakce zachovaly měsíční
    // přepínač (z URL from/to by se odvodil customMode = dva date inputs).
    const base = period ? `period=${period}` : '';
    return `/transactions?${base}${extra ? '&' + extra : ''}`;
  }

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

          {/* ── BILANCE (Zbylo na běžném) – první na stránce ── */}
          <section className="report-section report-section--bilance">
            <Link to={txLink('direction=in')} className="report-bilance-row"
              style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
              title="Klik: všechny příchozí transakce v období">
              <span>Příjmy celkem</span>
              <span>{formatCurrency(totalIncome)}</span>
            </Link>
            {totalFixed > 0 && (() => {
              const patterns = fixedExpenses.map(f => f.match_pattern).filter(Boolean);
              const linkExtra = patterns.length
                ? `match_patterns=${encodeURIComponent(patterns.join(','))}&direction=out&spending_only=1`
                : 'direction=out&spending_only=1';
              return (
                <Link to={txLink(linkExtra)} className="report-bilance-row"
                  style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                  title="Klik: 5 fixních plateb (Nájem, PRE, RAV4, T-Mobile, Nordic Telecom) v období">
                  <span>Fixní platby</span>
                  <span>− {formatCurrency(totalFixed)}</span>
                </Link>
              );
            })()}
            {variablePoolFunded > 0 && (
              <Link to={txLink(`counterparty=${VARIABLE_ACCOUNT_NUM}&direction=out`)}
                className="report-bilance-row"
                style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                title="Součet plateb z Hlavního účtu na Nepravidelné v období. Pool, ze kterého se platí roční výdaje.">
                <span>Dotace na nepravidelné</span>
                <span>− {formatCurrency(variablePoolFunded)}</span>
              </Link>
            )}
            <Link to={txLink(typ1CatIds ? `category_ids=${typ1CatIds}&spending_only=1` : 'spending_only=1')}
              className="report-bilance-row"
              style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
              title="Klik: transakce Typ 1 (měsíční) kategorií v období, jen z výdajových účtů">
              <span>Měsíční výdaje</span>
              <span>
                − {formatCurrency(totalType1)}
                {totalType1Budget > 0 && (
                  <span className="text-muted" style={{ fontWeight: 400 }}> / {formatCurrency(totalType1Budget)}</span>
                )}
              </span>
            </Link>
            {(totalType3 > 0 || type3MonthlyBudget > 0) && (
              <Link to={txLink(typ3CatIds ? `category_ids=${typ3CatIds}&spending_only=1` : 'spending_only=1')}
                className="report-bilance-row"
                style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                title="Klik: transakce Typ 3 (drahé věci / fondy) v období, jen z výdajových účtů">
                <span>Drahé věci</span>
                <span>
                  − {formatCurrency(totalType3)}
                  {type3MonthlyBudget > 0 && (
                    <span className="text-muted" style={{ fontWeight: 400 }}> / {formatCurrency(type3MonthlyBudget)}</span>
                  )}
                </span>
              </Link>
            )}
            <div className={`report-bilance-row report-bilance-result ${surplus >= 0 ? '' : 'text-danger'}`}>
              <span>Na spořicí</span>
              <span>{surplus >= 0 ? '+' : '−'} {formatCurrency(Math.abs(surplus))}</span>
            </div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              „Na spořicí" = přebytek za období (příjmy minus výdaje). Skutečné pohyby na spořicím účtu najdeš v Transakcích.
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
                    + (period ? `&period=${period}` : '');
                  return (
                    <Link key={rowKey} to={to} className="report-income-row"
                      style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
                      {row.status && <span title={row.status}>{FIXED_STATUS[row.status].icon}</span>}
                      <span className="report-income-person">{row.person}</span>
                      {row.status === 'ok' && row.planned_amount > 0 && Math.round(row.actual - row.planned_amount) !== 0 && (
                        <span
                          className={row.actual - row.planned_amount > 0 ? 'text-success' : 'text-danger'}
                          style={{ fontSize: 12 }}
                        >
                          {row.actual - row.planned_amount > 0 ? '+' : '−'}
                          {formatCurrency(Math.abs(Math.round(row.actual - row.planned_amount)))}
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
            <div className="report-subtotal">
              <span>Příjmy celkem</span>
              <span>
                {formatCurrency(totalIncome)}
                {totalDiff !== 0 && (
                  <span className={totalDiff > 0 ? 'text-success' : 'text-danger'} style={{ marginLeft: 8, fontSize: 12 }}>
                    ({totalDiff > 0 ? '+' : '−'}{formatCurrency(Math.abs(totalDiff))})
                  </span>
                )}
              </span>
            </div>
          </section>

          {/* ── FIXNÍ PLATBY ── */}
          <section className="report-section">
            <div className="report-section-header">
              <h2 className="report-section-title">Fixní platby</h2>
            </div>
            <Link to="/fixed-expenses" className="text-muted" style={{ fontSize: 12, display: 'inline-block', marginBottom: 8 }}>
              Spravovat fixní platby →
            </Link>
            {fixedExpenses.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>Žádné fixní výdaje.</p>
            ) : (
              <div className="report-income-list">
                {fixedExpenses.map(row => (
                  <div key={row.id ?? `${row.account_id}-${row.name}`} className="report-income-row">
                    {row.status && <span title={row.status}>{FIXED_STATUS[row.status].icon}</span>}
                    <span className="report-income-person">{row.name}</span>
                    {row.note && <span className="text-muted" style={{ fontSize: 12 }}>{row.note}</span>}
                    {row.status === 'mismatch' && row.amount_min != null && (
                      <span className="text-muted" style={{ fontSize: 12 }}>
                        {`${formatCurrency(row.actual)} (čekáno ${row.amount_min}–${row.amount_max} Kč)`}
                        {row.tx_count > 1 ? ` · ${row.tx_count} platby` : ''}
                      </span>
                    )}
                    {row.status === 'missing' && (
                      <span className="text-muted" style={{ fontSize: 12 }}>chybí</span>
                    )}
                    <span className="report-income-amount">
                      {formatCurrency(row.tx_count > 0 ? (row.actual ?? row.amount) : row.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
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
                  <span className="report-budget-over">Přes</span>
                  <span className="report-budget-status">Stav</span>
                </div>
              <div className="report-budget-list">
                {budgets.map(b => {
                  const st = budgetStatus(b.spent, b.amount);
                  const subcats = b.category_id != null
                    ? bySubcategory.filter(s => s.category_id === b.category_id)
                    : [];
                  const hasSubcats = subcats.length > 0;
                  const isExpanded = hasSubcats && !!expandedSubcats[b.category_id];
                  const inner = (
                    <>
                      <span className="report-budget-dot" style={{ background: b.category_color || '#6366f1' }} />
                      <span className="report-budget-name">
                        {hasSubcats && (
                          <button
                            type="button"
                            className="report-subcat-toggle"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSubcatExpand(b.category_id); }}
                            title={isExpanded ? 'Skrýt rozpad subkategorií' : 'Zobrazit rozpad subkategorií'}
                          >
                            {isExpanded ? '▾' : '▸'}
                          </button>
                        )}
                        {b.category_name}
                      </span>
                      <span className={`report-budget-spent ${STATUS[st].cls}`}>{formatCurrency(b.spent)}</span>
                      <span className="text-muted report-budget-limit">/ {formatCurrency(b.amount)}</span>
                      <span className="report-budget-over text-danger">{b.spent > b.amount ? `+${formatCurrency(b.spent - b.amount)}` : ''}</span>
                      <span className="report-budget-status">{STATUS[st].icon}</span>
                    </>
                  );
                  const row = b.category_id == null
                    ? <div key="report-budget-no-category" className="report-budget-row">{inner}</div>
                    : (
                      <Link
                        key={b.category_id}
                        to={`/transactions?category_id=${b.category_id}` + (period ? `&period=${period}` : '')}
                        className="report-budget-row"
                        style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                      >
                        {inner}
                      </Link>
                    );
                  return (
                    <div key={`wrap-${b.category_id ?? 'no-category'}`}>
                      {row}
                      {isExpanded && (
                        <div className="report-subcat-list">
                          {subcats.map(s => (
                            <Link
                              key={s.subcategory_id}
                              to={`/transactions?category_id=${s.category_id}&subcategory_id=${s.subcategory_id}` + (period ? `&period=${period}` : '')}
                              className="report-subcat-row"
                              style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                            >
                              <span className="report-subcat-name">{s.name}</span>
                              <span className="report-subcat-spent">{formatCurrency(s.spent)}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
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
              const diff = budgets.reduce((s, b) => s + (b.spent - b.amount), 0);
              return (
                <div style={{ display: 'flex', gap: 16, fontSize: 13, marginTop: 4, flexWrap: 'wrap' }}>
                  {ok   > 0 && <span>✅ {ok} splněno</span>}
                  {warn > 0 && <span>⚠️ {warn} mírně přes</span>}
                  {over > 0 && <span>🔴 {over} překročeno</span>}
                  {diff !== 0 && (
                    <span className={diff > 0 ? 'text-danger' : 'text-success'}>
                      rozdíl oproti plánu {diff > 0 ? '+' : '−'}{formatCurrency(Math.abs(diff))}
                    </span>
                  )}
                </div>
              );
            })()}
          </section>

          {/* ── ÚČETNÍ (Typ 4) ── */}
          {accounting.length > 0 && (
            <section className="report-section">
              <div className="report-section-header">
                <h2 className="report-section-title">Účetní</h2>
              </div>
              <div className="report-budget-list">
                {accounting.map(a => {
                  const balanced = Math.round(a.saldo) === 0;
                  return (
                    <Link
                      key={a.id}
                      to={`/transactions?category_id=${a.id}` + (period ? `&period=${period}` : '')}
                      className="report-bilance-row"
                      style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
                    >
                      <span>
                        <span className="budget-dot" style={{ background: a.color || '#6366f1' }} />
                        {a.name}
                      </span>
                      <span
                        className={balanced ? '' : 'text-danger'}
                        title={balanced ? 'Vyrovnané saldo' : 'Nenulové saldo — zkontroluj chybějící nohu převodu'}
                      >
                        {formatCurrency(a.saldo)}{balanced ? '' : ' ⚠'}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── DRAHÉ VĚCI (Typ 3) – detailní rozpad na jednotlivé transakce ── */}
          {expensiveItems.length > 0 && (
            <section className="report-section">
              <div className="report-section-header">
                <h2 className="report-section-title">Drahé věci</h2>
              </div>
              <div className="report-budget-list">
                {expensiveItems.map(it => (
                  <Link key={it.id} to={`/transactions?category_id=${it.category_id}` + (period ? `&period=${period}` : '')}
                    className="report-budget-row"
                    style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
                    <span className="report-budget-dot" style={{ background: it.category_color || '#6366f1' }} />
                    <span className="report-budget-name">
                      <span className="text-muted" style={{ marginRight: 8 }}>
                        {`${+it.date.slice(8, 10)}. ${+it.date.slice(5, 7)}.`}
                      </span>
                      {it.description || it.category_name}
                      {it.note && <span className="text-muted" style={{ display: 'block', fontSize: 11 }}>{it.note}</span>}
                    </span>
                    <span className={`report-budget-spent${it.amount < 0 ? '' : ' text-success'}`}>
                      {formatCurrency(-it.amount)}
                    </span>
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


        </div>
      )}
    </Layout>
  );
}
