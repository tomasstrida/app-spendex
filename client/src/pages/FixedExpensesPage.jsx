import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { t } from '../i18n';

const EMPTY = { name: '', amount: '', amount_min: '', amount_max: '', frequency_months: 1, match_pattern: '', match_counterparty_account: '', note: '', valid_from: '', valid_to: '' };

export default function FixedExpensesPage() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState('');

  const load = () => fetch('/api/fixed-expenses').then(r => r.json()).then(setItems);
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const pattern = form.match_pattern.trim();
    const cpAccount = form.match_counterparty_account.trim();
    if (!pattern && !cpAccount) { setError('Zadej text v popisu nebo číslo účtu příjemce.'); return; }
    const body = {
      name: form.name,
      amount: parseFloat(form.amount),
      amount_min: form.amount_min === '' ? null : parseFloat(form.amount_min),
      amount_max: form.amount_max === '' ? null : parseFloat(form.amount_max),
      frequency_months: parseInt(form.frequency_months, 10) || 1,
      match_pattern: pattern || null,
      match_counterparty_account: cpAccount || null,
      note: form.note || null,
      valid_from: form.valid_from || null,
      valid_to: form.valid_to || null,
    };
    const url = editId ? `/api/fixed-expenses/${editId}` : '/api/fixed-expenses';
    const res = await fetch(url, {
      method: editId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { setError((await res.json()).error || 'Chyba'); return; }
    setForm(EMPTY);
    setEditId(null);
    load();
  };

  const edit = (it) => {
    setEditId(it.id);
    setForm({
      name: it.name || '',
      amount: it.amount ?? '',
      amount_min: it.amount_min ?? '',
      amount_max: it.amount_max ?? '',
      frequency_months: it.frequency_months || 1,
      match_pattern: it.match_pattern || '',
      match_counterparty_account: it.match_counterparty_account || '',
      note: it.note || '',
      valid_from: it.valid_from || '',
      valid_to: it.valid_to || '',
    });
    setError('');
  };

  const cancelEdit = () => { setForm(EMPTY); setEditId(null); setError(''); };

  // Kosmetický štítek ukončeno/od — porovnává se s aktuálním kalendářním měsícem
  // (stránka nezná billing day; statusy plateb se zde nezobrazují).
  const now = new Date();
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fmtPeriod = (p) => `${parseInt(p.slice(5), 10)}/${p.slice(0, 4)}`;

  // Nabídka období pro selectboxy Platí od/do: ±2 roky kolem dneška;
  // hodnota mimo rozsah (starý záznam) se do nabídky přidá, aby se neztratila.
  const monthOptions = [];
  for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 2; y++) {
    for (let m = 1; m <= 12; m++) monthOptions.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  const periodOptions = (current) =>
    current && !monthOptions.includes(current)
      ? [current, ...monthOptions].sort()
      : monthOptions;

  const del = async (id) => {
    if (!confirm('Smazat fixní platbu?')) return;
    const res = await fetch(`/api/fixed-expenses/${id}`, { method: 'DELETE' });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error || 'Chyba mazání.'); return; }
    if (editId === id) cancelEdit();
    load();
  };

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{t.nav.fixedExpenses}</h1>
      </div>

      <p className="text-muted" style={{ marginBottom: 16, fontSize: 13 }}>
        Pravidelné platby mimo měsíční rozpočty (nájem, energie, předplatné). Min/Max a frekvence
        slouží pro sledování odchylek — vyplň je jen u položek, kde se to hodí.
      </p>

      <form className="card" onSubmit={submit} style={{ display: 'grid', gap: 8, maxWidth: 520, marginBottom: 16 }}>
        <input
          className="input"
          placeholder="Název"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          required
        />
        <input
          className="input"
          type="number"
          placeholder="Plánovaná částka"
          value={form.amount}
          onChange={e => setForm({ ...form, amount: e.target.value })}
          required
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            type="number"
            placeholder="Min"
            value={form.amount_min}
            onChange={e => setForm({ ...form, amount_min: e.target.value })}
          />
          <input
            className="input"
            type="number"
            placeholder="Max"
            value={form.amount_max}
            onChange={e => setForm({ ...form, amount_max: e.target.value })}
          />
          <input
            className="input"
            type="number"
            placeholder="Frekvence (měsíce)"
            value={form.frequency_months}
            onChange={e => setForm({ ...form, frequency_months: e.target.value })}
            min={1}
          />
        </div>
        <input
          className="input"
          placeholder="Pattern transakce (volitelné)"
          value={form.match_pattern}
          onChange={e => setForm({ ...form, match_pattern: e.target.value })}
        />
        <input
          className="input"
          placeholder="Číslo účtu příjemce (volitelné, má přednost)"
          value={form.match_counterparty_account}
          onChange={e => setForm({ ...form, match_counterparty_account: e.target.value })}
        />
        <span className="text-muted" style={{ fontSize: 11 }}>
          Vyplň aspoň jedno: text v popisu, nebo číslo účtu příjemce. Podle toho se pozná, jestli platba proběhla a v jaké částce. Číslo účtu je spolehlivější a má přednost.
        </span>
        <input
          className="input"
          placeholder="Poznámka"
          value={form.note}
          onChange={e => setForm({ ...form, note: e.target.value })}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="text-muted" style={{ fontSize: 11, flex: 1 }}>
            Platí od
            <select
              className="input"
              value={form.valid_from}
              onChange={e => setForm({ ...form, valid_from: e.target.value })}
            >
              <option value="">— bez omezení —</option>
              {periodOptions(form.valid_from).map(p => (
                <option key={p} value={p}>{fmtPeriod(p)}</option>
              ))}
            </select>
          </label>
          <label className="text-muted" style={{ fontSize: 11, flex: 1 }}>
            Platí do (včetně)
            <select
              className="input"
              value={form.valid_to}
              onChange={e => setForm({ ...form, valid_to: e.target.value })}
            >
              <option value="">— bez omezení —</option>
              {periodOptions(form.valid_to).map(p => (
                <option key={p} value={p}>{fmtPeriod(p)}</option>
              ))}
            </select>
          </label>
        </div>
        <span className="text-muted" style={{ fontSize: 11 }}>
          Nech prázdné, pokud platba platí bez omezení. Při změně poskytovatele starou platbu ukonči („Platí do") a novou založ s „Platí od" — historie starých období zůstane přesná.
        </span>
        {error && <div className="text-danger">{error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" type="submit">{editId ? 'Uložit' : 'Přidat'}</button>
          {editId && <button className="btn btn-ghost" type="button" onClick={cancelEdit}>Zrušit</button>}
        </div>
      </form>

      <div className="card" style={{ maxWidth: 520 }}>
        {items.length === 0 ? (
          <div className="text-muted" style={{ fontSize: 13 }}>Zatím žádné fixní platby.</div>
        ) : (
          items.map(it => (
            <div key={it.id} className="report-budget-row" style={{ alignItems: 'center', opacity: it.valid_to && it.valid_to < nowKey ? 0.55 : 1 }}>
              <span className="report-budget-name">
                {it.name}
                <span className="text-muted" style={{ display: 'block', fontSize: 11 }}>
                  {it.amount_min != null && it.amount_max != null ? `${it.amount_min}–${it.amount_max} Kč` : `${it.amount} Kč`}
                  {it.frequency_months > 1 ? ` · à ${it.frequency_months} měs.` : ''}
                  {it.match_pattern ? ` · „${it.match_pattern}"` : ''}
                  {it.match_counterparty_account ? ` · účet ${it.match_counterparty_account}` : ''}
                  {it.valid_to && it.valid_to < nowKey ? ` · ukončeno ${fmtPeriod(it.valid_to)}` : ''}
                  {it.valid_from && it.valid_from > nowKey ? ` · od ${fmtPeriod(it.valid_from)}` : ''}
                </span>
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => edit(it)}>Upravit</button>
              <button className="btn btn-ghost btn-sm" onClick={() => del(it.id)}>Smazat</button>
            </div>
          ))
        )}
      </div>
    </Layout>
  );
}
