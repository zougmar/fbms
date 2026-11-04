import { useEffect, useRef, useState } from 'react';
import api, { isStale } from '../services/api';
import { useLiveReload } from '../live';
import { useApp } from '../context';
import { Field, Modal } from '../components/ui';
import { formatDate } from '../utils';

const STATUSES = [
  ['todo', 'À faire', 'للإنجاز'],
  ['in_progress', 'En cours', 'قيد التنفيذ'],
  ['done', 'Terminée', 'منتهية'],
  ['cancelled', 'Annulée', 'ملغاة']
];
const PRIORITIES = [
  ['low', 'Basse', 'منخفضة'],
  ['normal', 'Normale', 'عادية'],
  ['high', 'Haute', 'عالية'],
  ['urgent', 'Urgente', 'عاجلة']
];

function label(list, id, tx) {
  const row = list.find((item) => item[0] === id);
  return row ? tx(row[1], row[2]) : id;
}

export default function Tasks() {
  const { user, tx, allowed, fail, notify } = useApp();
  const oversee = user?.role === 'super_admin' || user?.role === 'admin';
  const canAssign = user?.role === 'super_admin' || (user?.role === 'admin' && allowed('tasks', 'create'));
  const canEditTask = user?.role === 'super_admin' || (user?.role === 'admin' && (allowed('tasks', 'create') || allowed('tasks', 'edit')));
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [people, setPeople] = useState([]);
  const [filters, setFilters] = useState({ status: '', priority: '', assignee: '' });
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const load = () => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
    api.get('/tasks', { params }).then((res) => setRows(res.data.items)).catch(fail);
    if (oversee) api.get('/tasks/summary').then((res) => setSummary(res.data)).catch(() => {});
  };
  useEffect(() => { load(); }, [filters]);
  useLiveReload(form ? [] : ['tasks'], load);
  useEffect(() => {
    if (!canEditTask) return;
    api.get('/tasks/assignees').then((res) => setPeople(res.data.items || [])).catch(fail);
  }, [canEditTask]);

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      if (form._id) await api.put(`/tasks/${form._id}`, { ...form, expectedVersion: form.__v });
      else await api.post('/tasks', form, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      notify.success({ title: tx('Tâche enregistrée', 'تم حفظ المهمة'), message: form.title });
      setForm(null);
      load();
    } catch (error) {
      if (isStale(error)) {
        notify.warning({ title: tx('Modifié ailleurs', 'تم التعديل من جهاز آخر'), message: error.response?.data?.message || error.message });
        setForm(null);
        load();
      } else fail(error);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const patch = async (row, payload) => {
    try {
      await api.put(`/tasks/${row._id}`, { ...payload, expectedVersion: row.__v });
      load();
    } catch (error) {
      if (isStale(error)) {
        notify.warning({ title: tx('Modifié ailleurs', 'تم التعديل من جهاز آخر'), message: error.response?.data?.message || error.message });
        load();
      } else fail(error);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">{tx('Tâches', 'المهام')}</h1>
        {canAssign && <button className="btn btn-primary" type="button" onClick={() => setForm({ title: '', description: '', assignee: '', deadline: '', priority: 'normal' })}>{tx('Assigner', 'إسناد')}</button>}
      </div>
      <div className="card grid gap-3 p-4 md:grid-cols-3">
        <select className="select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">{tx('Tous les états', 'كل الحالات')}</option>
          {STATUSES.map(([id, fr, ar]) => <option key={id} value={id}>{tx(fr, ar)}</option>)}
        </select>
        <select className="select" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
          <option value="">{tx('Toutes les priorités', 'كل الأولويات')}</option>
          {PRIORITIES.map(([id, fr, ar]) => <option key={id} value={id}>{tx(fr, ar)}</option>)}
        </select>
        {oversee && <select className="select" value={filters.assignee} onChange={(e) => setFilters({ ...filters, assignee: e.target.value })}>
          <option value="">{tx('Toute l’équipe', 'كل الفريق')}</option>
          {(people.length ? people : (summary?.people || []).map((person) => ({ _id: person.userId, name: person.name }))).map((person) => <option key={person._id} value={person._id}>{person.name}</option>)}
        </select>}
      </div>
      {oversee && summary && (
        <section className="grid gap-3">
          <h2 className="font-extrabold">{tx('Avancement', 'التقدم')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {[
              [tx('Total', 'المجموع'), summary.totals.total],
              [tx('À faire', 'للإنجاز'), summary.totals.todo],
              [tx('En cours', 'قيد التنفيذ'), summary.totals.in_progress],
              [tx('Terminées', 'المنتهية'), summary.totals.done],
              [tx('En retard', 'متأخرة'), summary.totals.overdue],
              [tx('Annulées', 'الملغاة'), summary.totals.cancelled]
            ].map(([labelText, value]) => (
              <div key={labelText} className="card p-4">
                <div className="text-sm" style={{ color: 'var(--muted)' }}>{labelText}</div>
                <div className="text-2xl font-extrabold">{value || 0}</div>
              </div>
            ))}
          </div>
          <div className="card table-wrap">
            <table className="data">
              <thead><tr>
                <th>{tx('Utilisateur', 'المستخدم')}</th>
                <th>{tx('Tâches', 'المهام')}</th>
                <th>{tx('Terminées', 'المنتهية')}</th>
                <th>{tx('En retard', 'متأخرة')}</th>
                <th>{tx('Avancement', 'التقدم')}</th>
              </tr></thead>
              <tbody>
                {summary.people.map((person) => (
                  <tr key={person.userId}>
                    <td className="font-bold">{person.name}</td>
                    <td className="num">{person.total}</td>
                    <td className="num">{person.done}</td>
                    <td className="num">{person.overdue}</td>
                    <td className="num">{person.progress}%</td>
                  </tr>
                ))}
                {summary.people.length === 0 && <tr><td colSpan="5">{tx('Aucune tâche enregistrée.', 'لا توجد مهام.')}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="task-grid">
        {rows.map((row) => {
          const mine = String(row.assignee) === String(user?._id);
          const late = row.deadline && row.status !== 'done' && row.status !== 'cancelled' && new Date(row.deadline) < new Date();
          return (
            <article key={row._id} className="card grid gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-extrabold">{row.title}</h2>
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>{row.assigneeName} · {label(PRIORITIES, row.priority, tx)}</p>
                </div>
                <span className={`status-pill ${row.status === 'done' ? 'status-done' : late ? 'status-cancel' : 'status-progress'}`}>{label(STATUSES, row.status, tx)}</span>
              </div>
              {row.description && <p className="text-sm">{row.description}</p>}
              <div className="text-sm" style={{ color: late ? 'var(--danger)' : 'var(--muted)' }}>{tx('Échéance', 'الأجل')}: {row.deadline ? formatDate(row.deadline) : '—'}</div>
              {row.completedAt && <div className="text-sm" style={{ color: 'var(--muted)' }}>{tx('Terminée le', 'اكتملت في')} {formatDate(row.completedAt)}</div>}
              <label className="grid gap-1 text-sm">
                {tx('Progression', 'الإنجاز')} {row.progress}%
                <input type="range" min="0" max="100" value={row.progress} disabled={!mine && !canEditTask} onChange={(e) => {
                  const progress = Number(e.target.value);
                  setRows((list) => list.map((item) => item._id === row._id ? { ...item, progress } : item));
                }} onPointerUp={(e) => {
                  const progress = Number(e.target.value);
                  patch(row, { progress, status: progress === 100 ? 'done' : row.status === 'todo' ? 'in_progress' : row.status });
                }} />
              </label>
              <div className="flex flex-wrap gap-2">
                {(mine || canEditTask) && <select className="select" value={row.status} onChange={(e) => patch(row, { status: e.target.value })}>
                  {STATUSES.map(([id, fr, ar]) => <option key={id} value={id}>{tx(fr, ar)}</option>)}
                </select>}
                {canEditTask && <button className="btn btn-edit" type="button" onClick={() => setForm({ ...row, deadline: row.deadline ? String(row.deadline).slice(0, 10) : '' })}>{tx('Modifier', 'تعديل')}</button>}
                {oversee && allowed('tasks', 'delete') && <button className="btn btn-delete" type="button" onClick={async () => { await api.delete(`/tasks/${row._id}`); load(); }}>{tx('Supprimer', 'حذف')}</button>}
              </div>
            </article>
          );
        })}
        {rows.length === 0 && <div className="card p-6 text-sm" style={{ color: 'var(--muted)' }}>{tx('Aucune tâche pour ces filtres.', 'لا توجد مهام لهذه التصفية.')}</div>}
      </div>
      {form && <Modal title={form._id ? tx('Modifier la tâche', 'تعديل المهمة') : tx('Nouvelle tâche', 'مهمة جديدة')} onClose={() => setForm(null)}>
        <div className="grid gap-3">
          <Field label={tx('Titre', 'العنوان')}><input className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label={tx('Description', 'الوصف')}><textarea className="field min-h-24" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label={tx('Assignée à', 'مسندة إلى')}><select className="select" value={form.assignee || ''} onChange={(e) => setForm({ ...form, assignee: e.target.value })}>
            <option value="" />
            {people.map((person) => <option key={person._id} value={person._id}>{person.name}</option>)}
          </select></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tx('Échéance', 'الأجل')}><input className="field" type="date" value={form.deadline || ''} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field>
            <Field label={tx('Priorité', 'الأولوية')}><select className="select" value={form.priority || 'normal'} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {PRIORITIES.map(([id, fr, ar]) => <option key={id} value={id}>{tx(fr, ar)}</option>)}
            </select></Field>
          </div>
          <button className="btn btn-primary" type="button" disabled={saving} onClick={save}>{tx('Enregistrer', 'حفظ')}</button>
        </div>
      </Modal>}
    </div>
  );
}
