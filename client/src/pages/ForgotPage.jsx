import { useState } from 'react';
import { Link } from 'react-router-dom';
import '../App.css';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    await fetch('/auth/forgot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => {});
    setLoading(false);
    setDone(true);
  }

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div style={{ textAlign: 'center' }}>
          <div className="auth-logo-mark">S</div>
          <div className="auth-title">Obnovit heslo</div>
        </div>

        {done ? (
          <>
            <div className="alert alert-success">
              Pokud účet existuje, pošleme vám odkaz pro obnovení hesla.
            </div>
            <div className="auth-footer"><Link to="/login">Zpět na přihlášení</Link></div>
          </>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">E-mail</label>
              <input
                className="input"
                type="email"
                placeholder="vas@email.cz"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
              {loading ? 'Odesílání…' : 'Odeslat odkaz'}
            </button>
            <div className="auth-footer"><Link to="/login">Zpět na přihlášení</Link></div>
          </form>
        )}
      </div>
    </div>
  );
}
