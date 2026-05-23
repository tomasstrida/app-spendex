import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import Layout from '../components/Layout';

const ROLE_LABELS = {
  spending: 'Výdaje',
  fixed:    'Fixní',
  income:   'Příjmy (zdroj)',
  ignored:  'Mimo evidenci',
};

const ROLE_HINTS = {
  spending: 'Operativní účet — transakce vstupují do budgetů, kategorií a výdajových reportů.',
  fixed:    'Účet pro fixní platby (nájem, energie). Odchozí se sčítají v sekci Fixní platby na Schůzce.',
  income:   'Vlastní účet, jehož převody do spending/fixed jsou příjem domácnosti (typicky OSVČ).',
  ignored:  'Účet je v evidenci, ale jeho transakce jsou mimo všechny reporty (transit, savings, daně).',
};

export default function AccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ name: '', account_number: '' });
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNumber, setNewNumber] = useState('');
  const [newRole, setNewRole] = useState('spending');
  const [savingNew, setSavingNew] = useState(false);

  function load() {
    setLoading(true);
    fetch('/api/accounts')
      .then(r => r.json())
      .then(setAccounts)
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function patchAccount(id, body) {
    setError('');
    try {
      const r = await fetch(`/api/accounts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Chyba.'); return null; }
      setAccounts(prev => prev.map(a => a.id === id ? d : a).sort((a, b) => a.name.localeCompare(b.name)));
      return d;
    } catch { setError('Chyba připojení.'); return null; }
  }

  async function handleRoleChange(acc, role) {
    if (role === acc.role) return;
    await patchAccount(acc.id, { role });
  }

  function startEdit(acc) {
    setEditingId(acc.id);
    setDraft({ name: acc.name, account_number: acc.account_number || '' });
  }

  async function saveEdit(acc) {
    const changes = {};
    if (draft.name !== acc.name) changes.name = draft.name;
    if ((draft.account_number || '') !== (acc.account_number || '')) changes.account_number = draft.account_number;
    if (Object.keys(changes).length === 0) { setEditingId(null); return; }
    const updated = await patchAccount(acc.id, changes);
    if (updated) setEditingId(null);
  }

  async function handleDelete(acc) {
    if (!confirm(`Smazat účet „${acc.name}"? Transakce zůstanou (account_id se vynuluje).`)) return;
    setError('');
    try {
      const r = await fetch(`/api/accounts/${acc.id}`, { method: 'DELETE' });
      if (r.ok) load();
      else { const d = await r.json().catch(() => ({})); setError(d.error || 'Chyba mazání.'); }
    } catch { setError('Chyba připojení.'); }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) { setError('Zadejte název.'); return; }
    setSavingNew(true); setError('');
    try {
      const r = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          role: newRole,
          account_number: newNumber.trim() || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Chyba.'); return; }
      setAccounts(prev => [...prev, d].sort((a, b) => a.name.localeCompare(b.name)));
      setShowCreate(false);
      setNewName(''); setNewNumber(''); setNewRole('spending');
    } catch { setError('Chyba připojení.'); }
    finally { setSavingNew(false); }
  }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">Účty</h1>
        {!showCreate && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Přidat účet
          </button>
        )}
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 12, maxWidth: 900 }}>{error}</div>}

      {showCreate && (
        <form onSubmit={handleCreate} className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Nový účet</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="input" placeholder="Název" value={newName}
              onChange={e => setNewName(e.target.value)} autoFocus />
            <input className="input" placeholder="Číslo účtu (volitelně)" value={newNumber}
              onChange={e => setNewNumber(e.target.value)} />
            <select className="input" value={newRole} onChange={e => setNewRole(e.target.value)}>
              {Object.entries(ROLE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l} — {ROLE_HINTS[v]}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingNew}>
                <Check size={14} /> {savingNew ? 'Ukládám…' : 'Vytvořit'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowCreate(false); setError(''); }}>
                <X size={14} /> Zrušit
              </button>
            </div>
          </div>
        </form>
      )}

      {loading ? (
        <div className="page-loading">Načítání…</div>
      ) : accounts.length === 0 ? (
        <p className="text-muted">Žádné účty. Přidej první přes „+ Přidat účet".</p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden', maxWidth: 900 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text2)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Název</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Číslo účtu</th>
                <th style={{ textAlign: 'left', padding: '10px 12px' }}>Role</th>
                <th style={{ padding: '10px 12px' }} />
              </tr>
            </thead>
            <tbody>
              {accounts.map(acc => {
                const editing = editingId === acc.id;
                return (
                  <tr key={acc.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px', verticalAlign: 'top' }}>
                      {editing ? (
                        <input className="input" value={draft.name}
                          onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                          style={{ maxWidth: 200 }} />
                      ) : <span style={{ fontWeight: 500 }}>{acc.name}</span>}
                    </td>
                    <td style={{ padding: '8px 12px', verticalAlign: 'top' }} className="text-muted">
                      {editing ? (
                        <input className="input" value={draft.account_number}
                          onChange={e => setDraft(d => ({ ...d, account_number: e.target.value }))}
                          placeholder="—" style={{ maxWidth: 160 }} />
                      ) : (acc.account_number || '—')}
                    </td>
                    <td style={{ padding: '8px 12px', verticalAlign: 'top' }}>
                      <select value={acc.role} onChange={e => handleRoleChange(acc, e.target.value)}
                        className="input" style={{ maxWidth: 200 }}>
                        {Object.entries(ROLE_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                      <div className="text-muted" style={{ fontSize: 11, marginTop: 4, maxWidth: 360 }}>
                        {ROLE_HINTS[acc.role]}
                      </div>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      {editing ? (
                        <>
                          <button className="btn btn-primary btn-icon" onClick={() => saveEdit(acc)} title="Uložit">
                            <Check size={14} />
                          </button>
                          <button className="btn btn-ghost btn-icon" onClick={() => setEditingId(null)} title="Zrušit">
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-ghost btn-icon" onClick={() => startEdit(acc)} title="Upravit název / číslo">
                            <Pencil size={14} />
                          </button>
                          <button className="btn btn-ghost btn-icon" onClick={() => handleDelete(acc)} title="Smazat účet (transakce zůstanou)">
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
