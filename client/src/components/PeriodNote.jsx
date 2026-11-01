import { useState, useEffect } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { t } from '../i18n';

export const PERIOD_NOTE_MAX = 2000;

// Textová poznámka k měsíčnímu období (jedna na období, sdílená domácností).
// Zobrazí se jako blok; klik na „Přidat/Upravit" otevře textové pole.
export default function PeriodNote({ period }) {
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!period) return;
    let cancelled = false;
    setEditing(false);
    setError('');
    setNote('');
    fetch(`/api/period-notes?period=${period}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then(d => { if (!cancelled) setNote(d.note || ''); })
      .catch(() => { if (!cancelled) setError(t.periodNote.loadError); });
    return () => { cancelled = true; };
  }, [period]);

  function startEdit() {
    setDraft(note);
    setError('');
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const r = await fetch('/api/period-notes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, note: draft }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || t.periodNote.saveError);
      setNote(d.note || '');
      setEditing(false);
    } catch (e) {
      setError(e.message || t.periodNote.saveError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="report-section period-note">
      <div className="report-section-header">
        <h2 className="report-section-title">{t.periodNote.title}</h2>
        {!editing && (
          <button className="btn btn-ghost" onClick={startEdit}>
            {note ? <Pencil size={14} /> : <Plus size={14} />}
            {' '}{note ? t.periodNote.edit : t.periodNote.add}
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            className="period-note-input"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            maxLength={PERIOD_NOTE_MAX}
            rows={4}
            placeholder={t.periodNote.placeholder}
            autoFocus
          />
          <div className="period-note-actions">
            <span className="text-muted" style={{ fontSize: 11 }}>{draft.length} / {PERIOD_NOTE_MAX}</span>
            <button className="btn btn-ghost" onClick={() => setEditing(false)} disabled={saving}>
              {t.periodNote.cancel}
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {t.periodNote.save}
            </button>
          </div>
        </>
      ) : (
        note && <p className="period-note-text">{note}</p>
      )}

      {error && <p className="text-danger" style={{ fontSize: 12, marginTop: 8 }}>{error}</p>}
    </section>
  );
}
