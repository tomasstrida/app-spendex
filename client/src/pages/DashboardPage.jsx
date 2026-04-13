import { useAuth } from '../App';

export default function DashboardPage() {
  const { user, setUser } = useAuth();

  async function handleLogout() {
    await fetch('/auth/logout', { method: 'POST' });
    setUser(null);
  }

  return (
    <div style={{ padding: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <span style={{ fontSize: 20, fontWeight: 600 }}>Spendex</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ color: 'var(--text2)', fontSize: 14 }}>{user?.email}</span>
          <button className="btn btn-ghost" onClick={handleLogout}>Odhlásit se</button>
        </div>
      </div>
      <div style={{ color: 'var(--text2)', fontSize: 14 }}>
        Dashboard se brzy zobrazí. 👋
      </div>
    </div>
  );
}
