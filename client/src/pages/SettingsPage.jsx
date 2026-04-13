import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { t, formatPeriod } from '../i18n';

export default function SettingsPage() {
  const [billingDay, setBillingDay] = useState('');
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => {
        setBillingDay(String(d.billing_day));
        setPreview({ start: d.period_start, end: d.period_end });
      });
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    const day = parseInt(billingDay, 10);
    if (!day || day < 1 || day > 31) { setError('Zadejte číslo 1–31.'); return; }
    setSaving(true); setError(''); setSaved(false);
    try {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billing_day: day }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Chyba.'); return; }
      setPreview({ start: d.period_start, end: d.period_end });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Chyba připojení.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">{t.settings.title}</h1>
      </div>

      <div className="card" style={{ maxWidth: 480 }}>
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="form-group">
            <label className="form-label">{t.settings.billingDay}</label>
            <p className="form-hint" style={{ marginBottom: 8 }}>{t.settings.billingDayHint}</p>
            <p className="form-hint" style={{ marginBottom: 10 }}>{t.settings.billingDayExample}</p>
            <input
              className="input"
              type="number"
              min="1"
              max="31"
              value={billingDay}
              onChange={e => setBillingDay(e.target.value)}
              style={{ maxWidth: 100 }}
            />
          </div>

          {preview && (
            <div className="alert alert-success" style={{ fontSize: 13 }}>
              Aktuální období: <strong>{formatPeriod(preview.start, preview.end)}</strong>
            </div>
          )}

          {error && <div className="alert alert-error">{error}</div>}
          {saved && <div className="alert alert-success">{t.settings.saved}</div>}

          <div>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? '…' : t.settings.save}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
