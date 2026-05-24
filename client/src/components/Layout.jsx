import { useState, useEffect } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';

export default function Layout({ children }) {
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    const onResize = () => { if (window.innerWidth > 768) setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [navOpen]);

  useEffect(() => {
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [navOpen]);

  return (
    <div className="app-layout">
      <button
        type="button"
        className="mobile-nav-toggle"
        onClick={() => setNavOpen(true)}
        aria-label="Otevřít menu"
      >
        <Menu size={20} />
        <span className="mobile-nav-toggle-brand">
          <span className="mobile-nav-toggle-mark">$</span>
          Spendex
        </span>
      </button>

      {navOpen && <div className="sidebar-overlay" onClick={() => setNavOpen(false)} />}

      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

      <main className="app-main">
        {children}
      </main>
    </div>
  );
}
