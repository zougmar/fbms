import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, FileText, Pencil, Trash2 } from 'lucide-react';
import api, { downloadFile, errorText, isStale } from '../services/api';
import { useLiveReload } from '../live';
import { useApp } from '../context';
import { money, formatDate, STATUSES, DELIVERY_STATUSES, statusLabel, statusTone } from '../utils';
import { Empty, Field, Modal, Pagination } from '../components/ui';
import CustomerContact from '../components/CustomerContact';
import ProductImage, { latestProductImage } from '../components/ProductImage';

const emptyForm = {
  orderDate: new Date().toISOString().slice(0, 10),
  customerName: '', customerPhone: '', city: '', address: '', product: '', quantity: 1,
  purchasePrice: '', sellingPrice: '', status: 'À confirmer', shippingCompany: '', trackingNumber: '',
  shippingCost: '', advertisingCost: 0, additionalExpenses: 0, amountCollected: 0, paymentStatus: '',
  comments: '', campaign: '', assignedTo: ''
};

function openEditor(row) {
  return {
    ...row,
    orderDate: row.orderDate?.slice(0, 10),
    city: row.city,
    product: row.product,
    shippingCompany: row.shippingCompany || '',
    campaign: row.campaign || '',
    assignedTo: row.assignedTo?._id || row.assignedTo || ''
  };
}

function FormBlock({ title, children }) {
  return (
    <section className="order-block">
      <h3>{title}</h3>
      <div className="grid gap-3 md:grid-cols-3">{children}</div>
    </section>
  );
}

export default function Orders() {
  const { user, tx, allowed, fail, notify } = useApp();
  const courier = user?.role === 'livreur';
  const agent = user?.role === 'confirmation_agent';
  const canManage = !courier && !agent && allowed('orders', 'edit');
  const canChangeStatus = courier || canManage || (agent && allowed('orders', 'edit'));
  const canCreate = !courier && allowed('orders', 'create');
  const canExport = !courier && allowed('orders', 'export');
  const canDelete = !courier && allowed('orders', 'delete');
  const location = useLocation();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, pages: 1 });
  const [filters, setFilters] = useState({ search: '', status: '', city: '', product: '', from: '', to: '', page: 1 });
  const [lookups, setLookups] = useState({ cities: [], products: [], carriers: [], campaigns: [], couriers: [] });
  const [form, setForm] = useState(null);
  const [selected, setSelected] = useState([]);
  const [importPreview, setImportPreview] = useState(null);
  const [bulkStatus, setBulkStatus] = useState('Confirmée');
  const [savingId, setSavingId] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const load = () => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
    api.get('/orders', { params }).then((res) => {
      setRows(res.data.items);
      setMeta({ page: res.data.page, pages: res.data.pages });
    }).catch(fail);
  };

  useEffect(() => {
    Promise.all([
      api.get('/cities', { params: { active: true } }),
      api.get('/products', { params: { limit: 200, status: 'active' } }),
      api.get('/shipping-companies'),
      api.get('/campaigns', { params: { limit: 100 } }).catch(() => ({ data: { items: [] } })),
      canManage ? api.get('/orders/couriers').catch(() => ({ data: { items: [] } })) : Promise.resolve({ data: { items: [] } })
    ]).then(([cities, products, carriers, campaigns, couriers]) => {
      setLookups({ cities: cities.data.items, products: products.data.items, carriers: carriers.data.items, campaigns: campaigns.data.items || [], couriers: couriers.data.items || [] });
    }).catch(fail);
  }, [canManage]);

  useEffect(() => { load(); }, [filters]);
  useLiveReload(form ? [] : ['orders'], load);

  useEffect(() => {
    const row = location.state?.editOrder;
    if (!row) return;
    if (user?.role !== 'livreur' && user?.role !== 'confirmation_agent') setForm(openEditor(row));
    navigate('/orders', { replace: true, state: null });
  }, [location.state, navigate, user?.role]);

  const save = async (allowDuplicate = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    let retry = false;
    const payload = {
      ...form,
      allowDuplicate,
      expectedVersion: form.__v,
      shippingCompany: form.shippingCompany || null,
      campaign: form.campaign || null,
      assignedTo: form.assignedTo || null
    };
    delete payload.__v;
    delete payload.history;
    delete payload.productImage;
    delete payload.dedupeKey;
    delete payload.createdAt;
    delete payload.updatedAt;
    if (!payload.paymentStatus) delete payload.paymentStatus;
    try {
      if (form._id) await api.put(`/orders/${form._id}`, payload);
      else await api.post('/orders', payload, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      const confirmed = payload.status === 'Confirmée';
      const delivered = payload.status === 'Livrée';
      notify.success({
        title: confirmed
          ? tx('Commande confirmée', 'تم تأكيد الطلب')
          : delivered
            ? tx('Livraison terminée', 'اكتمل التسليم')
            : tx('Commande enregistrée', 'تم حفظ الطلب'),
        message: tx('Les données ont été enregistrées.', 'تم حفظ البيانات.')
      });
      if (payload.status === 'À confirmer') {
        notify.warning({
          title: tx('En attente de confirmation', 'بانتظار التأكيد'),
          message: tx('Cette commande doit encore être confirmée.', 'هذا الطلب ما زال بحاجة إلى تأكيد.')
        });
      }
      if (!String(payload.customerName || '').trim() || !String(payload.customerPhone || '').trim()) {
        notify.warning({
          title: tx('Client incomplet', 'بيانات الزبون ناقصة'),
          message: tx('Le nom ou le téléphone du client manque.', 'اسم الزبون أو هاتفه غير مكتمل.')
        });
      }
      if (payload.paymentStatus === 'unpaid' || payload.paymentStatus === 'partial') {
        notify.warning({
          title: tx('Paiement en attente', 'الدفع معلّق'),
          message: tx('Le paiement n’est pas encore soldé.', 'لم يتم تحصيل الدفع بالكامل.')
        });
      }
      setForm(null);
      load();
    } catch (error) {
      if (isStale(error)) {
        notify.warning({
          title: tx('Modifié ailleurs', 'تم التعديل من جهاز آخر'),
          message: errorText(error)
        });
        setForm(null);
        load();
      } else if (error.response?.status === 409 && error.response?.data?.code !== 'duplicate_submit') {
        notify.warning({
          title: tx('Doublon possible', 'احتمال تكرار'),
          message: errorText(error)
        });
        const proceed = await notify.confirm({
          title: tx('Commande similaire', 'طلب مشابه'),
          message: tx('Une commande existe déjà pour ce téléphone, ce produit et ce jour. Enregistrer quand même ?', 'يوجد طلب لنفس الهاتف والمنتج واليوم. هل تريد الحفظ رغم ذلك؟'),
          cancelLabel: tx('Annuler', 'إلغاء'),
          confirmLabel: tx('Enregistrer', 'حفظ')
        });
        if (proceed) retry = true;
      } else fail(error);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (retry) return save(true);
  };

  const downloadOrdersPdf = async () => {
    const byStatus = { 'Confirmée': 'confirmed', 'Livrée': 'delivered', 'Retour': 'returned', 'Annulée': 'cancelled' };
    const type = byStatus[filters.status] || ((filters.from || filters.to) ? 'by-range' : 'all');
    const params = Object.fromEntries(Object.entries({
      category: 'orders',
      type,
      lang: localStorage.getItem('fbms_lang') || 'fr',
      from: filters.from,
      to: filters.to,
      city: filters.city,
      search: filters.search,
      status: byStatus[filters.status] ? '' : filters.status
    }).filter(([, value]) => value));
    setPdfBusy(true);
    try {
      await downloadFile('/documents/pdf', params, 'fbms-commandes.pdf');
      notify.success({ title: tx('PDF généré', 'تم إنشاء PDF'), message: tx('La liste des commandes a été téléchargée.', 'تم تنزيل قائمة الطلبات.') });
    } catch (error) {
      notify.error({ title: tx('PDF non généré', 'تعذر إنشاء PDF'), message: error.response?.data?.message || error.message });
    } finally {
      setPdfBusy(false);
    }
  };

  const exportOrders = async (format) => {
    try {
      await downloadFile('/orders/export', format === 'csv' ? { ...filters, format: 'csv' } : filters, format === 'csv' ? 'fbms-commandes.csv' : 'fbms-commandes.xlsx');
      notify.success({
        title: tx('Export réussi', 'تم التصدير'),
        message: format === 'csv' ? tx('Le fichier CSV a été téléchargé.', 'تم تنزيل ملف CSV.') : tx('Le fichier Excel a été téléchargé.', 'تم تنزيل ملف Excel.')
      });
    } catch (error) { fail(error); }
  };

  const requestDelete = async (row) => {
    try {
      await api.post('/order-requests', { order: row._id, action: 'delete' });
      await notify.confirm({
        title: tx('Demande envoyée', 'تم إرسال الطلب'),
        message: tx(
          `La demande de suppression de ${row.orderNumber} a été envoyée au Super Admin et à l’Admin. Ils vont décider si cette commande peut être supprimée. Veuillez attendre leur réponse. La commande reste inchangée en attendant.`,
          `تم إرسال طلب حذف ${row.orderNumber} إلى المشرف الأعلى والمدير. سيقرران إن كان يمكن حذف هذا الطلب. يرجى انتظار الرد. يبقى الطلب كما هو إلى ذلك الحين.`
        ),
        confirmLabel: tx('Compris', 'حسناً'),
        cancelLabel: tx('Fermer', 'إغلاق')
      });
    } catch (error) {
      if (error.response?.status === 409) {
        await notify.confirm({
          title: tx('Demande déjà envoyée', 'الطلب مُرسل مسبقاً'),
          message: tx('Une demande est déjà en attente de réponse du Super Admin ou de l’Admin.', 'هناك طلب بانتظار رد المشرف الأعلى أو المدير.'),
          confirmLabel: tx('Compris', 'حسناً'),
          cancelLabel: tx('Fermer', 'إغلاق')
        });
        return;
      }
      fail(error);
    }
  };

  const changeStatus = async (row, status) => {
    if (!status || status === row.status) return;
    const previous = row.status;
    setRows((items) => items.map((item) => (item._id === row._id ? { ...item, status } : item)));
    setSavingId(row._id);
    try {
      const res = await api.put(`/orders/${row._id}`, { status, expectedVersion: row.__v });
      setRows((items) => items.map((item) => (item._id === row._id ? { ...item, ...res.data.item } : item)));
      notify.success({
        title: tx('Statut mis à jour', 'تم تحديث الحالة'),
        message: `${row.orderNumber} · ${statusLabel(status, tx)}`
      });
    } catch (error) {
      setRows((items) => items.map((item) => (item._id === row._id ? { ...item, status: previous } : item)));
      if (isStale(error)) {
        notify.warning({ title: tx('Modifié ailleurs', 'تم التعديل من جهاز آخر'), message: errorText(error) });
        load();
      } else fail(error);
    } finally {
      setSavingId('');
    }
  };

  const onProduct = (id) => {
    const product = lookups.products.find((item) => item._id === id);
    setForm({ ...form, product: id, purchasePrice: product?.purchasePrice ?? '', sellingPrice: product?.effectivePrice ?? product?.sellingPrice ?? '' });
  };
  const onCity = (id) => {
    const city = lookups.cities.find((item) => item._id === id);
    setForm({ ...form, city: id, shippingCost: city ? city.shippingPrice : '' });
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{tx('Commandes', 'الطلبات')}</h1>
        <div className="flex flex-wrap gap-2">
          {canExport && <>
            <button className="btn btn-ghost" type="button" disabled={pdfBusy} onClick={downloadOrdersPdf}><FileText size={15} />PDF</button>
            <button className="btn btn-ghost" onClick={() => exportOrders('xlsx')}>Excel</button>
            <button className="btn btn-ghost" onClick={() => exportOrders('csv')}>CSV</button>
          </>}
          {canCreate && <button className="btn btn-primary" onClick={() => setForm({ ...emptyForm })}>{tx('Nouvelle commande', 'طلب جديد')}</button>}
        </div>
      </div>
      <div className="card grid gap-3 p-4 md:grid-cols-6">
        <input className="field md:col-span-2" placeholder={tx('Recherche', 'بحث')} value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })} />
        <select className="select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}>
          <option value="">{tx('Statut', 'الحالة')}</option>
          {STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status, tx)}</option>)}
        </select>
        <select className="select" value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value, page: 1 })}>
          <option value="">{tx('Ville', 'المدينة')}</option>
          {lookups.cities.map((city) => <option key={city._id} value={city._id}>{city.name}</option>)}
        </select>
        <input className="field" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value, page: 1 })} />
        <input className="field" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value, page: 1 })} />
      </div>
      {canCreate && (
        <label className="card flex cursor-pointer items-center justify-between p-4 text-sm">
          <span>{tx('Importer un fichier Excel. Les lignes sont vérifiées avant insertion.', 'استيراد Excel. يتم التحقق من الصفوف قبل الإدراج.')}</span>
          <input className="hidden" type="file" accept=".xlsx,.csv" onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const data = new FormData();
            data.append('file', file);
            try {
              const res = await api.post('/orders/import', data);
              setImportPreview(res.data);
              notify.info({
                title: tx('Fichier analysé', 'تم تحليل الملف'),
                message: tx('Vérifiez l’aperçu avant de confirmer l’import.', 'راجع المعاينة قبل تأكيد الاستيراد.')
              });
            } catch (error) { fail(error); }
          }} />
        </label>
      )}
      {selected.length > 0 && canManage && (
        <div className="card flex flex-wrap items-center gap-2 p-3">
          <span className="text-sm">{selected.length} {tx('sélectionnées', 'محددة')}</span>
          <select className="select max-w-xs" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
            {STATUSES.map((status) => <option key={status}>{status}</option>)}
          </select>
          <button className="btn btn-primary" onClick={async () => {
            try {
              const res = await api.post('/orders/bulk', { ids: selected, action: 'status', status: bulkStatus });
              const failed = (res.data.results || []).filter((item) => !item.ok);
              if (failed.length) {
                notify.warning({
                  title: tx('Mise à jour partielle', 'تحديث جزئي'),
                  message: failed.map((item) => item.message).filter(Boolean).join(' · ') || tx('Certaines commandes n’ont pas été mises à jour.', 'لم يتم تحديث بعض الطلبات.')
                });
              } else if (bulkStatus === 'Confirmée' || bulkStatus === 'Livrée') {
                notify.success({
                  title: bulkStatus === 'Livrée' ? tx('Livraison terminée', 'اكتمل التسليم') : tx('Commandes confirmées', 'تم تأكيد الطلبات'),
                  message: tx(`${selected.length} commande(s) mises à jour.`, `تم تحديث ${selected.length} طلبات.`)
                });
              } else {
                notify.info({
                  title: tx('Statut mis à jour', 'تم تحديث الحالة'),
                  message: tx(`${selected.length} commande(s) passées à « ${bulkStatus} ».`, `تم نقل ${selected.length} طلبات إلى « ${bulkStatus} ».`)
                });
              }
              setSelected([]);
              load();
            } catch (error) { fail(error); }
          }}>{tx('Mettre à jour', 'تحديث')}</button>
          {canDelete && <button className="btn btn-danger" onClick={async () => {
            const proceed = await notify.confirm({
              title: tx('Supprimer les commandes', 'حذف الطلبات'),
              message: tx('Cette action retire les commandes sélectionnées.', 'سيؤدي هذا إلى حذف الطلبات المحددة.'),
              cancelLabel: tx('Annuler', 'إلغاء'),
              confirmLabel: tx('Supprimer', 'حذف')
            });
            if (!proceed) return;
            try {
              const res = await api.post('/orders/bulk', { ids: selected, action: 'delete' });
              const failed = (res.data.results || []).filter((item) => !item.ok);
              if (failed.length) fail({ response: { data: { message: failed[0].message } } });
              else notify.success({ title: tx('Commandes supprimées', 'تم حذف الطلبات'), message: tx('La suppression est terminée.', 'اكتمل الحذف.') });
              setSelected([]);
              load();
            } catch (error) { fail(error); }
          }}>{tx('Supprimer', 'حذف')}</button>}
        </div>
      )}
      <div className="card table-wrap">
        <table className="data">
          <thead><tr>
            {!courier && <th></th>}<th>N°</th><th>{tx('Date', 'التاريخ')}</th><th>{tx('Client', 'الزبون')}</th><th>{tx('Ville', 'المدينة')}</th><th>{tx('Produit', 'المنتج')}</th>
            <th className="num">{tx('Total', 'المجموع')}</th><th>{tx('Statut', 'الحالة')}</th><th>{tx('Actions', 'إجراءات')}</th>
          </tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row._id}>
                {!courier && <td><input type="checkbox" checked={selected.includes(row._id)} onChange={(e) => setSelected(e.target.checked ? [...selected, row._id] : selected.filter((id) => id !== row._id))} /></td>}
                <td className="font-bold">{row.orderNumber}</td>
                <td>{formatDate(row.orderDate)}</td>
                <td>
                  <div className="font-semibold">{row.customerName}</div>
                  <CustomerContact customer={{
                    name: row.customerName,
                    phone: row.customerPhone,
                    orderNumber: row.orderNumber,
                    productName: row.productName,
                    quantity: row.quantity,
                    totalAmount: row.totalAmount,
                    cityName: row.cityName,
                    address: row.address,
                    status: row.status,
                    trackingNumber: row.trackingNumber
                  }} />
                </td>
                <td>{row.cityName}</td>
                <td><div className="flex items-center gap-2"><ProductImage src={row.productImage} alt={row.productName} /><span>{row.productName} × {row.quantity}</span></div></td>
                <td className="num">{money(row.totalAmount)}</td>
                <td>
                  {canChangeStatus ? (
                    <select
                      className={`status-select ${statusTone(row.status)}`}
                      aria-label={tx('Statut', 'الحالة')}
                      value={row.status}
                      disabled={savingId === row._id}
                      onChange={(event) => changeStatus(row, event.target.value)}
                    >
                      {courier && !DELIVERY_STATUSES.includes(row.status) && <option value={row.status} disabled>{statusLabel(row.status, tx)}</option>}
                      {(courier ? DELIVERY_STATUSES : STATUSES).map((status) => <option key={status} value={status}>{statusLabel(status, tx)}</option>)}
                    </select>
                  ) : (
                    <span className={`status-pill ${statusTone(row.status)}`}>{statusLabel(row.status, tx)}</span>
                  )}
                </td>
                <td>
                  <div className="order-actions">
                    <Link className="btn btn-view" to={`/orders/${row._id}`}><Eye size={15} />{tx('Voir', 'عرض')}</Link>
                    {canManage && <button className="btn btn-edit" type="button" onClick={() => setForm(openEditor(row))}><Pencil size={15} />{tx('Modifier', 'تعديل')}</button>}
                    {agent && <button className="btn btn-delete" type="button" onClick={() => requestDelete(row)}><Trash2 size={15} />{tx('Supprimer', 'حذف')}</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty text={tx('Aucune commande pour ces filtres.', 'لا توجد طلبات لهذه التصفية.')} />}
        <Pagination page={meta.page} pages={meta.pages} onPage={(page) => setFilters({ ...filters, page })} />
      </div>
      {form && (
        <Modal wide title={form._id ? form.orderNumber : tx('Nouvelle commande', 'طلب جديد')} onClose={() => setForm(null)}>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className={`status-pill ${statusTone(form.status)}`}>{statusLabel(form.status, tx)}</span>
            <span className="text-sm" style={{ color: 'var(--muted)' }}>{tx('Mettez à jour le statut et les informations de la commande.', 'حدّث حالة الطلب ومعلوماته.')}</span>
          </div>
          <div className="grid gap-4">
            <FormBlock title={tx('Client', 'الزبون')}>
              <Field label={tx('Date', 'التاريخ')}><input className="field" type="date" value={form.orderDate?.slice?.(0, 10) || form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} /></Field>
              <Field label={tx('Client', 'الزبون')}><input className="field" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></Field>
              <Field label={tx('Téléphone', 'الهاتف')}><input className="field" dir="ltr" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} /></Field>
              <Field label={tx('Ville', 'المدينة')}><select className="select" value={form.city || ''} onChange={(e) => onCity(e.target.value)}><option value="" /><option hidden />{lookups.cities.map((city) => <option key={city._id} value={city._id}>{city.name} · {city.shippingPrice} MAD</option>)}</select></Field>
              <Field label={tx('Adresse', 'العنوان')}><input className="field" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
              <Field label={tx('Statut', 'الحالة')}><select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status, tx)}</option>)}</select></Field>
            </FormBlock>
            <FormBlock title={tx('Produit', 'المنتج')}>
              <Field label={tx('Produit', 'المنتج')}>
                <div className="flex items-center gap-3">
                  <ProductImage src={latestProductImage(lookups.products.find((product) => product._id === form.product)?.images)} alt="" size={56} />
                  <select className="select" value={form.product || ''} onChange={(e) => onProduct(e.target.value)}><option value="" />{lookups.products.map((product) => <option key={product._id} value={product._id}>{product.name} · stock {product.stock}</option>)}</select>
                </div>
              </Field>
              <Field label={tx('Quantité', 'الكمية')}><input className="field" type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></Field>
              <Field label={tx('Prix de vente', 'سعر البيع')}><input className="field" type="number" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} /></Field>
              {allowed('finances', 'view') && <Field label={tx('Prix d\'achat', 'سعر الشراء')}><input className="field" type="number" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} /></Field>}
              <Field label={tx('Total', 'المجموع')}><input className="field" readOnly value={money((Number(form.quantity) || 0) * (Number(form.sellingPrice) || 0))} /></Field>
            </FormBlock>
            <FormBlock title={tx('Livraison', 'التوصيل')}>
              <Field label={tx('Société', 'شركة النقل')}><select className="select" value={form.shippingCompany || ''} onChange={(e) => setForm({ ...form, shippingCompany: e.target.value })}><option value="" />{lookups.carriers.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></Field>
              <Field label={tx('Suivi', 'التتبع')}><input className="field" value={form.trackingNumber || ''} onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })} /></Field>
              <Field label={tx('Livraison MAD', 'ثمن التوصيل')}><input className="field" type="number" value={form.shippingCost} onChange={(e) => setForm({ ...form, shippingCost: e.target.value })} /></Field>
              {canManage && <Field label={tx('Livreur', 'الموصّل')}><select className="select" value={form.assignedTo || ''} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}><option value="">{tx('Non assignée', 'غير مسندة')}</option>{lookups.couriers.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></Field>}
            </FormBlock>
            <FormBlock title={tx('Paiement', 'الدفع')}>
              {allowed('finances', 'view') && <Field label={tx('Publicité', 'الإعلان')}><input className="field" type="number" value={form.advertisingCost} onChange={(e) => setForm({ ...form, advertisingCost: e.target.value })} /></Field>}
              <Field label={tx('Frais supplémentaires', 'مصاريف إضافية')}><input className="field" type="number" value={form.additionalExpenses} onChange={(e) => setForm({ ...form, additionalExpenses: e.target.value })} /></Field>
              <Field label={tx('Encaissé', 'المحصّل')}><input className="field" type="number" value={form.amountCollected} onChange={(e) => setForm({ ...form, amountCollected: e.target.value })} /></Field>
              <Field label={tx('Paiement', 'الدفع')}><select className="select" value={form.paymentStatus || ''} onChange={(e) => setForm({ ...form, paymentStatus: e.target.value })}><option value="">{tx('Automatique', 'تلقائي')}</option><option value="unpaid">unpaid</option><option value="partial">partial</option><option value="paid">paid</option><option value="refunded">refunded</option></select></Field>
              {!!lookups.campaigns.length && <Field label={tx('Campagne', 'الحملة')}><select className="select" value={form.campaign || ''} onChange={(e) => setForm({ ...form, campaign: e.target.value })}><option value="" />{lookups.campaigns.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select></Field>}
              <label className="md:col-span-3"><span className="label">{tx('Commentaires', 'ملاحظات')}</span><textarea className="area" rows="3" value={form.comments || ''} onChange={(e) => setForm({ ...form, comments: e.target.value })} /></label>
            </FormBlock>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-ghost" type="button" onClick={() => setForm(null)}>{tx('Annuler', 'إلغاء')}</button>
            <button className="btn btn-primary" type="button" disabled={saving} onClick={() => save(false)}>{tx('Enregistrer', 'حفظ')}</button>
          </div>
        </Modal>
      )}
      {importPreview && (
        <Modal wide title={tx('Aperçu de l\'import', 'معاينة الاستيراد')} onClose={() => setImportPreview(null)}>
          <p className="mb-3 text-sm">{tx('Valides', 'صالحة')}: {importPreview.valid} · {tx('Doublons', 'مكررة')}: {importPreview.duplicates} · {tx('Erreurs', 'أخطاء')}: {importPreview.invalid}</p>
          <div className="table-wrap max-h-80">
            <table className="data"><thead><tr><th>#</th><th>{tx('Client', 'الزبون')}</th><th>{tx('Ville', 'المدينة')}</th><th>{tx('Produit', 'المنتج')}</th><th>{tx('Contrôle', 'التحقق')}</th></tr></thead>
              <tbody>{importPreview.rows.map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.preview.customerName}</td><td>{row.preview.city}</td><td>{row.preview.product}</td><td>{row.errors.join(', ') || row.warnings.join(', ') || 'OK'}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setImportPreview(null)}>{tx('Fermer', 'إغلاق')}</button>
            <button className="btn btn-primary" onClick={async () => {
              const res = await api.post(`/orders/import/${importPreview.id}/commit`, { allowDuplicates: false });
              const skipped = res.data.skipped?.length || 0;
              if (res.data.created > 0) {
                notify.success({
                  title: tx('Import terminé', 'اكتمل الاستيراد'),
                  message: `${res.data.created} ${tx('commandes créées', 'طلبات أُنشئت')}`
                });
              }
              if (skipped) {
                notify.warning({
                  title: tx('Lignes ignorées', 'صفوف متجاهلة'),
                  message: `${skipped} ${tx('ligne(s) non insérée(s).', 'صفوف لم تُدرج.')}`
                });
              }
              if (!res.data.created && !skipped) {
                notify.error({ title: tx('Import vide', 'استيراد فارغ'), message: tx('Aucune ligne n’a été insérée.', 'لم يتم إدراج أي صف.') });
              }
              setImportPreview(null);
              load();
            }}>{tx('Confirmer l\'insertion', 'تأكيد الإدراج')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
