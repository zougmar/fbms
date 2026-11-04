import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import api from '../services/api';
import { useApp } from '../context';
import { formatDate, money, statusLabel, statusTone } from '../utils';
import ProductImage from '../components/ProductImage';

export default function Scan() {
  const { token } = useParams();
  const { tx, fail, notify } = useApp();
  const [order, setOrder] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api.post(`/scan/${token}`).then((res) => setOrder(res.data.item)).catch((err) => {
      fail(err);
      setError(err.response?.data?.message || err.message);
    });
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/scan/${token}/confirm`, { note });
      setOrder(res.data.item);
      notify.success({ title: tx('Livraison confirmée', 'تم تأكيد التسليم'), message: res.data.item.orderNumber });
    } catch (error) { fail(error); }
    finally { setBusy(false); }
  };
  const receipt = async (print) => {
    setBusy(true);
    try {
      const res = await api.post(`/scan/${token}/ticket`);
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
    finally { setBusy(false); }
  };

  if (error) return <div className="card p-6">{error}</div>;
  if (!order) return <div className="card p-6">{tx('Lecture du QR…', 'جارٍ قراءة الرمز…')}</div>;
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <section className="order-sheet sheet-head">
        <div>
          <h1 className="text-2xl font-extrabold">{order.orderNumber}</h1>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{formatDate(order.orderDate)}</p>
        </div>
        <span className={`status-pill ${statusTone(order.status)}`}>{statusLabel(order.status, tx)}</span>
      </section>
      <section className="order-sheet">
        <div className="flex items-center gap-3">
          <ProductImage src={order.productImage} alt={order.productName} size={72} />
          <div>
            <h2 className="font-extrabold">{order.productName} × {order.quantity}</h2>
            <p>{order.customerName} · {order.customerPhone}</p>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>{order.address}, {order.cityName}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Info label={tx('Total', 'المجموع')} value={money(order.totalAmount)} />
          <Info label={tx('Livraison', 'التوصيل')} value={money(order.shippingCost)} />
          <Info label={tx('Encaissé', 'المحصّل')} value={money(order.amountCollected)} />
        </div>
      </section>
      <section className="order-sheet grid gap-3">
        <label className="grid gap-1 text-sm font-bold">{tx('Note de livraison', 'ملاحظة التسليم')}
          <textarea className="field min-h-20 font-normal" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" type="button" disabled={busy || order.status === 'Livrée'} onClick={confirm}>{tx('Confirmer la livraison', 'تأكيد التسليم')}</button>
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => receipt(false)}>{tx('Générer le reçu', 'إنشاء الإيصال')}</button>
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => receipt(true)}><Printer size={15} />{tx('Imprimer', 'طباعة')}</button>
        </div>
      </section>
    </div>
  );
}

function Info({ label, value }) {
  return <div><div className="text-xs font-bold uppercase" style={{ color: 'var(--muted)' }}>{label}</div><div className="font-extrabold">{value}</div></div>;
}
