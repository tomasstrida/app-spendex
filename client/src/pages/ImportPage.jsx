import { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, Check, AlertCircle, Plus, Pencil, Trash2, X, Download, Inbox, Mail } from 'lucide-react';
import Layout from '../components/Layout';
import { formatCurrency } from '../i18n';

const STEP = { UPLOAD: 'upload', MAPPING: 'mapping', DONE: 'done' };

const ROLE_LABELS = {
  spending: 'Výdaje',
  fixed:    'Fixní',
  ignored:  'Ignorovat',
  income:   'Příjmy',
};

const ROLE_HINTS = {
  spending: 'Transakce vstupují do kategorií a budgetů.',
  fixed:    'Transakce jsou fixní výdaje (nájem, energie…), nezapočítávají se do budgetů.',
  income:   'Vlastní účet, jehož převody do spending/fixed účtů jsou příjem domácnosti (OSVČ).',
  ignored:  'Účet je mimo evidenci (transit, savings, daně…). Transakce ignorovány v reportech.',
};

// Odhad účtu z názvu souboru: nejdřív podle čísla účtu (číslice), pak podle názvu účtu
function guessAccountByFilename(filename, accounts) {
  if (!filename) return null;
  const lower = filename.toLowerCase();
  const fileDigits = filename.replace(/\D/g, '');
  // 1) shoda čísla účtu (jako souvislá sekvence číslic v názvu)
  for (const a of accounts) {
    const num = a.account_number ? String(a.account_number).replace(/\D/g, '') : '';
    if (num && num.length >= 4 && fileDigits.includes(num)) return a.id;
  }
  // 2) shoda názvu účtu (podřetězec, bez ohledu na velikost písmen)
  for (const a of accounts) {
    if (a.name && a.name.length >= 3 && lower.includes(a.name.toLowerCase())) return a.id;
  }
  return null;
}

function AccountSelector({ accounts, selectedId, detectedIds, onSelect, onCreated, onUpdated }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('spending');
  const [newNumber, setNewNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [savingRole, setSavingRole] = useState(false);
  const [roleErr, setRoleErr] = useState('');

  useEffect(() => { setRoleErr(''); }, [selectedId]);

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

  async function handleRoleChange(acc, role) {
    setSavingRole(true); setRoleErr('');
    try {
      const r = await fetch(`/api/accounts/${acc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const d = await r.json();
      if (!r.ok) { setRoleErr(d.error || 'Chyba.'); return; }
      onUpdated(d);
    } catch { setRoleErr('Chyba připojení.'); }
    finally { setSavingRole(false); }
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
          <div style={{ marginBottom: 4 }}>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>
              {ROLE_HINTS[acc.role]}
            </p>
            <select
              className="input"
              value={acc.role}
              disabled={savingRole}
              onChange={e => handleRoleChange(acc, e.target.value)}
              style={{ width: '100%' }}
            >
              {Object.entries(ROLE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l} – {ROLE_HINTS[v]}</option>
              ))}
            </select>
            {savingRole && (
              <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>Ukládám…</p>
            )}
            {roleErr && (
              <div className="alert alert-error" style={{ padding: '6px 10px', fontSize: 12, marginTop: 6 }}>
                {roleErr}
              </div>
            )}
          </div>
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

function EmailInbox() {
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [busy, setBusy] = useState(null);
  const [selectedCats, setSelectedCats] = useState({});

  const load = useCallback(async () => {
    const [ri, rc] = await Promise.all([
      fetch('/api/email-inbox'),
      fetch('/api/categories'),
    ]);
    if (ri.ok) setItems(await ri.json());
    if (rc.ok) setCats(await rc.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  async function approve(item, categoryId) {
    setBusy(item.id);
    try {
      const r = await fetch(`/api/email-inbox/${item.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: categoryId || null }),
      });
      if (r.ok) await load();
    } finally { setBusy(null); }
  }

  async function remove(item) {
    setBusy(item.id);
    try {
      const r = await fetch(`/api/email-inbox/${item.id}`, { method: 'DELETE' });
      if (r.ok) await load();
    } finally { setBusy(null); }
  }

  const pending = items.filter(i => i.status === 'pending');
  const unparsed = items.filter(i => i.status === 'unparsed');

  if (items.length === 0) return null;

  return (
    <section style={{ marginBottom: 24 }}>
      <h2 className="page-title" style={{ fontSize: 18, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Mail size={18} /> Z e-mailu
        <span className="badge" style={{ background: 'var(--primary)', color: '#fff', borderRadius: 10, padding: '2px 8px', fontSize: 12 }}>
          {items.length}
        </span>
      </h2>

      {pending.map(item => {
        let tx = {};
        try { tx = item.parsed_json ? JSON.parse(item.parsed_json) : {}; } catch { /* poškozený JSON v parsed_json */ }
        return (
          <div key={item.id} className="card" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tx.description || '—'}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>{tx.date} {tx.tx_time || ''}</div>
            </div>
            <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatCurrency(tx.amount)}</div>
            <select
              value={selectedCats[item.id] ?? (item.suggested_category_id || '')}
              onChange={e => setSelectedCats(prev => ({ ...prev, [item.id]: e.target.value }))}
              style={{ flex: '0 1 180px' }}
            >
              <option value="">— kategorie —</option>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" disabled={busy === item.id}
              onClick={() => approve(item, selectedCats[item.id] ?? item.suggested_category_id ?? '')}>
              <Check size={14} /> Zařadit
            </button>
            <button className="btn btn-ghost btn-icon" disabled={busy === item.id}
              onClick={() => remove(item)} title="Smazat">
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}

      {unparsed.length > 0 && (
        <div className="card" style={{ marginTop: 8 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Inbox size={14} /> Nerozpoznané ({unparsed.length})
          </h3>
          {unparsed.map(item => (
            <details key={item.id} style={{ marginBottom: 6 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                {item.created_at}
                <button className="btn btn-ghost btn-icon" style={{ marginLeft: 8 }}
                  disabled={busy === item.id} onClick={() => remove(item)} title="Smazat">
                  <Trash2 size={14} />
                </button>
              </summary>
              <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', background: 'var(--bg2)', padding: 8, borderRadius: 6 }}>
                {item.raw_text}
              </pre>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ImportPage() {
  const [step, setStep] = useState(STEP.UPLOAD);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [fileImports, setFileImports] = useState([]); // [{ name, transactions, detectedIds, accountId }]
  const [abCategories, setAbCategories] = useState([]);
  const [categoryMap, setCategoryMap] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const [archive, setArchive] = useState([]);

  const loadArchive = useCallback(() => {
    fetch('/api/import/archive')
      .then(r => r.ok ? r.json() : [])
      .then(setArchive)
      .catch(() => setArchive([]));
  }, []);

  useEffect(() => {
    fetch('/api/categories').then(r => r.json()).then(setCategories);
    fetch('/api/accounts').then(r => r.json()).then(setAccounts);
    loadArchive();
  }, [loadArchive]);

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (files.length > 20) {
      setError('Najednou lze nahrát maximálně 20 souborů.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setError('');
    setLoading(true);
    try {
      // Parsuj každý soubor zvlášť přes stávající preview endpoint
      const previews = [];
      const rawTexts = [];
      for (const file of files) {
        const text = await file.text();
        rawTexts.push(text);
        const r = await fetch('/api/import/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: text,
        });
        const d = await r.json();
        if (!r.ok) { setError(`${file.name}: ${d.error}`); return; }
        previews.push(d);
      }

      const mergedAccounts = previews[previews.length - 1]?.accounts || accounts;

      // Každý soubor = vlastní výpis = vlastní účet.
      // Priorita: shoda podle názvu souboru → jinak detekce z obsahu (právě 1 kandidát).
      const imports = previews.map((p, i) => {
        const detected = p.detected_account_ids || [];
        const byFilename = guessAccountByFilename(files[i].name, mergedAccounts);
        const accountId = byFilename ?? (detected.length === 1 ? detected[0] : null);
        const detectedIds = byFilename
          ? [...new Set([byFilename, ...detected])]
          : detected;
        return {
          name: files[i].name,
          rawCsv: rawTexts[i],
          transactions: p.transactions || [],
          detectedIds,
          accountId,
        };
      });
      const mergedAbCats = [...new Set(previews.flatMap(p => p.ab_categories || []))].sort();
      const savedMappings = Object.assign({}, ...previews.map(p => p.saved_mappings || {}));

      setFileImports(imports);
      setAbCategories(mergedAbCats);
      setAccounts(mergedAccounts);

      // Předvyplň kategorii (mapování je per uživatel, sdílené napříč soubory)
      const map = {};
      mergedAbCats.forEach(abCat => {
        if (savedMappings[abCat]) {
          map[abCat] = String(savedMappings[abCat]);
        } else {
          const match = categories.find(c => c.name.toLowerCase() === abCat.toLowerCase());
          map[abCat] = match ? String(match.id) : '';
        }
      });
      setCategoryMap(map);

      setStep(STEP.MAPPING);
    } catch {
      setError('Chyba při čtení souborů.');
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleConfirm() {
    // Každý soubor s transakcemi k importu musí mít vybraný účet
    if (fileImports.some(f => fileNewTx(f).length > 0 && !f.accountId)) {
      setError('Vyberte účet pro každý soubor, který má transakce k importu.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const map = {};
      Object.entries(categoryMap).forEach(([k, v]) => {
        if (v) map[k] = parseInt(v);
      });

      let imported = 0;
      let skipped = 0;
      // Sekvenčně, aby dedup proti DB platil i mezi soubory stejného účtu
      for (const f of fileImports) {
        if (!f.accountId) continue;
        const r = await fetch('/api/import/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactions: f.transactions,
            category_map: map,
            account_id: f.accountId,
            raw_csv: f.rawCsv,
            filename: f.name,
          }),
        });
        const d = await r.json();
        if (!r.ok) { setError(`${f.name}: ${d.error}`); return; }
        imported += d.imported;
        skipped += d.skipped;
      }
      setResult({ imported, skipped });
      loadArchive();
      setStep(STEP.DONE);
    } catch {
      setError('Chyba při importu.');
    } finally {
      setLoading(false);
    }
  }

  function handleAccountUpdated(acc) {
    setAccounts(prev => prev.map(a => a.id === acc.id ? acc : a));
  }

  async function handleDeleteArchive(item) {
    if (!confirm(`Smazat archiv „${item.filename}"? Transakce zůstanou.`)) return;
    try {
      const r = await fetch(`/api/import/archive/${item.id}`, { method: 'DELETE' });
      if (r.ok) loadArchive();
    } catch { /* tichá */ }
  }

  function reset() {
    setStep(STEP.UPLOAD);
    setFileImports([]);
    setAbCategories([]);
    setCategoryMap({});
    setResult(null);
    setError('');
  }

  // Nové (neduplicitní, neignorované) transakce pro daný soubor
  const fileNewTx = f => f.transactions.filter(t => !t.duplicate);
  const allTx = fileImports.flatMap(f => f.transactions);
  const totalNew = fileImports.reduce((s, f) => s + fileNewTx(f).length, 0);
  const totalDup = allTx.filter(t => t.duplicate).length;

  return (
    <Layout>
      <EmailInbox />
      <div className="page-header">
        <h1 className="page-title">Import z Air Bank</h1>
      </div>

      {error && <div className="alert alert-error" style={{ maxWidth: 560, marginBottom: 20 }}>{error}</div>}

      {/* STEP 1 — Upload */}
      {step === STEP.UPLOAD && (
        <div className="import-upload-area" onClick={() => fileRef.current?.click()}>
          <Upload size={32} style={{ color: 'var(--accent)' }} />
          <div className="import-upload-title">Nahrajte CSV soubory z Air Bank</div>
          <div className="import-upload-hint">
            V Air Bank internetovém bankovnictví: Přehled pohybů → Export → CSV.<br />
            Můžete vybrat víc souborů najednou (max 20) — každý výpis se přiřadí na svůj účet.
          </div>
          <button className="btn btn-primary" disabled={loading} onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>
            {loading ? 'Načítání…' : 'Vybrat soubory'}
          </button>
          <input ref={fileRef} type="file" accept=".csv" multiple style={{ display: 'none' }} onChange={handleFiles} />
        </div>
      )}

      {/* STEP 2 — Výběr účtu + mapování + potvrzení */}
      {step === STEP.MAPPING && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>

          {/* Souhrn (napříč všemi soubory) */}
          <div className="import-summary">
            <div className="import-summary-item">
              <span className="import-summary-num">{allTx.length}</span>
              <span className="text-muted">nalezeno · {fileImports.length} soubor{fileImports.length === 1 ? '' : (fileImports.length < 5 ? 'y' : 'ů')}</span>
            </div>
            <div className="import-summary-item">
              <span className="import-summary-num" style={{ color: 'var(--success)' }}>{totalNew}</span>
              <span className="text-muted">k importu</span>
            </div>
            {totalDup > 0 && (
              <div className="import-summary-item">
                <span className="import-summary-num" style={{ color: 'var(--text2)' }}>{totalDup}</span>
                <span className="text-muted">duplicit</span>
              </div>
            )}
          </div>

          {/* Výběr účtu pro každý soubor */}
          {fileImports.map((f, i) => {
            const nw = fileNewTx(f);
            const dup = f.transactions.filter(t => t.duplicate).length;
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  {f.name}
                  <span className="text-muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                    {f.transactions.length} nalezeno · {nw.length} k importu{dup > 0 ? ` · ${dup} duplicit` : ''}
                  </span>
                </div>
                <AccountSelector
                  accounts={accounts}
                  selectedId={f.accountId}
                  detectedIds={f.detectedIds}
                  onSelect={id => setFileImports(prev => prev.map((x, j) => j === i ? { ...x, accountId: id } : x))}
                  onCreated={acc => setAccounts(prev => [...prev, acc].sort((a, b) => a.name.localeCompare(b.name)))}
                  onUpdated={handleAccountUpdated}
                />
              </div>
            );
          })}

          {/* Mapování Air Bank kategorií */}
          {abCategories.length > 0 && (
            <div className="card">
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text)' }}>
                Přiřadit Air Bank kategorie
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {abCategories.map(abCat => {
                  const count = allTx.filter(t => t.ab_category === abCat && !t.duplicate).length;
                  const total = allTx.filter(t => t.ab_category === abCat && !t.duplicate)
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
            <button className="btn btn-primary" onClick={handleConfirm} disabled={loading || totalNew === 0}>
              <Check size={16} />
              {loading ? 'Importuji…' : `Importovat ${totalNew} transakcí`}
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

      {/* Archiv výpisů — vždy viditelný */}
      <section style={{ marginTop: 40 }}>
        <h2 className="page-title" style={{ fontSize: 18, marginBottom: 12 }}>Archiv výpisů</h2>
        {archive.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13 }}>
            Archiv je prázdný. Po prvním importu se sem ukládají originální CSV.
          </p>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text2)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Soubor</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Zdroj</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Účet</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px' }}>Nahráno</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px' }}>#Tx</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px' }}>Velikost</th>
                  <th style={{ padding: '10px 12px' }} />
                </tr>
              </thead>
              <tbody>
                {archive.map(item => (
                  <tr key={item.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px', wordBreak: 'break-all' }}>{item.filename}</td>
                    <td style={{ padding: '8px 12px' }} className="text-muted">{item.source}</td>
                    <td style={{ padding: '8px 12px' }} className="text-muted">{item.account_name || '—'}</td>
                    <td style={{ padding: '8px 12px' }} className="text-muted">{item.uploaded_at}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{item.parsed_tx_count}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }} className="text-muted">
                      {(item.size_bytes / 1024).toFixed(1)} KB
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <a className="btn btn-ghost btn-icon" href={`/api/import/archive/${item.id}/download`}
                         title="Stáhnout originál CSV">
                        <Download size={14} />
                      </a>
                      <button className="btn btn-ghost btn-icon" onClick={() => handleDeleteArchive(item)}
                        title="Smazat z archivu (transakce zůstanou)">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Layout>
  );
}
