import { useEffect, useRef, useState } from 'react';
import { FileText, Pencil, Trash2 } from 'lucide-react';
import api, { downloadFile, isStale } from '../services/api';
import { useLiveReload } from '../live';
import { useApp } from '../context';
import { money } from '../utils';
import { Empty, Field, Modal, Pagination } from '../components/ui';
import ProductImage, { latestProductImage } from '../components/ProductImage';
import { WarningAlert } from '../notifications/alerts';

const blank = { name: '', code: '', description: '', category: '', purchasePrice: 0, sellingPrice: 0, discount: 0, stock: 0, status: 'active' };

export default function Products() {
  const { tx, allowed, notify, fail } = useApp();
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!file) {
      setPreview('');
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const load = () => {
    api.get('/products', { params: { page, search, limit: 20, excludeArchived: '1' } }).then((res) => {
      setRows(res.data.items); setPages(res.data.pages);
    }).catch(fail);
    api.get('/products/low-stock').then((res) => setAlerts(res.data.items)).catch(() => {});
    api.get('/products/categories').then((res) => setCategories(res.data.items)).catch(fail);
  };
  useEffect(() => { load(); }, [page, search]);
  useLiveReload(form ? [] : ['products'], load);

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const data = new FormData();
    const skip = new Set(['_id', 'images', 'effectivePrice', 'categoryName', 'createdAt', 'updatedAt', '__v']);
    Object.entries(form).forEach(([key, value]) => {
      if (skip.has(key) || value === undefined || value === null || typeof value === 'object') return;
      data.append(key, value);
    });
    if (form._id) {
      data.append('keepImages', JSON.stringify(Array.isArray(form.images) ? form.images : []));
      if (form.__v !== undefined) data.append('expectedVersion', form.__v);
    }
    if (file) data.append('images', file);
    try {
      if (form._id) await api.put(`/products/${form._id}`, data);
      else await api.post('/products', data, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      notify.success({
        title: tx('Produit enregistré', 'تم حفظ المنتج'),
        message: tx('Le catalogue a été mis à jour.', 'تم تحديث الكتالوج.')
      });
      if (Number(form.stock) <= 5) {
        notify.warning({
          title: tx('Stock faible', 'مخزون منخفض'),
          message: tx('Le stock de ce produit est bas.', 'مخزون هذا المنتج منخفض.')
        });
      }
      setForm(null); setFile(null); load();
    } catch (error) {
      const message = error.response?.data?.message || '';
      if (isStale(error)) {
        notify.warning({ title: tx('Modifié ailleurs', 'تم التعديل من جهاز آخر'), message });
        setForm(null);
        load();
      } else if (/stock/i.test(message)) {
        notify.error({ title: tx('Stock insuffisant', 'المخزون غير كافٍ'), message });
      } else fail(error);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const remove = async (row) => {
    const proceed = await notify.confirm({
      title: tx('Supprimer le produit', 'حذف المنتج'),
      message: tx(`Retirer ${row.name} du catalogue ?`, `حذف ${row.name} من الكتالوج؟`),
      cancelLabel: tx('Annuler', 'إلغاء'),
      confirmLabel: tx('Supprimer', 'حذف')
    });
    if (!proceed) return;
    try {
      const res = await api.delete(`/products/${row._id}`);
      const archived = /archivé/i.test(res.data?.message || '');
      if (archived) {
        notify.warning({
          title: tx('Produit archivé', 'تم أرشفة المنتج'),
          message: tx('Ce produit reste lié à des commandes, il a été retiré du catalogue.', 'هذا المنتج مرتبط بطلبات، لذلك أُزيل من الكتالوج.')
        });
      } else {
        notify.success({
          title: tx('Produit supprimé', 'تم حذف المنتج'),
          message: row.name
        });
      }
      load();
    } catch (error) { fail(error); }
  };

  const exportPdf = async () => {
    setPdfBusy(true);
    try {
      await downloadFile('/documents/pdf', {
        category: 'products',
        type: 'catalog',
        excludeArchived: '1',
        search,
        lang: localStorage.getItem('fbms_lang') || 'fr'
      }, 'fbms-produits.pdf');
      notify.success({ title: tx('PDF généré', 'تم إنشاء PDF'), message: tx('Le catalogue a été téléchargé.', 'تم تنزيل الكتالوج.') });
    } catch (error) {
      notify.error({ title: tx('PDF non généré', 'تعذر إنشاء PDF'), message: error.response?.data?.message || error.message });
    } finally {
      setPdfBusy(false);
    }
  };

  const exportStock = async () => {
    try {
      await downloadFile('/documents/export', { category: 'products', type: 'stock', format: 'xlsx' }, 'fbms-stock.xlsx');
      notify.success({ title: tx('Export Excel', 'تصدير Excel'), message: tx('Le rapport de stock a été téléchargé.', 'تم تنزيل تقرير المخزون.') });
    } catch (error) { fail(error); }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{tx('Produits', 'المنتجات')}</h1>
        <div className="flex gap-2">
          <button className="btn btn-ghost" type="button" disabled={pdfBusy} onClick={exportPdf}><FileText size={15} />PDF</button>
          <button className="btn btn-ghost" onClick={exportStock}>Excel</button>
          {allowed('products', 'create') && <button className="btn btn-primary" onClick={() => { setFile(null); setForm({ ...blank }); }}>{tx('Nouveau produit', 'منتج جديد')}</button>}
        </div>
      </div>
      {!!alerts.length && <WarningAlert title={tx('Stock faible', 'مخزون منخفض')} message={alerts.map((item) => `${item.name} (${item.stock})`).join(' · ')} />}
      <div className="card p-4"><input className="field" placeholder={tx('Rechercher', 'بحث')} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
      <div className="card table-wrap">
        <table className="data"><thead><tr><th>{tx('Code', 'الرمز')}</th><th>{tx('Produit', 'المنتج')}</th><th>{tx('Catégorie', 'الفئة')}</th><th className="num">{tx('Stock', 'المخزون')}</th><th className="num">{tx('Vente', 'البيع')}</th><th>{tx('Actions', 'إجراءات')}</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row._id}><td>{row.code}</td><td><div className="flex items-center gap-3"><ProductImage src={latestProductImage(row.images)} alt={row.name} /><span className="font-bold">{row.name}</span></div></td><td>{row.categoryName || '—'}</td><td className="num">{row.stock}</td><td className="num">{money(row.effectivePrice || row.sellingPrice)}</td><td><div className="row-actions">{allowed('products', 'edit') && <button className="btn btn-edit" type="button" onClick={() => { setFile(null); setForm({ ...row, category: row.category || '' }); }}><Pencil size={15} />{tx('Modifier', 'تعديل')}</button>}{allowed('products', 'delete') && <button className="btn btn-delete" type="button" onClick={() => remove(row)}><Trash2 size={15} />{tx('Supprimer', 'حذف')}</button>}</div></td></tr>)}</tbody>
        </table>
        {!rows.length && <Empty text={tx('Aucun produit.', 'لا توجد منتجات.')} />}
        <Pagination page={page} pages={pages} onPage={setPage} />
      </div>
      {allowed('products', 'create') && <div className="card flex gap-2 p-4">
        <input className="field" placeholder={tx('Nouvelle catégorie', 'فئة جديدة')} value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
        <button className="btn btn-ghost" onClick={async () => { await api.post('/products/categories', { name: categoryName }); setCategoryName(''); load(); }}>{tx('Ajouter', 'إضافة')}</button>
      </div>}
      {form && <Modal title={form.name || tx('Produit', 'منتج')} onClose={() => setForm(null)}>
        <div className="grid gap-3">
          <Field label={tx('Nom', 'الاسم')}><input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Code"><input className="field" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></Field>
          <Field label={tx('Catégorie', 'الفئة')}><select className="select" value={form.category || ''} onChange={(e) => setForm({ ...form, category: e.target.value })}><option value="" />{categories.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></Field>
          <Field label={tx('Description', 'الوصف')}><textarea className="area" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          {allowed('finances', 'view') && <Field label={tx('Achat', 'الشراء')}><input className="field" type="number" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} /></Field>}
          <Field label={tx('Vente', 'البيع')}><input className="field" type="number" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} /></Field>
          <Field label={tx('Remise %', 'الخصم %')}><input className="field" type="number" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} /></Field>
          <Field label={tx('Stock disponible', 'المخزون المتاح')}><input className="field" type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></Field>
          <Field label={tx('Statut', 'الحالة')}><select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">active</option><option value="inactive">inactive</option><option value="archived">archived</option></select></Field>
          <Field label={tx('Image', 'صورة')}>
            <div className="flex items-center gap-3">
              <ProductImage src={preview || latestProductImage(form.images)} alt={form.name} size={72} />
              <input className="field" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
          </Field>
          <button className="btn btn-primary" type="button" disabled={saving} onClick={save}>{tx('Enregistrer', 'حفظ')}</button>
        </div>
      </Modal>}
    </div>
  );
}
