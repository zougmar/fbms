import { useEffect, useState } from 'react';
import api, { isStale } from '../services/api';
import { useLiveReload } from '../live';
import { useApp } from '../context';
import { money, STATUSES, statusLabel } from '../utils';
import { Empty, Pagination } from '../components/ui';
import CustomerContact from '../components/CustomerContact';
import { WarningAlert } from '../notifications/alerts';

export default function Delivery() {
  const { tx, allowed, fail, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [byCarrier, setByCarrier] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [status, setStatus] = useState('');

  const load = () => {
    api.get('/delivery/board', { params: { page, status } }).then((res) => {
      setRows(res.data.items); setPages(res.data.pages); setByCarrier(res.data.byCarrier || []);
    }).catch(fail);
  };
  useEffect(() => { api.get('/shipping-companies').then((res) => setCarriers(res.data.items)).catch(fail); }, []);
  useEffect(() => { load(); }, [page, status]);
  useLiveReload(['orders'], load);

  const patch = async (row, changes) => {
    try {
      await api.put(`/orders/${row._id}`, { ...changes, expectedVersion: row.__v });
      if (changes.status === 'Livrée') {
        notify.success({
          title: tx('Livraison terminée', 'اكتمل التسليم'),
          message: tx(`${row.orderNumber} est livrée.`, `تم تسليم ${row.orderNumber}.`)
        });
      } else if (changes.amountCollected != null && Number(changes.amountCollected) >= Number(row.totalAmount || 0) && Number(row.totalAmount) > 0) {
        notify.success({
          title: tx('Paiement reçu', 'تم استلام الدفع'),
          message: tx(`${row.orderNumber} est soldée.`, `تم تحصيل ${row.orderNumber}.`)
        });
      } else {
        notify.info({
          title: tx('Livraison mise à jour', 'تم تحديث التوصيل'),
          message: tx('Le statut ou le suivi a été enregistré.', 'تم حفظ الحالة أو التتبع.')
        });
      }
      load();
    } catch (error) {
      const message = error.response?.data?.message || '';
      if (isStale(error)) {
        notify.warning({ title: tx('Modifié ailleurs', 'تم التعديل من جهاز آخر'), message });
        load();
      } else if (/stock/i.test(message)) notify.error({ title: tx('Stock insuffisant', 'المخزون غير كافٍ'), message });
      else fail(error);
    }
  };

  const delayed = rows.filter((row) => row.status === 'Expédiée' && row.orderDate && Date.now() - new Date(row.orderDate).getTime() > 3 * 86400000);

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-extrabold">{tx('Livraison', 'التوصيل')}</h1>
      {delayed.length > 0 && (
        <WarningAlert
          title={tx('Livraison en retard', 'توصيل متأخر')}
          message={delayed.map((row) => row.orderNumber).join(' · ')}
        />
      )}
      <div className="grid gap-3 md:grid-cols-3">
        {byCarrier.slice(0, 3).map((item) => <article key={item.name} className="card p-4"><div className="text-sm" style={{ color: 'var(--muted)' }}>{item.name || '—'}</div><div className="text-2xl font-extrabold">{item.orders}</div></article>)}
      </div>
      <select className="select max-w-xs" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
        <option value="">{tx('Préparation, expédition, livraison, retour', 'التحضير والشحن والتسليم والإرجاع')}</option>
        {STATUSES.map((item) => <option key={item} value={item}>{statusLabel(item, tx)}</option>)}
      </select>
      <div className="card table-wrap">
        <table className="data"><thead><tr><th>N°</th><th>{tx('Client', 'الزبون')}</th><th>{tx('Ville', 'المدينة')}</th><th>{tx('Montant', 'المبلغ')}</th><th>{tx('Société', 'الشركة')}</th><th>{tx('Suivi', 'التتبع')}</th><th>{tx('Statut', 'الحالة')}</th><th>{tx('Encaissé', 'المحصّل')}</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row._id}>
            <td className="font-bold">{row.orderNumber}</td>
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
            <td>{row.cityName}<div className="text-xs">{row.address}</div></td>
            <td>{money(row.totalAmount)}<div className="text-xs">{money(row.shippingCost)}</div></td>
            <td>{allowed('delivery', 'edit') ? <select className="select" value={row.shippingCompany || ''} onChange={(e) => patch(row, { shippingCompany: e.target.value || null })}><option value="" />{carriers.map((item) => <option key={item._id} value={item._id}>{item.name}</option>)}</select> : row.shippingCompanyName}</td>
            <td>{allowed('delivery', 'edit') ? <input className="field" defaultValue={row.trackingNumber} onBlur={(e) => e.target.value !== row.trackingNumber && patch(row, { trackingNumber: e.target.value })} /> : row.trackingNumber}</td>
            <td>{allowed('delivery', 'edit') ? <select className="select" value={row.status} onChange={(e) => patch(row, { status: e.target.value })}>{STATUSES.map((item) => <option key={item} value={item}>{statusLabel(item, tx)}</option>)}</select> : statusLabel(row.status, tx)}</td>
            <td>{allowed('delivery', 'edit') ? <input className="field" type="number" defaultValue={row.amountCollected} onBlur={(e) => patch(row, { amountCollected: Number(e.target.value) })} /> : money(row.amountCollected)}</td>
          </tr>)}</tbody>
        </table>
        {!rows.length && <Empty text={tx('Aucun colis.', 'لا توجد طرود.')} />}
        <Pagination page={page} pages={pages} onPage={setPage} />
      </div>
    </div>
  );
}
