import { useEffect, useState } from 'react';
import api, { downloadFile } from '../services/api';
import { useApp } from '../context';
import { formatDate } from '../utils';
import { WarningAlert } from '../notifications/alerts';

const CATALOG = {
  orders: ['individual', 'all', 'confirmed', 'delivered', 'returned', 'cancelled', 'daily', 'monthly', 'by-city', 'by-product', 'by-range'],
  delivery: ['bon', 'manifest', 'labels', 'report', 'returns', 'by-city', 'by-carrier', 'reconciliation'],
  finance: ['daily', 'weekly', 'monthly', 'revenue', 'expenses', 'pnl', 'cashflow', 'ads', 'product-profit'],
  products: ['catalog', 'pricelist', 'stock', 'low-stock', 'performance'],
  dashboard: ['summary']
};

export default function Documents() {
  const { tx, allowed, fail, notify } = useApp();
  const [category, setCategory] = useState('orders');
  const [type, setType] = useState('all');
  const [filters, setFilters] = useState({ from: '', to: '', status: '', city: '', product: '', customer: '', shippingCompany: '', orderId: '' });
  const [cities, setCities] = useState([]);
  const [products, setProducts] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [history, setHistory] = useState([]);
  const lang = localStorage.getItem('fbms_lang') || 'fr';

  useEffect(() => {
    api.get('/cities').then((res) => setCities(res.data.items)).catch(fail);
    api.get('/products', { params: { limit: 200 } }).then((res) => setProducts(res.data.items)).catch(fail);
    api.get('/shipping-companies').then((res) => setCarriers(res.data.items)).catch(fail);
    api.get('/orders', { params: { limit: 50 } }).then((res) => setOrders(res.data.items)).catch(() => {});
    api.get('/documents').then((res) => setHistory(res.data.items)).catch(fail);
  }, []);

  const params = () => Object.fromEntries(Object.entries({ category, type, lang, ...filters }).filter(([, value]) => value));
  const financialLocked = (category === 'finance' || category === 'dashboard') && !allowed('finances', 'view') && !allowed('documents', 'financial');

  const preview = async () => {
    try {
      const res = await api.get('/documents/preview', { params: params(), responseType: 'text' });
      const popup = window.open('', '_blank');
      if (!popup) {
        notify.warning({
          title: tx('Aperçu bloqué', 'تم حظر المعاينة'),
          message: tx('Autorisez les fenêtres popup pour afficher le PDF.', 'اسمح بالنوافذ المنبثقة لعرض الملف.')
        });
        return;
      }
      popup.document.write(res.data);
      popup.document.close();
      const hist = await api.get('/documents');
      setHistory(hist.data.items);
      notify.info({
        title: tx('Aperçu prêt', 'المعاينة جاهزة'),
        message: tx('Le document s’ouvre dans un nouvel onglet.', 'تفتح الوثيقة في تبويب جديد.')
      });
    } catch (error) { fail(error); }
  };

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-extrabold">FBMS Document Center</h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>{tx('PDF générés depuis les données réelles, en français ou en arabe.', 'ملفات PDF من البيانات الحقيقية بالفرنسية أو العربية.')}</p>
      </div>
      <div className="card grid gap-3 p-4 md:grid-cols-3">
        <select className="select" value={category} onChange={(e) => { setCategory(e.target.value); setType(CATALOG[e.target.value][0]); }}>
          {Object.keys(CATALOG).map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>{CATALOG[category].map((item) => <option key={item}>{item}</option>)}</select>
        <select className="select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">{tx('Statut', 'الحالة')}</option>{['À confirmer','Confirmée','En préparation','Expédiée','Livrée','Retour','Annulée'].map((item) => <option key={item}>{item}</option>)}</select>
        <input className="field" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <input className="field" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        <select className="select" value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })}><option value="">{tx('Ville', 'المدينة')}</option>{cities.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select>
        <select className="select" value={filters.product} onChange={(e) => setFilters({ ...filters, product: e.target.value })}><option value="">{tx('Produit', 'المنتج')}</option>{products.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select>
        <input className="field" placeholder={tx('Client', 'الزبون')} value={filters.customer} onChange={(e) => setFilters({ ...filters, customer: e.target.value })} />
        <select className="select" value={filters.shippingCompany} onChange={(e) => setFilters({ ...filters, shippingCompany: e.target.value })}><option value="">{tx('Société', 'الشركة')}</option>{carriers.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select>
        {type === 'individual' && <select className="select md:col-span-3" value={filters.orderId} onChange={(e) => setFilters({ ...filters, orderId: e.target.value })}><option value="">{tx('Choisir une commande', 'اختر طلبا')}</option>{orders.map((item) => <option key={item._id} value={item._id}>{item.orderNumber} · {item.customerName}</option>)}</select>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-ghost" disabled={financialLocked || !allowed('documents', 'generate')} onClick={preview}>{tx('Aperçu', 'معاينة')}</button>
        <button className="btn btn-primary" disabled={financialLocked || !allowed('documents', 'generate')} onClick={async () => {
          try {
            await downloadFile('/documents/pdf', params(), `fbms-${category}-${type}.pdf`);
            const res = await api.get('/documents');
            setHistory(res.data.items);
            notify.success({ title: tx('PDF généré', 'تم إنشاء PDF'), message: tx('Le fichier a été téléchargé.', 'تم تنزيل الملف.') });
          } catch (error) {
            notify.error({ title: tx('PDF non généré', 'تعذر إنشاء PDF'), message: error.response?.data?.message || error.message });
          }
        }}>{tx('Télécharger PDF', 'تنزيل PDF')}</button>
        <button className="btn btn-ghost" disabled={financialLocked || !allowed('documents', 'generate')} onClick={preview}>{tx('Imprimer via l\'aperçu', 'اطبع من المعاينة')}</button>
      </div>
      {financialLocked && <WarningAlert title={tx('Accès restreint', 'وصول محدود')} message={tx('Les documents financiers demandent une permission finance.', 'الوثائق المالية تتطلب صلاحية المالية.')} />}
      <div className="card table-wrap"><table className="data"><thead><tr><th>{tx('Référence', 'المرجع')}</th><th>{tx('Document', 'الوثيقة')}</th><th>{tx('Date', 'التاريخ')}</th></tr></thead>
        <tbody>{history.map((item) => <tr key={item._id}><td>{item.reference}</td><td>{item.title}</td><td>{formatDate(item.createdAt)}</td></tr>)}</tbody>
      </table></div>
    </div>
  );
}
