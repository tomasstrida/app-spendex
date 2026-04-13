import { useState, useEffect, useRef } from 'react';
import { Upload, Check, AlertCircle, SkipForward } from 'lucide-react';
import Layout from '../components/Layout';
import { formatCurrency } from '../i18n';

const STEP = { UPLOAD: 'upload', MAPPING: 'mapping', DONE: 'done' };

export default function ImportPage() {
  const [step, setStep] = useState(STEP.UPLOAD);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [abCategories, setAbCategories] = useState([]);
  const [categoryMap, setCategoryMap] = useState({});
  const [skipIncoming, setSkipIncoming] = useState(true);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  useEffect(() => {
    fetch('/api/categories').then(r => r.json()).then(setCategories);
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
      // Inicializuj prázdné mapování
      const map = {};
      d.ab_categories.forEach(c => { map[c] = ''; });
      setCategoryMap(map);
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
      // Převeď categoryMap na čísla nebo null
      const map = {};
      Object.entries(categoryMap).forEach(([k, v]) => {
        if (v) map[k] = parseInt(v);
      });

      const r = await fetch('/api/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions, category_map: map, skip_incoming: skipIncoming }),
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
    setResult(null);
    setError('');
  }

  const newTx = transactions.filter(t => !t.duplicate && !(skipIncoming && t.direction === 'Příchozí'));
  const dupCount = transactions.filter(t => t.duplicate).length;
  const incomingCount = skipIncoming ? transactions.filter(t => !t.duplicate && t.direction === 'Příchozí').length : 0;

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

      {/* STEP 2 — Mapování kategorií + potvrzení */}
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
