import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api from '../services/api';
import { useLiveReload } from '../live';
import { useApp } from '../context';
import { formatDate, money } from '../utils';
import { Field, Modal } from '../components/ui';

const blank = { name: '', platform: 'Meta Ads', platformName: '', product: '', date: new Date().toISOString().slice(0, 10), budget: 0, actualSpending: 0, manualOrders: '', manualDelivered: '', notes: '' };

export default function Advertising() {
  const { tx, allowed, fail, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(null);
  const [totals, setTotals] = useState({ spend: 0, revenue: 0 });
  const load = () => api.get('/campaigns').then((res) => { setRows(res.data.items); setTotals({ spend: res.data.spend, revenue: res.data.revenue }); }).catch(fail);
  useEffect(() => { load(); api.get('/products', { params: { limit: 200 } }).then((res) => setProducts(res.data.items)).catch(fail); }, []);
  useLiveReload(form ? [] : ['campaigns', 'orders'], load);
  return (
    <div className="grid gap-4">
      <div className="flex justify-between"><h1 className="text-2xl font-extrabold">{tx('Publicité', 'الإعلانات')}</h1>{allowed('advertising', 'create') && <button className="btn btn-primary" onClick={() => setForm({ ...blank })}>{tx('Campagne', 'حملة')}</button>}</div>
      <div className="grid gap-3 md:grid-cols-2"><article className="card p-4"><div className="label">{tx('Dépense', 'الإنفاق')}</div><div className="text-2xl font-extrabold">{money(totals.spend)}</div></article><article className="card p-4"><div className="label">{tx('CA livré lié', 'مبيعات مرتبطة')}</div><div className="text-2xl font-extrabold">{money(totals.revenue)}</div></article></div>
      <section className="card h-72 p-4"><ResponsiveContainer><BarChart data={rows}><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="actualSpending" fill="#be3a31" /><Bar dataKey="revenue" fill="#0f766e" /></BarChart></ResponsiveContainer></section>
      <div className="card table-wrap"><table className="data"><thead><tr><th>{tx('Campagne', 'الحملة')}</th><th>{tx('Plateforme', 'المنصة')}</th><th>{tx('Date', 'التاريخ')}</th><th className="num">CPA</th><th className="num">ROI</th><th>{tx('Actions', 'إجراءات')}</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row._id}><td className="font-bold">{row.name}<div className="text-xs">{row.productName}</div></td><td>{row.platform === 'Other' ? row.platformName || 'Other' : 'Meta Ads'}</td><td>{formatDate(row.date)}</td><td className="num">{row.cpa == null ? '—' : money(row.cpa)}</td><td className="num">{row.roi == null ? '—' : `${row.roi}%`}</td><td>{allowed('advertising', 'delete') && <div className="row-actions"><button className="btn btn-delete" type="button" onClick={async () => { await api.delete(`/campaigns/${row._id}`); load(); }}><Trash2 size={15} />{tx('Supprimer', 'حذف')}</button></div>}</td></tr>)}</tbody>
      </table></div>
      {form && <Modal title={tx('Campagne', 'حملة')} onClose={() => setForm(null)}><div className="grid gap-3">
        <Field label={tx('Nom', 'الاسم')}><input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label={tx('Plateforme', 'المنصة')}><select className="select" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}><option>Meta Ads</option><option>Other</option></select></Field>
        {form.platform === 'Other' && <Field label={tx('Nom de la plateforme', 'اسم المنصة')}><input className="field" value={form.platformName} onChange={(e) => setForm({ ...form, platformName: e.target.value })} /></Field>}
        <Field label={tx('Produit', 'المنتج')}><select className="select" value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}><option value="" />{products.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></Field>
        <Field label={tx('Date', 'التاريخ')}><input className="field" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label={tx('Budget', 'الميزانية')}><input className="field" type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></Field>
        <Field label={tx('Dépense réelle', 'الإنفاق الفعلي')}><input className="field" type="number" value={form.actualSpending} onChange={(e) => setForm({ ...form, actualSpending: e.target.value })} /></Field>
        <button className="btn btn-primary" onClick={async () => {
          try {
            await api.post('/campaigns', { ...form, product: form.product || null });
            notify.success({ title: tx('Campagne enregistrée', 'تم حفظ الحملة'), message: tx('La dépense publicitaire a été ajoutée.', 'تمت إضافة مصروف الإعلان.') });
            setForm(null);
            load();
          } catch (error) { fail(error); }
        }}>{tx('Enregistrer', 'حفظ')}</button>
      </div></Modal>}
    </div>
  );
}
