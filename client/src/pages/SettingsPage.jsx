import { useState, useEffect } from 'react';
import { Trash2 } from 'lucide-react';
import Layout from '../components/Layout';
import { t, formatPeriod } from '../i18n';
import { pushSupported, isStandalone, enablePush, disablePush, currentSubscription, sendTestPush } from '../push';

function MappingsSection({ categories }) {
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/import/mappings')
      .then(r => r.json())
      .then(d => { setMappings(d); setLoading(false); });
  }, []);

  async function handleDelete(id) {
    if (!confirm('Smazat toto mapování?')) return;
    const r = await fetch(`/api/import/mappings/${id}`, { method: 'DELETE' });
    if (r.ok) setMappings(prev => prev.filter(m => m.id !== id));
  }

  async function handleChangeCategory(mapping, newCategoryId) {
    const r = await fetch('/api/import/mappings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ab_category: mapping.ab_category, category_id: parseInt(newCategoryId) }),
    });
    if (r.ok) {
      const updated = await r.json();
      const cat = categories.find(c => c.id === updated.category_id);
      setMappings(prev => prev.map(m =>
        m.id === mapping.id
          ? { ...m, category_id: updated.category_id, category_name: cat?.name, category_color: cat?.color }
          : m
      ));
    }
  }

  if (loading) return <div className="text-muted" style={{ fontSize: 13 }}>Načítání…</div>;

  return (
    <div>
      <p className="form-hint" style={{ marginBottom: mappings.length ? 16 : 8 }}>
        Mapování se ukládá automaticky při každém importu. Lze zde upravit nebo smazat.
      </p>
      {mappings.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13 }}>Zatím žádná uložená mapování. Proběhne automaticky po prvním importu.</p>
      ) : (
        <div className="mapping-table">
          <div className="mapping-header">
            <span>Kategorie Air Bank</span>
            <span>Kategorie Spendex</span>
            <span />
          </div>
          {mappings.map(m => (
            <div key={m.id} className="mapping-row">
              <span className="mapping-ab-cat">{m.ab_category}</span>
              <select
                className="input"
                style={{ fontSize: 13 }}
                value={m.category_id}
                onChange={e => handleChangeCategory(m, e.target.value)}
              >
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button className="btn btn-ghost btn-icon" onClick={() => handleDelete(m.id)} title="Smazat">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [billingDay, setBillingDay] = useState('');
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [categories, setCategories] = useState([]);
  const [notifyScope, setNotifyScope] = useState('pending_only');
  const [pushState, setPushState] = useState('unknown'); // 'on' | 'off' | 'denied' | 'unsupported'
  const [testMsg, setTestMsg] = useState('');
  const [household, setHousehold] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [hhMsg, setHhMsg] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/settings').then(r => r.json()),
      fetch('/api/categories').then(r => r.json()),
    ]).then(([s, cats]) => {
      setBillingDay(String(s.billing_day));
      setPreview({ start: s.period_start, end: s.period_end });
      setCategories(cats);
      if (s.notify_scope) setNotifyScope(s.notify_scope);
    });
  }, []);

  useEffect(() => {
    (async () => {
      if (!pushSupported()) { setPushState('unsupported'); return; }
      if (Notification.permission === 'denied') { setPushState('denied'); return; }
      const sub = await currentSubscription();
      setPushState(sub ? 'on' : 'off');
    })();
  }, []);

  async function loadHousehold() {
    const r = await fetch('/api/household', { credentials: 'include' });
    if (r.ok) setHousehold(await r.json());
  }
  useEffect(() => { loadHousehold(); }, []);

  async function createInvite() {
    await fetch('/api/household/invite', { method: 'POST', credentials: 'include' });
    loadHousehold();
  }
  async function joinHousehold() {
    const r = await fetch('/api/household/join', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: joinCode.trim() }),
    });
    if (r.ok) {
      setHhMsg(t.settings.household_joined);
      setJoinCode('');
      loadHousehold();
    } else {
      const j = await r.json().catch(() => ({}));
      setHhMsg(j.error || t.settings.household_join_bad);
    }
  }
  async function leaveHousehold() {
    await fetch('/api/household/leave', { method: 'POST', credentials: 'include' });
    setHhMsg('');
    loadHousehold();
  }
  async function removeMember(uid) {
    await fetch(`/api/household/members/${uid}`, { method: 'DELETE', credentials: 'include' });
    loadHousehold();
  }

  async function handleEnablePush() {
    try {
      const r = await enablePush();
      if (r === 'granted') { setPushState('on'); setTestMsg(''); }
      else if (r === 'denied') setPushState('denied');
      else if (r === 'unsupported') setPushState('unsupported');
    } catch (e) { setTestMsg(e.message); }
  }

  async function handleDisablePush() {
    try {
      await disablePush();
      setPushState('off');
      setTestMsg('');
    } catch (e) {
      setTestMsg(e.message);
    }
  }

  async function handleTestPush() {
    try {
      const r = await sendTestPush();
      setTestMsg(r.sent > 0
        ? t.settings.notifications_test_sent.replace('{n}', r.sent)
        : t.settings.notifications_test_none);
    } catch (e) { setTestMsg(e.message); }
  }

  async function handleScopeChange(scope) {
    setNotifyScope(scope);
    const day = parseInt(billingDay, 10) || 1;
    await fetch('/api/settings', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ billing_day: day, notify_scope: scope }),
    });
  }

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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 20 }}>{t.settings.billingDay}</h2>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="form-group">
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

        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Mapování kategorií Air Bank</h2>
          <MappingsSection categories={categories} />
        </div>

        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>{t.settings.notifications_title}</h2>

          {pushState === 'unsupported' && !isStandalone() && /iPhone|iPad|iPod/.test(navigator.userAgent) && (
            <p className="form-hint" style={{ marginBottom: 12 }}>{t.settings.notifications_ios_hint}</p>
          )}
          {pushState === 'unsupported' && !/iPhone|iPad|iPod/.test(navigator.userAgent) && (
            <p className="form-hint" style={{ marginBottom: 12 }}>{t.settings.notifications_unsupported}</p>
          )}
          {pushState === 'denied' && (
            <p className="form-hint" style={{ marginBottom: 12 }}>{t.settings.notifications_denied}</p>
          )}

          {pushState === 'off' && (
            <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={handleEnablePush}>
              {t.settings.notifications_enable}
            </button>
          )}
          {pushState === 'on' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              <p style={{ fontSize: 13, margin: 0 }}>{t.settings.notifications_enabled}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={handleDisablePush}>
                  {t.settings.notifications_disable}
                </button>
                <button className="btn btn-secondary" onClick={handleTestPush}>
                  {t.settings.notifications_test}
                </button>
              </div>
            </div>
          )}
          {testMsg && <p className="form-hint" style={{ marginBottom: 12 }}>{testMsg}</p>}

          <div className="form-group" style={{ marginTop: 4 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }}>
              {t.settings.notifications_scope_label}
              <select
                className="input"
                style={{ marginLeft: 8, fontSize: 13 }}
                value={notifyScope}
                onChange={(e) => handleScopeChange(e.target.value)}
              >
                <option value="off">{t.settings.notifications_scope_off}</option>
                <option value="pending_only">{t.settings.notifications_scope_pending}</option>
                <option value="all">{t.settings.notifications_scope_all}</option>
              </select>
            </label>
          </div>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>{t.settings.household_title}</h2>

          {household && household.role === 'member' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 13, margin: 0 }}>{t.settings.household_member_of} <strong>{household.owner?.name || household.owner?.email}</strong></p>
              <div>
                <button className="btn btn-secondary" onClick={leaveHousehold}>{t.settings.household_leave}</button>
              </div>
            </div>
          )}

          {household && household.role !== 'member' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {household.role === 'solo' && (
                <p className="form-hint" style={{ marginBottom: 4 }}>{t.settings.household_solo}</p>
              )}
              {household.invite_code ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 500 }}>{t.settings.household_code_label}</label>
                  <input
                    className="input"
                    readOnly
                    value={household.invite_code}
                    onFocus={(e) => e.target.select()}
                    style={{ fontSize: 13, maxWidth: 260 }}
                  />
                  <div>
                    <button className="btn btn-secondary" onClick={createInvite}>{t.settings.household_regenerate}</button>
                  </div>
                </div>
              ) : (
                <div>
                  <button className="btn btn-primary" onClick={createInvite}>{t.settings.household_create_invite}</button>
                </div>
              )}
              {household.members && household.members.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{t.settings.household_owner_members}</p>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {household.members.map(m => (
                      <li key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <span>{m.name || m.email}</span>
                        <button className="btn btn-secondary" onClick={() => removeMember(m.user_id)}>{t.settings.household_remove}</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>{t.settings.household_join_label}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    placeholder="kód"
                    style={{ fontSize: 13, maxWidth: 200 }}
                  />
                  <button className="btn btn-primary" onClick={joinHousehold}>{t.settings.household_join}</button>
                </div>
              </div>
            </div>
          )}

          {hhMsg && <p className="form-hint" style={{ marginTop: 8 }}>{hhMsg}</p>}
        </div>
      </div>
    </Layout>
  );
}
