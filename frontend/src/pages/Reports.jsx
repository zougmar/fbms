import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import api, { downloadFile } from '../services/api';
import { useLiveReload } from '../live';
import { useApp } from '../context';
import { money } from '../utils';
import { InfoAlert } from '../notifications/alerts';

const TYPES = [
  ['daily', 'Ventes quotidiennes', 'مبيعات يومية'],
  ['weekly', 'Ventes hebdomadaires', 'مبيعات أسبوعية'],
  ['monthly', 'Ventes mensuelles', 'مبيعات شهرية'],
  ['by-city', 'Par ville', 'حسب المدينة'],
  ['by-product', 'Par produit', 'حسب المنتج'],
  ['revenue-product', 'CA par produit', 'المداخيل حسب المنتج'],
  ['profit-product', 'Profit par produit', 'الربح حسب المنتج'],
  ['delivery', 'Livraison', 'التوصيل'],
  ['returns', 'Retours', 'المرتجعات'],
  ['cancellations', 'Annulations', 'الإلغاءات'],
  ['advertising', 'ROI publicitaire', 'عائد الإعلان'],
  ['financial', 'Synthèse financière', 'ملخص مالي']
];

export default function Reports() {
  const { tx, fail, notify } = useApp();
  const [type, setType] = useState('daily');
  const [filters, setFilters] = useState({ from: '', to: '' });
  const [report, setReport] = useState({ columns: [], rows: [], summary: null });
  const [pdfBusy, setPdfBusy] = useState(false);
  const reportPdf = {
    daily: ['orders', 'daily'],
    weekly: ['finance', 'weekly'],
    monthly: ['orders', 'monthly'],
    'by-city': ['orders', 'by-city'],
    'by-product': ['orders', 'by-product'],
    'revenue-product': ['products', 'performance'],
    'profit-product': ['finance', 'product-profit'],
    delivery: ['delivery', 'report'],
    returns: ['orders', 'returned'],
    cancellations: ['orders', 'cancelled'],
    advertising: ['finance', 'ads'],
    financial: ['finance', 'pnl']
  };
  const load = () => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
    api.get(`/reports/${type}`, { params }).then((res) => setReport(res.data)).catch(fail);
  };
  useEffect(() => { load(); }, [type, filters]);
  useLiveReload(['orders', 'products', 'finances', 'campaigns'], load);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap justify-between gap-2"><h1 className="text-2xl font-extrabold">{tx('Rapports', 'التقارير')}</h1>
        <div className="flex gap-2">
        <button className="btn btn-ghost" type="button" disabled={pdfBusy} onClick={async () => {
          const [category, docType] = reportPdf[type];
          setPdfBusy(true);
          try {
            await downloadFile('/documents/pdf', { category, type: docType, ...filters, lang: localStorage.getItem('fbms_lang') || 'fr' }, `fbms-${type}.pdf`);
            notify.success({ title: tx('PDF généré', 'تم إنشاء PDF'), message: tx('Le rapport a été téléchargé.', 'تم تنزيل التقرير.') });
          } catch (error) {
            notify.error({ title: tx('PDF non généré', 'تعذر إنشاء PDF'), message: error.response?.data?.message || error.message });
          } finally {
            setPdfBusy(false);
          }
        }}><FileText size={15} />PDF</button>
        <button className="btn btn-primary" onClick={async () => {
          try {
            await downloadFile(`/reports/${type}/export`, filters, `fbms-${type}.xlsx`);
            notify.success({ title: tx('Export Excel', 'تصدير Excel'), message: tx('Le rapport a été téléchargé.', 'تم تنزيل التقرير.') });
          } catch (error) { fail(error); }
        }}>Excel</button>
        </div>
      </div>
      <div className="card grid gap-3 p-4 md:grid-cols-3">
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([id, fr, ar]) => <option key={id} value={id}>{tx(fr, ar)}</option>)}</select>
        <input className="field" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <input className="field" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
      </div>
      {report.rows?.length > 0 && (
        <InfoAlert title={tx('Rapport disponible', 'تقرير متاح')} message={tx('Les lignes ci-dessous viennent des commandes enregistrées.', 'الصفوف أدناه مأخوذة من الطلبات المسجلة.')} />
      )}
      {report.summary && <div className="card grid gap-3 p-4 md:grid-cols-3">{Object.entries(report.summary).map(([key, value]) => <div key={key}><div className="label">{key}</div><div className="font-extrabold">{typeof value === 'number' ? money(value) : String(value)}</div></div>)}</div>}
      <div className="card table-wrap"><table className="data"><thead><tr>{(report.columns || []).map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>{(report.rows || []).map((row, index) => <tr key={index}>{(report.columns || []).map((column) => <td key={column.key}>{column.format === 'money' ? money(row[column.key]) : String(row[column.key] ?? '—')}</td>)}</tr>)}</tbody>
      </table></div>
    </div>
  );
}
