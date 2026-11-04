import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Printer, QrCode } from 'lucide-react';
import api, { downloadFile } from '../services/api';
import { useLiveReload } from '../live';
import { useApp } from '../context';
import { formatDate, money, STATUSES, statusLabel, statusTone } from '../utils';
import { Field, Modal } from '../components/ui';
import CustomerContact from '../components/CustomerContact';
import ProductImage from '../components/ProductImage';

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, tx, allowed, fail, notify } = useApp();
  const courier = user?.role === 'livreur';
  const agent = user?.role === 'confirmation_agent';
  const canAssignCourier = agent || (!courier && allowed('orders', 'edit'));
  const canRequestEdit = agent && allowed('orders', 'edit');
  const canRequestDelete = agent;
  const userCanTicket = !courier && (user?.role === 'super_admin' || user?.role === 'admin' || allowed('orders', 'view'));
  const [order, setOrder] = useState(null);
  const [qr, setQr] = useState(null);
  const [couriers, setCouriers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [requestForm, setRequestForm] = useState(null);
  const [cities, setCities] = useState([]);
  const [products, setProducts] = useState([]);
  const load = () => api.get(`/orders/${id}`).then((res) => setOrder(res.data.item)).catch(fail);
  const loadRequests = () => {
    if (!agent && user?.role !== 'super_admin' && user?.role !== 'admin') return;
    api.get('/order-requests', { params: { order: id } }).then((res) => setRequests(res.data.items || [])).catch(() => {});
  };
  useEffect(() => { load(); loadRequests(); }, [id]);
  useLiveReload(['orders'], () => { load(); loadRequests(); });
  useEffect(() => {
    if (!canAssignCourier) return;
    api.get('/orders/couriers').then((res) => setCouriers(res.data.items || [])).catch(fail);
  }, [canAssignCourier]);
  if (!order) return null;
  const openPreview = async () => {
    try {
      const res = await api.get('/documents/preview', { params: { category: 'orders', type: 'individual', orderId: order._id, lang: localStorage.getItem('fbms_lang') || 'fr' }, responseType: 'text' });
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
      notify.info({ title: tx('Aperçu prêt', 'المعاينة جاهزة'), message: tx('Le document s’ouvre dans un nouvel onglet.', 'تفتح الوثيقة في تبويب جديد.') });
    } catch (error) {
      notify.error({ title: tx('PDF non généré', 'تعذر إنشاء PDF'), message: error.response?.data?.message || error.message });
    }
  };
  const showQr = async () => {
    try {
      const res = await api.get(`/orders/${order._id}/qr`);
      setQr(res.data);
    } catch (error) { fail(error); }
  };
  const downloadQr = () => {
    if (!qr?.dataUrl) return;
    const link = document.createElement('a');
    link.href = qr.dataUrl;
    link.download = `${order.orderNumber}-qr.png`;
    link.click();
  };
  const openTicket = async (print) => {
    try {
      const res = await api.post(`/orders/${order._id}/ticket`);
      const popup = window.open('', '_blank');
      if (!popup) {
        notify.warning({ title: tx('Aperçu bloqué', 'تم حظر المعاينة'), message: tx('Autorisez les fenêtres popup pour le reçu.', 'اسمح بالنوافذ المنبثقة للإيصال.') });
        return;
      }
      popup.document.write(res.data.html);
      popup.document.close();
      if (print) popup.onload = () => popup.print();
      notify.success({ title: tx('Reçu enregistré', 'تم حفظ الإيصال'), message: res.data.ticket.reference });
    } catch (error) { fail(error); }
  };
  const downloadTicket = async () => {
    try {
      const res = await api.post(`/orders/${order._id}/ticket`, {}, { params: { format: 'pdf' }, responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${order.orderNumber}-recu.pdf`;
      link.click();
      URL.revokeObjectURL(blobUrl);
      notify.success({ title: tx('Reçu téléchargé', 'تم تنزيل الإيصال'), message: order.orderNumber });
    } catch (error) { fail(error); }
  };
  const downloadPdf = async () => {
    try {
      await downloadFile('/documents/pdf', { category: 'orders', type: 'individual', orderId: order._id, lang: localStorage.getItem('fbms_lang') || 'fr' }, `${order.orderNumber}.pdf`);
      notify.success({ title: tx('PDF généré', 'تم إنشاء PDF'), message: tx('Le bon de commande a été téléchargé.', 'تم تنزيل وصل الطلب.') });
    } catch (error) {
      notify.error({ title: tx('PDF non généré', 'تعذر إنشاء PDF'), message: tx('La génération du PDF a échoué.', 'فشل إنشاء ملف PDF.') });
    }
  };
  return (
    <div className="grid gap-4">
      <section className="order-sheet sheet-head">
        <div>
          <Link to="/orders" className="text-sm font-bold" style={{ color: 'var(--brand)' }}>{tx('Commandes', 'الطلبات')}</Link>
          <h1 className="text-2xl font-extrabold">{order.orderNumber}</h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{formatDate(order.orderDate)}</p>
        </div>
        <span className={`status-pill ${statusTone(order.status)}`}>{statusLabel(order.status, tx)}</span>
        <div className="order-actions">
          {!courier && !agent && allowed('orders', 'edit') && (
            <button className="btn btn-edit" type="button" onClick={() => navigate('/orders', { state: { editOrder: order } })}>
              <Pencil size={15} />{tx('Modifier', 'تعديل')}
            </button>
          )}
          {canRequestEdit && (
            <button className="btn btn-edit" type="button" onClick={async () => {
              const [cityRes, productRes] = await Promise.all([
                api.get('/cities', { params: { active: true } }),
                api.get('/products', { params: { limit: 200, status: 'active' } })
              ]);
              setCities(cityRes.data.items || []);
              setProducts(productRes.data.items || []);
              setRequestForm({
                customerName: order.customerName || '',
                customerPhone: order.customerPhone || '',
                city: order.city || '',
                address: order.address || '',
                product: order.product || '',
                quantity: order.quantity || 1,
                status: order.status,
                comments: order.comments || ''
              });
            }}><Pencil size={15} />{tx('Demander une modification', 'طلب تعديل')}</button>
          )}
          {canRequestDelete && (
            <button className="btn btn-delete" type="button" onClick={async () => {
              try {
                await api.post('/order-requests', { order: order._id, action: 'delete' });
                await notify.confirm({
                  title: tx('Demande envoyée', 'تم إرسال الطلب'),
                  message: tx(
                    `La demande de suppression de ${order.orderNumber} a été envoyée au Super Admin et à l’Admin. Ils vont décider si cette commande peut être supprimée. Veuillez attendre leur réponse. La commande reste inchangée en attendant.`,
                    `تم إرسال طلب حذف ${order.orderNumber} إلى المشرف الأعلى والمدير. سيقرران إن كان يمكن حذف هذا الطلب. يرجى انتظار الرد. يبقى الطلب كما هو إلى ذلك الحين.`
                  ),
                  confirmLabel: tx('Compris', 'حسناً'),
                  cancelLabel: tx('Fermer', 'إغلاق')
                });
                loadRequests();
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
            }}>{tx('Supprimer', 'حذف')}</button>
          )}
          {!courier && <>
            <button className="btn btn-ghost" type="button" onClick={openPreview}>{tx('Aperçu PDF', 'معاينة')}</button>
            <button className="btn btn-ghost" type="button" onClick={downloadPdf}>{tx('Télécharger', 'تنزيل')}</button>
            <button className="btn btn-ghost" type="button" onClick={() => window.print()}><Printer size={15} />{tx('Imprimer', 'طباعة')}</button>
          </>}
          {(userCanTicket) && <>
            <button className="btn btn-ghost" type="button" onClick={showQr}><QrCode size={15} />QR</button>
            <button className="btn btn-ghost" type="button" onClick={() => openTicket(false)}>{tx('Reçu', 'إيصال')}</button>
            <button className="btn btn-ghost" type="button" onClick={() => openTicket(true)}><Printer size={15} />{tx('Imprimer le reçu', 'طباعة الإيصال')}</button>
            <button className="btn btn-ghost" type="button" onClick={downloadTicket}>{tx('PDF reçu', 'PDF الإيصال')}</button>
          </>}
        </div>
      </section>
      {qr && <section className="order-sheet flex flex-wrap items-center gap-4">
        <img src={qr.dataUrl} alt="QR" width="160" height="160" />
        <div>
          <h3>QR · {order.orderNumber}</h3>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{tx('Le scan ouvre la confirmation de livraison.', 'يفتح المسح تأكيد التسليم.')}</p>
          <button className="btn btn-ghost mt-3" type="button" onClick={downloadQr}>{tx('Télécharger le QR', 'تنزيل QR')}</button>
        </div>
      </section>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="order-sheet">
          <h3>{tx('Client', 'الزبون')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Info label={tx('Client', 'الزبون')} value={order.customerName} />
            <Info label={tx('Téléphone', 'الهاتف')} value={order.customerPhone} />
            <Info label={tx('Ville', 'المدينة')} value={order.cityName} />
            <Info label={tx('Adresse', 'العنوان')} value={order.address} />
          </div>
        </section>
        <section className="order-sheet">
          <h3>{tx('Produit', 'المنتج')}</h3>
          <div className="flex items-center gap-3">
            <ProductImage src={order.productImage} alt={order.productName} size={72} />
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <Info label={tx('Produit', 'المنتج')} value={`${order.productName} × ${order.quantity}`} />
              <Info label={tx('Total', 'المجموع')} value={money(order.totalAmount)} />
            </div>
          </div>
        </section>
      </div>
      <section className="order-sheet">
        <h3>{tx('Livraison et paiement', 'التوصيل والدفع')}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Info label={tx('Livraison', 'التوصيل')} value={money(order.shippingCost)} />
          <Info label={tx('Société', 'الشركة')} value={order.shippingCompanyName || '—'} />
          <Info label={tx('Suivi', 'التتبع')} value={order.trackingNumber || '—'} />
          <Info label={tx('Encaissé', 'المحصّل')} value={money(order.amountCollected)} />
          {allowed('finances', 'view') && <Info label={tx('Bénéfice', 'الربح')} value={money(order.netProfit)} />}
          <Info label={tx('Commentaires', 'ملاحظات')} value={order.comments || '—'} />
          <Info label={tx('Livreur', 'الموصّل')} value={order.assignedToName || '—'} />
        </div>
        {canAssignCourier && (
          <div className="mt-4 max-w-sm">
            <Field label={tx('Assigner un livreur', 'إسناد موصّل')}>
              <select className="select" value={order.assignedTo || ''} onChange={async (event) => {
                try {
                  const res = await api.put(`/orders/${order._id}`, { assignedTo: event.target.value || null, expectedVersion: order.__v });
                  setOrder(res.data.item);
                  notify.success({ title: tx('Livreur assigné', 'تم إسناد الموصّل'), message: order.orderNumber });
                } catch (error) { fail(error); }
              }}>
                <option value="">{tx('Non assignée', 'غير مسندة')}</option>
                {couriers.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}
              </select>
            </Field>
          </div>
        )}
      </section>
      {(agent || user?.role === 'super_admin' || user?.role === 'admin') && requests.length > 0 && (
        <section className="card grid gap-3 p-5">
          <h2 className="font-extrabold">{tx('Demandes', 'الطلبات')}</h2>
          {requests.map((request) => (
            <article key={request._id} className="grid gap-2 border-b pb-3" style={{ borderColor: 'var(--line)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{request.action === 'delete' ? tx('Suppression', 'حذف') : tx('Modification', 'تعديل')} · {request.requestedByName}</strong>
                <span className={`status-pill ${request.status === 'accepted' ? 'status-done' : request.status === 'rejected' ? 'status-cancel' : 'status-progress'}`}>
                  {request.status === 'pending' ? tx('En attente', 'قيد الانتظار') : request.status === 'accepted' ? tx('Acceptée', 'مقبولة') : tx('Refusée', 'مرفوضة')}
                </span>
              </div>
              <p className="whitespace-pre-line text-sm">{request.summary}</p>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>{formatDate(request.createdAt)}{request.decidedAt ? ` · ${request.decidedByName} · ${formatDate(request.decidedAt)}` : ''}</p>
              {(user?.role === 'super_admin' || user?.role === 'admin') && request.status === 'pending' && (
                <div className="flex gap-2">
                  <button className="btn btn-primary" type="button" onClick={() => decide(request, 'accept')}>{tx('Accepter', 'قبول')}</button>
                  <button className="btn btn-ghost" type="button" onClick={() => decide(request, 'reject')}>{tx('Refuser', 'رفض')}</button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}
      <CustomerContact
        variant="panel"
        customer={{
          name: order.customerName,
          phone: order.customerPhone,
          orderNumber: order.orderNumber,
          productName: order.productName,
          quantity: order.quantity,
          totalAmount: order.totalAmount,
          cityName: order.cityName,
          address: order.address,
          status: order.status,
          trackingNumber: order.trackingNumber
        }}
      />
      <section className="card p-5">
        <h2 className="mb-3 font-extrabold">{tx('Historique', 'السجل')}</h2>
        <ul className="grid gap-2 text-sm">
          {(order.history || []).map((entry, index) => (
            <li key={index} className="border-b pb-2" style={{ borderColor: 'var(--line)' }}>
              <strong>{formatDate(entry.at)}</strong> · {entry.byName} · {entry.action}
              {entry.changes?.status && <span> · {entry.changes.status.from} → {entry.changes.status.to}</span>}
            </li>
          ))}
        </ul>
      </section>
      {requestForm && (
        <Modal title={tx('Demande de modification', 'طلب التعديل')} onClose={() => setRequestForm(null)}>
          <div className="grid gap-3">
            <Field label={tx('Client', 'الزبون')}><input className="field" value={requestForm.customerName} onChange={(e) => setRequestForm({ ...requestForm, customerName: e.target.value })} /></Field>
            <Field label={tx('Téléphone', 'الهاتف')}><input className="field" value={requestForm.customerPhone} onChange={(e) => setRequestForm({ ...requestForm, customerPhone: e.target.value })} /></Field>
            <Field label={tx('Ville', 'المدينة')}><select className="select" value={requestForm.city} onChange={(e) => setRequestForm({ ...requestForm, city: e.target.value })}>{!cities.some((city) => city._id === requestForm.city) && <option value={requestForm.city}>{order.cityName}</option>}{cities.map((city) => <option key={city._id} value={city._id}>{city.name}</option>)}</select></Field>
            <Field label={tx('Adresse', 'العنوان')}><input className="field" value={requestForm.address} onChange={(e) => setRequestForm({ ...requestForm, address: e.target.value })} /></Field>
            <Field label={tx('Produit', 'المنتج')}><select className="select" value={requestForm.product} onChange={(e) => setRequestForm({ ...requestForm, product: e.target.value })}>{!products.some((product) => product._id === requestForm.product) && <option value={requestForm.product}>{order.productName}</option>}{products.map((product) => <option key={product._id} value={product._id}>{product.name}</option>)}</select></Field>
            <Field label={tx('Quantité', 'الكمية')}><input className="field" type="number" min="1" value={requestForm.quantity} onChange={(e) => setRequestForm({ ...requestForm, quantity: e.target.value })} /></Field>
            <Field label={tx('Statut', 'الحالة')}><select className="select" value={requestForm.status} onChange={(e) => setRequestForm({ ...requestForm, status: e.target.value })}>{STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status, tx)}</option>)}</select></Field>
            <Field label={tx('Commentaires', 'ملاحظات')}><textarea className="field min-h-20" value={requestForm.comments} onChange={(e) => setRequestForm({ ...requestForm, comments: e.target.value })} /></Field>
            <button className="btn btn-primary" type="button" onClick={async () => {
              const payload = {};
              if (requestForm.customerName !== order.customerName) payload.customerName = requestForm.customerName;
              if (requestForm.customerPhone !== order.customerPhone) payload.customerPhone = requestForm.customerPhone;
              if (String(requestForm.city) !== String(order.city)) payload.city = requestForm.city;
              if (requestForm.address !== order.address) payload.address = requestForm.address;
              if (String(requestForm.product) !== String(order.product)) payload.product = requestForm.product;
              if (Number(requestForm.quantity) !== Number(order.quantity)) payload.quantity = Number(requestForm.quantity);
              if (requestForm.status !== order.status) payload.status = requestForm.status;
              if ((requestForm.comments || '') !== (order.comments || '')) payload.comments = requestForm.comments;
              if (!Object.keys(payload).length) {
                notify.warning({ title: tx('Aucun changement', 'لا يوجد تغيير'), message: tx('Modifiez au moins un champ.', 'غيّر حقلاً واحداً على الأقل.') });
                return;
              }
              try {
                await api.post('/order-requests', { order: order._id, action: 'edit', payload });
                notify.success({ title: tx('Demande envoyée', 'تم إرسال الطلب'), message: tx('Le super administrateur a été notifié.', 'تم إشعار المشرف الأعلى.') });
                setRequestForm(null);
                loadRequests();
              } catch (error) { fail(error); }
            }}>{tx('Envoyer la demande', 'إرسال الطلب')}</button>
          </div>
        </Modal>
      )}
    </div>
  );

  async function decide(request, decision) {
    try {
      await api.post(`/order-requests/${request._id}/decide`, { decision });
      notify.success({
        title: decision === 'accept' ? tx('Demande acceptée', 'تم قبول الطلب') : tx('Demande refusée', 'تم رفض الطلب'),
        message: request.orderNumber
      });
      load();
      loadRequests();
    } catch (error) { fail(error); }
  }
}

function Info({ label, value }) {
  return <div><div className="label">{label}</div><div className="font-semibold">{value}</div></div>;
}
