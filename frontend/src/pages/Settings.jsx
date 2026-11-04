import { useEffect, useState } from 'react';
import api from '../services/api';
import { useApp } from '../context';
import { formatDate } from '../utils';
import { Field } from '../components/ui';

export default function Settings() {
  const { tx, allowed, fail, notify } = useApp();
  const [form, setForm] = useState(null);
  const [activity, setActivity] = useState([]);
  useEffect(() => {
    api.get('/settings').then((res) => setForm(res.data.item)).catch(fail);
    api.get('/activity').then((res) => setActivity(res.data.items)).catch(fail);
  }, []);
  if (!form) return null;
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-extrabold">{tx('Paramètres', 'الإعدادات')}</h1>
      <form className="card grid gap-3 p-5 md:grid-cols-2" onSubmit={async (event) => {
        event.preventDefault();
        try {
          const res = await api.put('/settings', form);
          setForm(res.data.item);
          notify.success({
            title: tx('Paramètres enregistrés', 'تم حفظ الإعدادات'),
            message: tx('Les informations de la société sont à jour.', 'تم تحديث معلومات الشركة.')
          });
        } catch (error) { fail(error); }
      }}>
        <Field label={tx('Nom commercial', 'الاسم التجاري')}><input className="field" value={form.companyName || ''} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></Field>
        <Field label={tx('Raison sociale', 'الاسم القانوني')}><input className="field" value={form.legalName || ''} onChange={(e) => setForm({ ...form, legalName: e.target.value })} /></Field>
        <Field label={tx('Adresse', 'العنوان')}><input className="field" value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        <Field label={tx('Ville', 'المدينة')}><input className="field" value={form.city || ''} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
        <Field label={tx('Téléphone', 'الهاتف')}><input className="field" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Email"><input className="field" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="ICE"><input className="field" value={form.ice || ''} onChange={(e) => setForm({ ...form, ice: e.target.value })} /></Field>
        <Field label={tx('Seuil de stock', 'حد المخزون')}><input className="field" type="number" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} /></Field>
        <div className="md:col-span-2 text-sm" style={{ color: 'var(--muted)' }}>{tx('Devise fixée', 'العملة ثابتة')}: MAD · MongoDB Atlas / fbms</div>
        {allowed('settings', 'edit') && <button className="btn btn-primary md:col-span-2 w-fit">{tx('Enregistrer', 'حفظ')}</button>}
      </form>
      <section className="card p-5">
        <h2 className="mb-3 font-extrabold">{tx('Journal', 'سجل النشاط')}</h2>
        <ul className="grid gap-2 text-sm">{activity.map((item) => <li key={item._id}>{formatDate(item.createdAt)} · {item.userName} · {item.action} · {item.entity}</li>)}</ul>
      </section>
    </div>
  );
}
