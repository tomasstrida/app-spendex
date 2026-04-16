import { useState, useEffect, useRef } from 'react';
import { Upload, Check, AlertCircle, Plus, Pencil, Trash2, X } from 'lucide-react';
import Layout from '../components/Layout';
import { formatCurrency } from '../i18n';

const STEP = { UPLOAD: 'upload', MAPPING: 'mapping', DONE: 'done' };

const ROLE_LABELS = {
  spending: 'Výdaje',
  fixed:    'Fixní',
  ignored:  'Ignorovat',
};

const ROLE_HINTS = {
  spending: 'Transakce vstupují do kategorií a budgetů.',
  fixed:    'Transakce jsou fixní výdaje (nájem, energie…), nezapočítávají se do budgetů.',
  ignored:  'Transakce jsou ignorovány (OSVČ, splátky, daně…).',
};

function AccountSelector({ accounts, selectedId, detectedIds, onSelect, onCreated }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('spending');
  const [newNumber, setNewNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) { setErr('Zadejte název.'); return; }
    setSaving(true); setErr('');
    try {
      const r = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), role: newRole, account_number: newNumber.trim() || null }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Chyba.'); return; }
      onCreated(d);
      onSelect(d.id);
      setCreating(false);
      setNewName(''); setNewRole('spending'); setNewNumber('');
    } catch { setErr('Chyba připojení.'); }
    finally { setSaving(false); }
  }

  const suggested = accounts.filter(a => detectedIds.includes(a.id));

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>
        Účet
      </h3>

      {suggested.length > 0 && (
        <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
          Automaticky rozpoznán: <strong>{suggested.map(a => a.name).join(', ')}</strong>
        </p>
      )}

      <select
        className="input"
        value={selectedId || ''}
        onChange={e => onSelect(e.target.value ? parseInt(e.target.value) : null)}
        style={{ width: '100%', marginBottom: 8 }}
      >
        <option value="">— bez přiřazení —</option>
        {accounts.map(a => (
          <option key={a.id} value={a.id}>
            {a.name} ({ROLE_LABELS[a.role]})
            {a.account_number ? ` · ${a.account_number}` : ''}
          </option>
        ))}
      </select>

      {selectedId && (() => {
        const acc = accounts.find(a => a.id === selectedId);
        return acc ? (
          <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>
            {ROLE_HINTS[acc.role]}
          </p>
        ) : null;
      })()}

      {!creating ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 4 }}
          onClick={() => setCreating(true)}
        >
          <Plus size={13} /> Nový účet
        </button>
      ) : (
        <form onSubmit={handleCreate} style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {err && <div className="alert alert-error" style={{ padding: '6px 10px', fontSize: 12 }}>{err}</div>}
          <input
            className="input"
            placeholder="Název účtu (Společný, Licence…)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            autoFocus
          />
          <input
            className="input"
            placeholder="Číslo účtu (volitelně, napr. 1679014023)"
            value={newNumber}
            onChange={e => setNewNumber(e.target.value)}
          />
          <select className="input" value={newRole} onChange={e => setNewRole(e.target.value)}>
            {Object.entries(ROLE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l} – {ROLE_HINTS[v]}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              <Check size={13} /> {saving ? 'Ukládám…' : 'Vytvořit'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCreating(false); setErr(''); }}>
              <X size={13} /> Zrušit
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function ImportPage() {
  const [step, setStep] = useState(STEP.UPLOAD);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [abCategories, setAbCategories] = useState([]);
  const [categoryMap, setCategoryMap] = useState({});
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [detectedAccountIds, setDetectedAccountIds] = useState([]);
  const [skipIncoming, setSkipIncoming] = useState(true);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  useEffect(() => {
    fetch('/api/categories').then(r => r.json()).then(setCategories);
    fetch('/api/accounts').then(r => r.json()).then(setAccounts);
  }, []);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    setLoading(true);
    try {
      const text = await file.text();
      const r = await fetch('/api/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: text,
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error); return; }
      setTransactions(d.transactions);
      setAbCategories(d.ab_categories);
      setAccounts(d.accounts || accounts);

      // Předvyplň kategorii
      const saved = d.saved_mappings || {};
      const map = {};
      d.ab_categories.forEach(abCat => {
        if (saved[abCat]) {
          map[abCat] = String(saved[abCat]);
        } else {
          const match = categories.find(c => c.name.toLowerCase() === abCat.toLowerCase());
          map[abCat] = match ? String(match.id) : '';
        }
      });
      setCategoryMap(map);

      // Auto-select detekovaného kandidáta pokud je právě jeden
      const detected = d.detected_account_ids || [];
      setDetectedAccountIds(detected);
      setSelectedAccountId(detected.length === 1 ? detected[0] : null);

      setStep(STEP.MAPPING);
    } catch {
      setError('Chyba při čtení souboru.');
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleConfirm() {
    setLoading(true);
    setError('');
    try {
      const map = {};
      Object.entries(categoryMap).forEach(([k, v]) => {
        if (v) map[k] = parseInt(v);
      });

      const r = await fetch('/api/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactions,
          category_map: map,
          skip_incoming: skipIncoming,
          account_id: selectedAccountId || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error); return; }
      setResult(d);
      setStep(STEP.DONE);
    } catch {
      setError('Chyba při importu.');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep(STEP.UPLOAD);
    setTransactions([]);
    setAbCategories([]);
    setCategoryMap({});
    setSelectedAccountId(null);
    setDetectedAccountIds([]);
    setResult(null);
    setError('');
  }

  const newTx = transactions.filter(t => !t.duplicate && !(skipIncoming && t.direction === 'Příchozí'));
  const dupCount = transactions.filter(t => t.duplicate).length;

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Import z Air Bank</h1>
      </div>

      {error && <div className="alert alert-error" style={{ maxWidth: 560, marginBottom: 20 }}>{error}</div>}

      {/* STEP 1 — Upload */}
      {step === STEP.UPLOAD && (
        <div className="import-upload-area" onClick={() => fileRef.current?.click()}>
          <Upload size={32} style={{ color: 'var(--accent)' }} />
          <div className="import-upload-title">Nahrajte CSV soubor z Air Bank</div>
          <div className="import-upload-hint">
            V Air Bank internetovém bankovnictví: Přehled pohybů → Export → CSV
          </div>
          <button className="btn btn-primary" disabled={loading} onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>
            {loading ? 'Načítání…' : 'Vybrat soubor'}
          </button>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
        </div>
      )}

      {/* STEP 2 — Výběr účtu + mapování + potvrzení */}
      {step === STEP.MAPPING && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>

          {/* Souhrn */}
          <div className="import-summary">
            <div className="import-summary-item">
              <span className="import-summary-num">{transactions.length}</span>
              <span className="text-muted">nalezeno</span>
            </div>
            <div className="import-summary-item">
              <span className="import-summary-num" style={{ color: 'var(--success)' }}>{newTx.length}</span>
              <span className="text-muted">k importu</span>
            </div>
            {dupCount > 0 && (
              <div className="import-summary-item">
                <span className="import-summary-num" style={{ color: 'var(--text2)' }}>{dupCount}</span>
                <span className="text-muted">duplicit</span>
              </div>
            )}
          </div>

          {/* Výběr účtu */}
          <AccountSelector
            accounts={accounts}
            selectedId={selectedAccountId}
            detectedIds={detectedAccountIds}
            onSelect={setSelectedAccountId}
            onCreated={acc => setAccounts(prev => [...prev, acc].sort((a, b) => a.name.localeCompare(b.name)))}
          />

          {/* Příchozí transakce */}
          {transactions.some(t => t.direction === 'Příchozí') && (
            <label className="import-toggle">
              <input
                type="checkbox"
                checked={skipIncoming}
                onChange={e => setSkipIncoming(e.target.checked)}
              />
              <span>Přeskočit příchozí platby ({transactions.filter(t => t.direction === 'Příchozí').length})</span>
            </label>
          )}

          {/* Mapování Air Bank kategorií */}
          {abCategories.length > 0 && (
            <div className="card">
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text)' }}>
                Přiřadit Air Bank kategorie
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {abCategories.map(abCat => {
                  const count = transactions.filter(t => t.ab_category === abCat && !t.duplicate).length;
                  const total = transactions.filter(t => t.ab_category === abCat && !t.duplicate)
                    .reduce((s, t) => s + Math.abs(t.amount), 0);
                  return (
                    <div key={abCat} className="import-mapping-row">
                      <div className="import-mapping-label">
                        <span style={{ fontWeight: 500, fontSize: 14 }}>{abCat}</span>
                        <span className="text-muted" style={{ fontSize: 12 }}>
                          {count} plateb · {formatCurrency(total)}
                        </span>
                      </div>
                      <select
                        className="input"
                        style={{ maxWidth: 200 }}
                        value={categoryMap[abCat] || ''}
                        onChange={e => setCategoryMap(m => ({ ...m, [abCat]: e.target.value }))}
                      >
                        <option value="">— bez kategorie —</option>
                        {categories.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-ghost" onClick={reset}>Zrušit</button>
            <button className="btn btn-primary" onClick={handleConfirm} disabled={loading || newTx.length === 0}>
              <Check size={16} />
              {loading ? 'Importuji…' : `Importovat ${newTx.length} transakcí`}
            </button>
          </div>
        </div>
      )}

      {/* STEP 3 — Výsledek */}
      {step === STEP.DONE && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 400 }}>
          <div className="alert alert-success">
            <strong>Import dokončen.</strong><br />
            Importováno: {result.imported} transakcí<br />
            Přeskočeno: {result.skipped} (duplicity / příchozí)
          </div>
          <button className="btn btn-primary" onClick={reset}>
            Importovat další soubor
          </button>
        </div>
      )}
    </Layout>
  );
}
