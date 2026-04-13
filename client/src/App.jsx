import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, createContext, useContext } from 'react';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPage from './pages/ForgotPage';
import ResetPage from './pages/ResetPage';
import DashboardPage from './pages/DashboardPage';
import TransactionsPage from './pages/TransactionsPage';
import CategoriesPage from './pages/CategoriesPage';
import BudgetsPage from './pages/BudgetsPage';
import ImportPage from './pages/ImportPage';
import SettingsPage from './pages/SettingsPage';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    fetch('/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(u => setUser(u))
      .catch(() => setUser(null));
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

function RequireAuth({ children }) {
  const { user } = useAuth();
  if (user === undefined) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function GuestOnly({ children }) {
  const { user } = useAuth();
  if (user === undefined) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
}

const R = ({ el }) => <RequireAuth>{el}</RequireAuth>;

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login"    element={<GuestOnly><LoginPage /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
          <Route path="/forgot"   element={<GuestOnly><ForgotPage /></GuestOnly>} />
          <Route path="/reset"    element={<ResetPage />} />
          <Route path="/"             element={<R el={<DashboardPage />} />} />
          <Route path="/transactions" element={<R el={<TransactionsPage />} />} />
          <Route path="/categories"   element={<R el={<CategoriesPage />} />} />
          <Route path="/budgets"      element={<R el={<BudgetsPage />} />} />
          <Route path="/import"       element={<R el={<ImportPage />} />} />
          <Route path="/settings"     element={<R el={<SettingsPage />} />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
