import { useEffect, useState } from 'react';
import { BadgeCheck, Ban, Clock3, Megaphone, PackageCheck, Percent, Receipt, RotateCcw, ShoppingBag, TrendingUp, Truck, Undo2, Wallet } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api from '../services/api';
import { useLiveReload } from '../live';
import { useApp } from '../context';
import { money } from '../utils';
import { InfoAlert, SuccessAlert, WarningAlert } from '../notifications/alerts';

const COLORS = ['#0f766e', '#c47b12', '#1d4ed8', '#be3a31', '#0f9f6e', '#7c3aed', '#64748b'];

export default function Dashboard() {
  const { tx, fail, allowed } = useApp();
  const [filters, setFilters] = useState({ from: '', to: '', city: '', product: '', status: '' });
  const [cities, setCities] = useState([]);
  const [products, setProducts] = useState([]);
  const [data, setData] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [stockReady, setStockReady] = useState(false);

  useEffect(() => {
    api.get('/cities', { params: { active: true } }).then((res) => setCities(res.data.items)).catch(fail);
    api.get('/products', { params: { limit: 200 } }).then((res) => setProducts(res.data.items)).catch(fail);
    api.get('/products/low-stock').then((res) => { setLowStock(res.data.items || []); setStockReady(true); }).catch(() => {});
  }, []);

  const loadDashboard = () => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
    api.get('/dashboard', { params }).then((res) => setData(res.data)).catch(fail);
    api.get('/products/low-stock').then((res) => { setLowStock(res.data.items || []); setStockReady(true); }).catch(() => {});
  };
  useEffect(() => { loadDashboard(); }, [filters]);
  useLiveReload(['orders', 'products', 'finances', 'campaigns'], loadDashboard);

  const kpis = data?.kpis || {};
  const cards = [
    ['totalOrders', tx('Commandes', 'الطلبات'), false, '', ShoppingBag, 'teal'],
    ['confirmedOrders', tx('Confirmées', 'المؤكدة'), false, '', BadgeCheck, 'blue'],
    ['pendingOrders', tx('À confirmer', 'بانتظار التأكيد'), false, '', Clock3, 'amber'],
    ['shippedOrders', tx('Expédiées', 'المشحونة'), false, '', Truck, 'violet'],
    ['deliveredOrders', tx('Livrées', 'المسلّمة'), false, '', PackageCheck, 'green'],
    ['returnedOrders', tx('Retours', 'المرتجعة'), false, '', Undo2, 'orange'],
    ['cancelledOrders', tx('Annulées', 'الملغاة'), false, '', Ban, 'red'],
    ['totalRevenue', tx('Chiffre d\'affaires', 'رقم المعاملات'), true, '', Wallet, 'teal'],
    ['netProfit', tx('Bénéfice net', 'الربح الصافي'), true, '', TrendingUp, 'green'],
    ['deliverySuccessRate', tx('Taux de livraison', 'نسبة التسليم'), false, '%', Percent, 'blue'],
    ['returnRate', tx('Taux de retour', 'نسبة الإرجاع'), false, '%', RotateCcw, 'orange'],
    ['advertisingExpenses', tx('Publicité', 'الإعلانات'), true, '', Megaphone, 'red'],
    ['averageOrderValue', tx('Panier moyen', 'متوسط الطلب'), true, '', Receipt, 'violet']
  ].filter(([key]) => kpis[key] !== undefined);

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-extrabold">{tx('Tableau de bord', 'لوحة التحكم')}</h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>{tx('Chiffres calculés depuis MongoDB Atlas.', 'الأرقام محسوبة من MongoDB Atlas.')}</p>
      </div>
      <div className="grid gap-3">
        {lowStock.length > 0 && (
          <WarningAlert
            title={tx('Stock faible', 'مخزون منخفض')}
            message={lowStock.map((item) => `${item.name} (${item.stock})`).join(' · ')}
          />
        )}
        {stockReady && lowStock.length === 0 && products.length > 0 && (
          <SuccessAlert
            title={tx('Stock suffisant', 'المخزون كافٍ')}
            message={tx('Aucun produit n’est sous le seuil.', 'لا يوجد منتج تحت الحد الأدنى.')}
          />
        )}
        {kpis.pendingOrders > 0 && (
          <WarningAlert
            title={tx('Commandes à confirmer', 'طلبات بانتظار التأكيد')}
            message={tx(`${kpis.pendingOrders} commande(s) attendent une confirmation.`, `${kpis.pendingOrders} طلبات بانتظار التأكيد.`)}
          />
        )}
        <InfoAlert
          title={tx('Données en direct', 'بيانات مباشرة')}
          message={tx('Les indicateurs viennent des commandes enregistrées.', 'المؤشرات مأخوذة من الطلبات المسجلة.')}
        />
      </div>
      <div className="card grid gap-3 p-4 md:grid-cols-5">
        <input className="field" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <input className="field" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        <select className="select" value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })}>
          <option value="">{tx('Toutes les villes', 'كل المدن')}</option>
          {cities.map((city) => <option key={city._id} value={city._id}>{city.name}</option>)}
        </select>
        <select className="select" value={filters.product} onChange={(e) => setFilters({ ...filters, product: e.target.value })}>
          <option value="">{tx('Tous les produits', 'كل المنتجات')}</option>
          {products.map((product) => <option key={product._id} value={product._id}>{product.name}</option>)}
        </select>
        <select className="select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">{tx('Tous les statuts', 'كل الحالات')}</option>
          {['À confirmer', 'Confirmée', 'En préparation', 'Expédiée', 'Livrée', 'Retour', 'Annulée'].map((status) => <option key={status}>{status}</option>)}
        </select>
      </div>
      <div className="kpi-grid">
        {cards.map(([key, label, isMoney, suffix, Icon, tone]) => (
          <article key={key} className={`kpi-card kpi-${tone}`}>
            <span className="kpi-icon" aria-hidden="true"><Icon size={20} strokeWidth={2.2} /></span>
            <div className="min-w-0">
              <p className="kpi-label">{label}</p>
              <p className="kpi-value">{isMoney ? money(kpis[key]) : `${kpis[key] ?? 0}${suffix || ''}`}</p>
            </div>
          </article>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Chart title={tx('Performance des ventes', 'أداء المبيعات')}>
          <AreaChart data={data?.sales || []}>
            <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip />
            <Area dataKey="orders" stroke="#0f766e" fill="#0f766e33" />
            {allowed('finances', 'view') && <Area dataKey="revenue" stroke="#c47b12" fill="#c47b1233" />}
          </AreaChart>
        </Chart>
        <Chart title={tx('Commandes par statut', 'الطلبات حسب الحالة')}>
          <PieChart>
            <Pie data={data?.ordersByStatus || []} dataKey="value" nameKey="status" outerRadius={90}>
              {(data?.ordersByStatus || []).map((entry, index) => <Cell key={entry.status} fill={COLORS[index % COLORS.length]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </Chart>
        <Chart title={tx('Commandes par ville', 'الطلبات حسب المدينة')}>
          <BarChart data={data?.ordersByCity || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="city" /><YAxis /><Tooltip /><Bar dataKey="orders" fill="#0f766e" /></BarChart>
        </Chart>
        <Chart title={tx('Produits les plus vendus', 'المنتجات الأكثر مبيعا')}>
          <BarChart data={data?.topProducts || []} layout="vertical"><XAxis type="number" /><YAxis type="category" dataKey="product" width={110} /><Tooltip /><Bar dataKey="quantity" fill="#1d4ed8" /></BarChart>
        </Chart>
        <Chart title={tx('Livraison', 'التوصيل')}>
          <BarChart data={data?.deliveryPerformance || []}><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="value" fill="#0f9f6e" /></BarChart>
        </Chart>
        {allowed('finances', 'view') && (
          <Chart title={tx('Analyse du bénéfice', 'تحليل الربح')}>
            <BarChart data={data?.profitByMonth || []}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Bar dataKey="revenue" fill="#0f766e" /><Bar dataKey="profit" fill="#c47b12" /></BarChart>
          </Chart>
        )}
        {data?.advertising && (
          <Chart title={tx('Publicité', 'الإعلانات')}>
            <BarChart data={data.advertising}><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="spend" fill="#be3a31" /><Bar dataKey="revenue" fill="#0f766e" /></BarChart>
          </Chart>
        )}
      </div>
    </div>
  );
}

function Chart({ title, children }) {
  return (
    <section className="card p-4">
      <h2 className="mb-3 font-extrabold">{title}</h2>
      <div className="h-64"><ResponsiveContainer>{children}</ResponsiveContainer></div>
    </section>
  );
}
