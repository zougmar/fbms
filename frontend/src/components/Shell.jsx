import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  LayoutDashboard, ClipboardList, Package, Truck, MapPin, Megaphone, Wallet,
  BarChart3, FileText, ListChecks, Users, LineChart, Settings, Sun, Moon, LogOut, Menu, Languages, UserPlus
} from 'lucide-react';
import { useApp } from '../context';
import { allowsPage } from '../utils';
import Avatar from './Avatar';
import { NotificationCenter } from '../notifications/ToastProvider';

const NAV = [
  { to: '/', icon: LayoutDashboard, fr: 'Tableau de bord', ar: 'لوحة التحكم', perm: ['dashboard', 'view'] },
  { to: '/orders', icon: ClipboardList, fr: 'Commandes', ar: 'الطلبات', perm: ['orders', 'view'] },
  { to: '/products', icon: Package, fr: 'Produits', ar: 'المنتجات', perm: ['products', 'view'] },
  { to: '/delivery', icon: Truck, fr: 'Livraison', ar: 'التوصيل', perm: ['delivery', 'view'] },
  { to: '/tasks', icon: ListChecks, fr: 'Tâches', ar: 'المهام', perm: ['tasks', 'view'] },
  { to: '/cities', icon: MapPin, fr: 'Villes & tarifs', ar: 'المدن والأسعار', perm: ['cities', 'view'] },
  { to: '/advertising', icon: Megaphone, fr: 'Publicité', ar: 'الإعلانات', perm: ['advertising', 'view'] },
  { to: '/finances', icon: Wallet, fr: 'Finances', ar: 'المالية', perm: ['finances', 'view'] },
  { to: '/reports', icon: BarChart3, fr: 'Rapports', ar: 'التقارير', perm: ['reports', 'view'] },
  { to: '/documents', icon: FileText, fr: 'Centre documents', ar: 'مركز الوثائق', perm: ['documents', 'view'] },
  { to: '/users', icon: Users, fr: 'Utilisateurs', ar: 'المستخدمون', perm: ['users', 'view'] },
  { to: '/users/performance', icon: LineChart, fr: 'Performance', ar: 'الأداء', perm: ['users', 'view'] },
  { to: '/settings', icon: Settings, fr: 'Paramètres', ar: 'الإعدادات', perm: ['settings', 'view'] }
];

export default function Shell() {
  const { user, tx, allowed, logout, lang, setLang, theme, setTheme } = useApp();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const items = NAV.filter((item) => allowsPage(user, allowed, item.to, item.perm));

  return (
    <div className="min-h-screen md:grid md:grid-cols-[260px_1fr]">
      <aside className={`sidebar fixed inset-y-0 z-40 w-[260px] p-4 transition md:static ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'} ${document.dir === 'rtl' ? 'right-0' : 'left-0'}`}>
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="grid h-11 w-11 place-items-center rounded-2xl font-extrabold text-white" style={{ background: 'var(--brand)' }}>FB</div>
          <div>
            <div className="text-lg font-extrabold text-white">FBMS</div>
            <div className="text-xs opacity-70">{tx('Gestion commerciale', 'إدارة الأعمال')}</div>
          </div>
        </div>
        <nav className="grid gap-1">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/' || item.to === '/users'} className="nav-link" onClick={() => setOpen(false)}>
              <item.icon size={18} /> {tx(item.fr, item.ar)}
            </NavLink>
          ))}
        </nav>
      </aside>
      {open && <button className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur" style={{ background: 'color-mix(in srgb, var(--bg) 88%, transparent)', borderColor: 'var(--line)' }}>
          <button className="btn btn-ghost md:hidden" onClick={() => setOpen(true)}><Menu size={18} /></button>
          <div className="text-sm" style={{ color: 'var(--muted)' }}>Full Business Management System · MAD</div>
          <div className="flex items-center gap-2">
            <NotificationCenter />
            <button className="btn btn-ghost" onClick={() => setLang(lang === 'fr' ? 'ar' : 'fr')}><Languages size={16} /> {lang === 'fr' ? 'عربي' : 'FR'}</button>
            <button className="btn btn-ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
            <button className="btn btn-ghost" onClick={() => navigate('/profile')}><Avatar user={user} size={28} /> {user?.name}</button>
            <button className="btn btn-ghost" type="button" onClick={() => window.open('/login?switch=1', '_blank')}><UserPlus size={16} /> {tx('Autre compte', 'حساب آخر')}</button>
            <button className="btn btn-ghost" onClick={async () => { await logout(); navigate('/login'); }}><LogOut size={16} /></button>
          </div>
        </header>
        <main className="p-4 md:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
