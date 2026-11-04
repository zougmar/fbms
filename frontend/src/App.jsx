import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './context';
import { allowsPage } from './utils';
import Shell from './components/Shell';
import Login from './pages/Login';
import Forgot from './pages/Forgot';
import Reset from './pages/Reset';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Products from './pages/Products';
import Delivery from './pages/Delivery';
import Cities from './pages/Cities';
import Advertising from './pages/Advertising';
import Finances from './pages/Finances';
import Reports from './pages/Reports';
import Documents from './pages/Documents';
import Users from './pages/Users';
import Performance from './pages/Performance';
import Tasks from './pages/Tasks';
import Scan from './pages/Scan';
import Settings from './pages/Settings';
import Profile from './pages/Profile';

const RULES = {
  '/': ['dashboard', 'view'],
  '/orders': ['orders', 'view'],
  '/products': ['products', 'view'],
  '/delivery': ['delivery', 'view'],
  '/cities': ['cities', 'view'],
  '/advertising': ['advertising', 'view'],
  '/finances': ['finances', 'view'],
  '/reports': ['reports', 'view'],
  '/documents': ['documents', 'view'],
  '/tasks': ['tasks', 'view'],
  '/users/performance': ['users', 'view'],
  '/users': ['users', 'view'],
  '/settings': ['settings', 'view']
};

function canOpen(path, perm, allowed, user) {
  return allowsPage(user, allowed, path, perm);
}

function LoginGate() {
  const { user, loading } = useApp();
  const location = useLocation();
  const switching = new URLSearchParams(location.search).get('switch') === '1';
  if (loading) return <div className="grid min-h-screen place-items-center">FBMS</div>;
  if (user && !switching) return <Navigate to="/" replace />;
  return <Login />;
}

function Guard() {
  const { user, loading, allowed } = useApp();
  const location = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center">FBMS</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  const rule = Object.entries(RULES).find(([path]) => location.pathname === path || (path !== '/' && location.pathname.startsWith(`${path}/`)) || (path !== '/' && location.pathname === path));
  if (rule && !canOpen(rule[0], rule[1], allowed, user)) {
    const next = Object.entries(RULES).find(([path, perm]) => canOpen(path, perm, allowed, user));
    const target = next && next[0] !== location.pathname ? next[0] : '/profile';
    return <Navigate to={target} replace />;
  }
  return <Shell />;
}

export default function App() {
  const { user, loading } = useApp();
  return (
    <Routes>
      <Route path="/login" element={<LoginGate />} />
      <Route path="/forgot-password" element={<Forgot />} />
      <Route path="/reset-password" element={<Reset />} />
      <Route element={<Guard />}>
        <Route index element={<Dashboard />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="products" element={<Products />} />
        <Route path="delivery" element={<Delivery />} />
        <Route path="cities" element={<Cities />} />
        <Route path="advertising" element={<Advertising />} />
        <Route path="finances" element={<Finances />} />
        <Route path="reports" element={<Reports />} />
        <Route path="documents" element={<Documents />} />
        <Route path="users" element={<Users />} />
        <Route path="users/performance" element={<Performance />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="scan/:token" element={<Scan />} />
        <Route path="settings" element={<Settings />} />
        <Route path="profile" element={<Profile />} />
      </Route>
    </Routes>
  );
}
