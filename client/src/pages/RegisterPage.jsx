import { useState } from 'react';
import { Link } from 'react-router-dom';
import '../App.css';

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  function set(k) { return e => setForm(f => ({ ...f, [k]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) {
      setError('Heslo musí mít alespoň 8 znaků.');
      return;
    }
    setLoading(true);
    try {
      const r = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Chyba registrace.'); return; }
      setDone(true);
    } catch {
      setError('Chyba připojení.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="auth-layout">
        <div className="auth-card">
          <div style={{ textAlign: 'center' }}>
            <div className="auth-logo-mark">S</div>
            <div className="auth-title">Zkontrolujte e-mail</div>
          </div>
          <div className="alert alert-success">
            Poslali jsme vám ověřovací odkaz na <strong>{form.email}</strong>. Klikněte na něj pro aktivaci účtu.
          </div>
          <div className="auth-footer">
            <Link to="/login">Zpět na přihlášení</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div style={{ textAlign: 'center' }}>
          <div className="auth-logo-mark">S</div>
          <div className="auth-title">Vytvořit účet</div>
        </div>

        <a href="/auth/google" className="btn btn-ghost btn-google">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Registrovat přes Google
        </a>

        <div className="divider">nebo</div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-group">
            <label className="form-label">Jméno</label>
            <input className="input" type="text" placeholder="Jan Novák" value={form.name} onChange={set('name')} autoFocus />
          </div>

          <div className="form-group">
            <label className="form-label">E-mail</label>
            <input className="input" type="email" placeholder="vas@email.cz" value={form.email} onChange={set('email')} required />
          </div>

          <div className="form-group">
            <label className="form-label">Heslo</label>
            <input className="input" type="password" placeholder="min. 8 znaků" value={form.password} onChange={set('password')} required />
          </div>

          <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
            {loading ? 'Registrace…' : 'Vytvořit účet'}
          </button>
        </form>

        <div className="auth-footer">
          Máte účet? <Link to="/login">Přihlásit se</Link>
        </div>
      </div>
    </div>
  );
}
