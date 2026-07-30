import { useState } from 'react';
import { Plus, Trash2, Lock } from 'lucide-react';
import { formatCurrency } from '../i18n';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Karta jednoho předplaceného balíčku. `compact` = varianta pro Dashboard
// (jen zbytek + tlačítko +1), plná varianta přidá historii čerpání a správu.
export default function PrepaidPackageCard({ pkg, compact = false, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [drawDate, setDrawDate] = useState(todayISO());
  const [drawUnits, setDrawUnits] = useState('1');
  const [drawNote, setDrawNote] = useState('');

  // Vrací true/false podle úspěchu — volající, které to potřebují (např.
  // formulář vlastního čerpání), tak ví, jestli má vyčistit svá pole, aniž by
  // to zaváděli konzumenti onChanged (ti dál dostávají pkg/null jako dřív).
  async function call(url, options) {
    setBusy(true);
    try {
      const r = await fetch(url, options);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        alert(body.error || 'Akce se nezdařila.');
        return false;
      }
      const data = await r.json().catch(() => null);
      onChanged?.(data && data.id ? data : null);
      return true;
    } finally {
      setBusy(false);
    }
  }

  function addDraw(units, extra = {}) {
    return call(`/api/prepaid/${pkg.id}/draws`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ units, ...extra }),
    });
  }

  // Plná varianta karty: zpětné odtiknutí s vlastním datem (uživatel si na
  // začátku měsíce doklikává tréninky z předchozího) a poznámkou. Tlačítka
  // +1/+2 zůstávají rychlou cestou pro dnešek.
  async function submitCustomDraw(e) {
    e.preventDefault();
    const units = parseFloat(drawUnits);
    if (!(units > 0)) return;
    const ok = await addDraw(units, { date: drawDate || todayISO(), note: drawNote.trim() || undefined });
    if (ok) { setDrawUnits('1'); setDrawNote(''); }
  }

  function removeDraw(drawId) {
    if (!confirm('Smazat toto čerpání?')) return;
    return call(`/api/prepaid/draws/${drawId}`, { method: 'DELETE' });
  }

  function closePackage() {
    const writeOff = pkg.remaining_amount > 0 &&
      confirm(`V balíčku zbývá ${formatCurrency(pkg.remaining_amount)}. Doúčtovat zbytek do aktuálního měsíce?`);
    return call(`/api/prepaid/${pkg.id}/close`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ write_off: writeOff }),
    });
  }

  function deletePackage() {
    if (!confirm('Zrušit balíček? Platba se vrátí do původní kategorie a čerpání se smažou.')) return;
    return call(`/api/prepaid/${pkg.id}`, { method: 'DELETE' });
  }

  const closed = pkg.status === 'closed';

  return (
    <div className="prepaid-card">
      <div className="prepaid-card-header">
        <div>
          <div className="prepaid-card-name">{pkg.name}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {pkg.category_name}
            {pkg.valid_until && ` · platí do ${pkg.valid_until}`}
            {closed && ' · uzavřený'}
            {!pkg.transaction_id && ' · zdrojová platba smazána'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 600 }}>
            zbývá {pkg.remaining_units} z {pkg.units_total}
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>{formatCurrency(pkg.remaining_amount)}</div>
        </div>
      </div>

      {!closed && (
        <div className="prepaid-card-actions">
          <button className="btn btn-primary btn-sm" disabled={busy || pkg.remaining_units <= 0}
            onClick={() => addDraw(1)} title="Odečíst jednu jednotku">
            <Plus size={14} /> 1
          </button>
          {pkg.remaining_units >= 2 && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => addDraw(2)}>+2</button>
          )}
          {!compact && (
            <>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={closePackage}>
                <Lock size={14} /> Uzavřít
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={deletePackage}>
                <Trash2 size={14} /> Zrušit
              </button>
            </>
          )}
        </div>
      )}

      {!closed && !compact && (
        <form className="prepaid-card-draw-form" onSubmit={submitCustomDraw}>
          <div className="form-group">
            <label className="form-label">Datum čerpání</label>
            <input className="input" type="date" value={drawDate}
              max={todayISO()}
              onChange={e => setDrawDate(e.target.value)} style={{ maxWidth: 150 }} />
          </div>
          <div className="form-group">
            <label className="form-label">Počet jednotek</label>
            <input className="input" type="number" min="0.01" step="0.01" value={drawUnits}
              onChange={e => setDrawUnits(e.target.value)} style={{ maxWidth: 100 }} />
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
            <label className="form-label">Poznámka (nepovinné)</label>
            <input className="input" value={drawNote} placeholder="Co bylo odtiknuto"
              onChange={e => setDrawNote(e.target.value)} />
          </div>
          <button className="btn btn-ghost btn-sm" type="submit" disabled={busy || pkg.remaining_units <= 0}
            title="Zapsat čerpání se zadaným datem">
            Zapsat čerpání
          </button>
        </form>
      )}

      {!compact && (
        <>
          <button type="button" className="budget-subcat-toggle" onClick={() => setOpen(o => !o)}>
            {open ? '▾' : '▸'} historie čerpání ({pkg.draws?.length || 0})
          </button>
          {open && (
            <div className="budget-subcat-list">
              {(pkg.draws || []).map(d => (
                <div key={d.id} className="budget-subcat-row">
                  <span className="budget-subcat-name">
                    {`${+d.date.slice(8, 10)}. ${+d.date.slice(5, 7)}. ${d.date.slice(0, 4)}`}
                    {d.note && <span className="text-muted"> · {d.note}</span>}
                  </span>
                  <span className="budget-subcat-spent">
                    {d.units}× {formatCurrency(d.amount)}
                    <button className="btn btn-ghost btn-sm" disabled={busy}
                      onClick={() => removeDraw(d.id)} title="Smazat čerpání">×</button>
                  </span>
                </div>
              ))}
              {!(pkg.draws || []).length && <div className="text-muted">Zatím žádné čerpání.</div>}
            </div>
          )}
          {closed && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={deletePackage}>
              <Trash2 size={14} /> Zrušit balíček
            </button>
          )}
        </>
      )}
    </div>
  );
}
