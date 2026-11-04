import { useEffect, useState } from 'react';
import { FileText, Trash2 } from 'lucide-react';
import api, { downloadFile } from '../services/api';
import { useLiveReload } from '../live';
import { useApp } from '../context';
import { formatDate, money } from '../utils';
import { Field, Modal } from '../components/ui';

export default function Finances() {
  const { tx, allowed, fail, notify } = useApp();
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ from: '', to: '' });
  const [form, setForm] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const load = () => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
    api.get('/finances/summary', { params }).then((res) => setSummary(res.data)).catch(fail);
    api.get('/finances/transactions', { params }).then((res) => setRows(res.data.items)).catch(fail);
  };
  useEffect(() => { load(); }, [filters]);
  useLiveReload(form ? [] : ['finances', 'orders'], load);
  const lines = summary ? [
    [tx('CA livré', 'مبيعات مسلّمة'), summary.totalRevenue],
    [tx('Coût produits', 'تكلفة المنتجات'), summary.cogs],
    [tx('Livraison', 'التوصيل'), summary.shippingCosts],
    [tx('Publicité', 'الإعلان'), summary.advertisingExpenses],
    [tx('Frais commandes', 'مصاريف الطلبات'), summary.additionalExpenses],
    [tx('Charges manuelles', 'مصاريف يدوية'), summary.manualExpenses],
    [tx('Produits manuels', 'مداخيل يدوية'), summary.manualIncome],
    [tx('Bénéfice net', 'الربح الصافي'), summary.netProfit]
  ] : [];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap justify-between gap-2"><h1 className="text-2xl font-extrabold">{tx('Finances', 'المالية')}</h1>
        <div className="flex gap-2"><button className="btn btn-ghost" type="button" disabled={pdfBusy} onClick={async () => {
          setPdfBusy(true);
          try {
            await downloadFile('/documents/pdf', { category: 'finance', type: 'pnl', ...filters, lang: localStorage.getItem('fbms_lang') || 'fr' }, 'fbms-finances.pdf');
            notify.success({ title: tx('PDF généré', 'تم إنشاء PDF'), message: tx('Le compte de résultat a été téléchargé.', 'تم تنزيل قائمة النتائج.') });
          } catch (error) {
            notify.error({ title: tx('PDF non généré', 'تعذر إنشاء PDF'), message: error.response?.data?.message || error.message });
          } finally {
            setPdfBusy(false);
          }
        }}><FileText size={15} />PDF</button><button className="btn btn-ghost" onClick={async () => {
          try {
            await downloadFile('/finances/export', filters, 'fbms-finances.xlsx');
            notify.success({ title: tx('Export Excel', 'تصدير Excel'), message: tx('Le fichier financier a été téléchargé.', 'تم تنزيل الملف المالي.') });
          } catch (error) { fail(error); }
        }}>Excel</button>{allowed('finances', 'create') && <button className="btn btn-primary" onClick={() => setForm({ type: 'expense', category: '', amount: '', date: new Date().toISOString().slice(0, 10), description: '' })}>{tx('Transaction', 'عملية')}</button>}</div>
      </div>
      <div className="card grid gap-3 p-4 md:grid-cols-2"><input className="field" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /><input className="field" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
      <div className="grid gap-3 md:grid-cols-4">{lines.map(([label, value]) => <article key={label} className="card p-4"><div className="text-xs font-bold uppercase" style={{ color: 'var(--muted)' }}>{label}</div><div className="mt-2 text-xl font-extrabold">{money(value)}</div></article>)}</div>
      <div className="card table-wrap"><table className="data"><thead><tr><th>{tx('Date', 'التاريخ')}</th><th>{tx('Type', 'النوع')}</th><th>{tx('Catégorie', 'الفئة')}</th><th className="num">{tx('Montant', 'المبلغ')}</th><th>{tx('Actions', 'إجراءات')}</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row._id}><td>{formatDate(row.date)}</td><td>{row.type}</td><td>{row.category}<div className="text-xs">{row.description}</div></td><td className="num">{money(row.amount)}</td><td>{allowed('finances', 'delete') && <div className="row-actions"><button className="btn btn-delete" type="button" onClick={async () => { await api.delete(`/finances/transactions/${row._id}`); load(); }}><Trash2 size={15} />{tx('Supprimer', 'حذف')}</button></div>}</td></tr>)}</tbody>
      </table></div>
      {form && <Modal title={tx('Transaction manuelle', 'عملية يدوية')} onClose={() => setForm(null)}><div className="grid gap-3">
        <Field label={tx('Type', 'النوع')}><select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="expense">{tx('Dépense', 'مصروف')}</option><option value="income">{tx('Recette', 'مدخول')}</option></select></Field>
        <Field label={tx('Catégorie', 'الفئة')}><input className="field" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
        <Field label={tx('Montant', 'المبلغ')}><input className="field" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
        <Field label={tx('Date', 'التاريخ')}><input className="field" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label={tx('Description', 'الوصف')}><input className="field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <button className="btn btn-primary" onClick={async () => {
          try {
            await api.post('/finances/transactions', form);
            notify.success({
              title: form.type === 'income' ? tx('Encaissement enregistré', 'تم تسجيل التحصيل') : tx('Dépense enregistrée', 'تم تسجيل المصروف'),
              message: tx('L’écriture a été ajoutée.', 'تمت إضافة العملية.')
            });
            setForm(null);
            load();
          } catch (error) { fail(error); }
        }}>{tx('Enregistrer', 'حفظ')}</button>
      </div></Modal>}
    </div>
  );
}
