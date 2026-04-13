import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import '../App.css';

export default function ResetPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Heslo musí mít alespoň 8 znaků.'); return; }
    setLoading(true);
    try {
      const r = await fetch('/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Chyba.'); return; }
      setDone(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch {
      setError('Chyba připojení.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-layout">
        <div className="auth-card">
          <div className="alert alert-error">Neplatný odkaz pro obnovení hesla.</div>
          <div className="auth-footer"><Link to="/login">Přihlásit se</Link></div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div style={{ textAlign: 'center' }}>
          <div className="auth-logo-mark">S</div>
          <div className="auth-title">Nové heslo</div>
        </div>

        {done ? (
          <div className="alert alert-success">Heslo bylo změněno. Přesměrování…</div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label className="form-label">Nové heslo</label>
              <input
                className="input"
                type="password"
                placeholder="min. 8 znaků"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoFocus
              />
            </div>
            <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
              {loading ? 'Ukládání…' : 'Nastavit heslo'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
