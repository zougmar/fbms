import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import api from '../services/api';
import { useLiveReload } from '../live';
import { useApp } from '../context';
import { money } from '../utils';
import { Field, Modal } from '../components/ui';

export default function Cities() {
  const { tx, allowed, fail, notify } = useApp();
  const [cities, setCities] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [form, setForm] = useState(null);
  const [carrier, setCarrier] = useState(null);
  const load = () => {
    api.get('/cities').then((res) => setCities(res.data.items)).catch(fail);
    api.get('/shipping-companies').then((res) => setCarriers(res.data.items)).catch(fail);
  };
  useEffect(() => { load(); }, []);
  useLiveReload(form || carrier ? [] : ['cities'], load);
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-extrabold">{tx('Villes et sociétés', 'المدن وشركات النقل')}</h1>
        {allowed('settings', 'edit') && <button className="btn btn-primary" onClick={() => setForm({ name: '', shippingPrice: 35, zone: '', notes: '', active: true })}>{tx('Ville', 'مدينة')}</button>}
      </div>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>{tx('Chaque ville a son propre tarif. Rien n\'est supposé universel.', 'لكل مدينة ثمنها الخاص. لا يوجد سعر موحد.')}</p>
      <div className="card table-wrap"><table className="data"><thead><tr><th>{tx('Ville', 'المدينة')}</th><th>{tx('Zone', 'المنطقة')}</th><th className="num">{tx('Livraison', 'التوصيل')}</th><th>{tx('Actions', 'إجراءات')}</th></tr></thead>
        <tbody>{cities.map((city) => <tr key={city._id}><td className="font-bold">{city.name}</td><td>{city.zone}</td><td className="num">{money(city.shippingPrice)}</td><td>{allowed('settings', 'edit') && <div className="row-actions"><button className="btn btn-edit" type="button" onClick={() => setForm(city)}><Pencil size={15} />{tx('Modifier', 'تعديل')}</button></div>}</td></tr>)}</tbody>
      </table></div>
      <div className="flex items-center justify-between"><h2 className="text-xl font-extrabold">{tx('Sociétés de livraison', 'شركات التوصيل')}</h2>{allowed('settings', 'edit') && <button className="btn btn-ghost" onClick={() => setCarrier({ name: '', phone: '', notes: '', active: true })}>{tx('Ajouter', 'إضافة')}</button>}</div>
      <div className="card table-wrap"><table className="data"><thead><tr><th>{tx('Société', 'الشركة')}</th><th>{tx('Téléphone', 'الهاتف')}</th><th>{tx('Active', 'نشطة')}</th></tr></thead>
        <tbody>{carriers.map((item) => <tr key={item._id}><td>{item.name}</td><td dir="ltr">{item.phone}</td><td>{item.active ? tx('Oui', 'نعم') : tx('Non', 'لا')}</td></tr>)}</tbody>
      </table></div>
      {form && <Modal title={tx('Ville', 'مدينة')} onClose={() => setForm(null)}><div className="grid gap-3">
        <Field label={tx('Nom', 'الاسم')}><input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label={tx('Prix MAD', 'الثمن')}><input className="field" type="number" value={form.shippingPrice} onChange={(e) => setForm({ ...form, shippingPrice: e.target.value })} /></Field>
        <Field label={tx('Zone', 'المنطقة')}><input className="field" value={form.zone || ''} onChange={(e) => setForm({ ...form, zone: e.target.value })} /></Field>
        <Field label={tx('Notes', 'ملاحظات')}><textarea className="area" value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <button className="btn btn-primary" onClick={async () => {
          try {
            if (form._id) await api.put(`/cities/${form._id}`, form);
            else await api.post('/cities', form);
            notify.success({ title: tx('Ville enregistrée', 'تم حفظ المدينة'), message: tx('Le tarif de livraison est à jour.', 'تم تحديث سعر التوصيل.') });
            setForm(null);
            load();
          } catch (error) { fail(error); }
        }}>{tx('Enregistrer', 'حفظ')}</button>
      </div></Modal>}
      {carrier && <Modal title={tx('Société', 'شركة')} onClose={() => setCarrier(null)}><div className="grid gap-3">
        <Field label={tx('Nom', 'الاسم')}><input className="field" value={carrier.name} onChange={(e) => setCarrier({ ...carrier, name: e.target.value })} /></Field>
        <Field label={tx('Téléphone', 'الهاتف')}><input className="field" value={carrier.phone} onChange={(e) => setCarrier({ ...carrier, phone: e.target.value })} /></Field>
        <button className="btn btn-primary" onClick={async () => { await api.post('/shipping-companies', carrier); setCarrier(null); load(); }}>{tx('Enregistrer', 'حفظ')}</button>
      </div></Modal>}
    </div>
  );
}
