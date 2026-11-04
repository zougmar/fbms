import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import api from '../services/api';
import { useLiveReload } from '../live';
import { useApp } from '../context';
import { roleLabel } from '../utils';
import { Field, Modal } from '../components/ui';
import Avatar from '../components/Avatar';

const ROLES = [
  ['super_admin', 'Super Admin', 'مشرف أعلى'],
  ['admin', 'Admin', 'مدير'],
  ['manager', 'Manager', 'مسؤول'],
  ['livreur', 'Livreur', 'موصّل'],
  ['confirmation_agent', 'Agent de confirmation', 'وكيل التأكيد']
];

const PAGE_ORDER = ['dashboard', 'orders', 'products', 'delivery', 'cities', 'advertising', 'finances', 'reports', 'documents', 'tasks', 'users', 'settings'];

const PAGE_LABELS = {
  dashboard: ['Tableau de bord', 'لوحة التحكم'],
  orders: ['Commandes', 'الطلبات'],
  products: ['Produits', 'المنتجات'],
  delivery: ['Livraison', 'التوصيل'],
  cities: ['Villes & tarifs', 'المدن والأسعار'],
  advertising: ['Publicité', 'الإعلانات'],
  finances: ['Finances', 'المالية'],
  reports: ['Rapports', 'التقارير'],
  documents: ['Centre documents', 'مركز الوثائق'],
  tasks: ['Tâches', 'المهام'],
  users: ['Utilisateurs', 'المستخدمون'],
  settings: ['Paramètres', 'الإعدادات']
};

const ACTION_LABELS = {
  view: ['Accès à la page', 'الوصول إلى الصفحة'],
  create: ['Créer', 'إنشاء'],
  edit: ['Modifier', 'تعديل'],
  delete: ['Supprimer', 'حذف'],
  export: ['Exporter', 'تصدير'],
  generate: ['Générer', 'إنشاء'],
  financial: ['Financier', 'مالي']
};

function copyPermissions(source, modules, role) {
  const permissions = {};
  Object.entries(modules).forEach(([mod, actions]) => {
    permissions[mod] = {};
    actions.forEach((action) => {
      if (mod === 'cities' && action === 'view' && !Object.prototype.hasOwnProperty.call(source?.cities || {}, 'view')) {
        permissions.cities.view = role === 'super_admin' || role === 'admin' || Boolean(source?.settings?.view || source?.orders?.view);
        return;
      }
      permissions[mod][action] = Boolean(source?.[mod]?.[action]);
    });
  });
  return permissions;
}

function lockLivreur(permissions, role) {
  if (role !== 'livreur' || !permissions?.orders) return permissions;
  return {
    ...permissions,
    orders: { ...permissions.orders, view: true, create: false, edit: false, delete: false, export: false }
  };
}

function fillPermissions(modules, value) {
  const permissions = {};
  Object.entries(modules).forEach(([mod, actions]) => {
    permissions[mod] = {};
    actions.forEach((action) => { permissions[mod][action] = value; });
  });
  return permissions;
}

function PageAccess({ label, hint, actions, values, disabled, lockedActions = [], onTogglePage, onToggleAction, tx }) {
  const selected = actions.filter((action) => values?.[action]).length;
  return (
    <fieldset className="perm-card" disabled={disabled}>
      <label className="perm-page">
        <input
          type="checkbox"
          checked={selected === actions.length && actions.length > 0}
          ref={(node) => { if (node) node.indeterminate = selected > 0 && selected < actions.length; }}
          onChange={(event) => onTogglePage(event.target.checked)}
        />
        <span>
          <span className="perm-title">{label}</span>
          {hint && <span className="perm-hint">{hint}</span>}
        </span>
      </label>
      <div className="perm-actions">
        {actions.map((action) => (
          <label key={action} className="perm-action">
            <input type="checkbox" checked={Boolean(values?.[action])} disabled={lockedActions.includes(action)} onChange={(event) => onToggleAction(action, event.target.checked)} />
            {tx(...(ACTION_LABELS[action] || [action, action]))}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function Users() {
  const { user: me, tx, allowed, fail, notify } = useApp();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const superAdmin = me?.role === 'super_admin';
  const [online, setOnline] = useState(() => new Set());
  const load = () => api.get('/users').then((res) => setRows(res.data.items)).catch(fail);
  useEffect(() => { load(); }, []);
  useLiveReload(form ? [] : ['users'], load);
  useEffect(() => {
    let stop = false;
    const tick = () => api.get('/users/presence').then((res) => {
      if (!stop) setOnline(new Set(res.data.online || []));
    }).catch(() => {});
    tick();
    const timer = setInterval(tick, 3000);
    window.addEventListener('focus', tick);
    return () => {
      stop = true;
      clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, []);
  useEffect(() => {
    if (!superAdmin) return;
    api.get('/users/access-catalog').then((res) => setCatalog(res.data)).catch(fail);
  }, [superAdmin]);

  const openCreate = () => setForm({
    name: '',
    email: '',
    password: '',
    role: 'livreur',
    active: true,
    permissionsReady: Boolean(catalog),
    permissions: catalog ? lockLivreur(copyPermissions(catalog.defaults.livreur, catalog.modules, 'livreur'), 'livreur') : null
  });
  const openEdit = (row) => setForm({
    ...row,
    password: '',
    permissionsReady: Boolean(catalog),
    permissions: catalog ? lockLivreur(copyPermissions(row.permissions || catalog.defaults[row.role], catalog.modules, row.role), row.role) : row.permissions
  });
  useEffect(() => {
    if (!catalog) return;
    setForm((prev) => {
      if (!prev || prev.permissionsReady) return prev;
      return {
        ...prev,
        permissionsReady: true,
        permissions: lockLivreur(copyPermissions(prev.permissions || catalog.defaults[prev.role || 'livreur'], catalog.modules, prev.role || 'livreur'), prev.role || 'livreur')
      };
    });
  }, [catalog]);
  const locked = form?.role === 'super_admin';

  const setRole = (role) => setForm((prev) => ({
    ...prev,
    role,
    permissionsReady: Boolean(catalog),
    permissions: catalog ? lockLivreur(copyPermissions(catalog.defaults[role], catalog.modules, role), role) : prev.permissions
  }));
  const setPage = (mod, actions, checked) => setForm((prev) => {
    const next = Object.fromEntries(actions.map((action) => [action, checked]));
    const permissions = lockLivreur({ ...prev.permissions, [mod]: next }, prev.role);
    return { ...prev, permissions };
  });
  const setAction = (mod, action, checked) => setForm((prev) => {
    if (prev.role === 'livreur' && mod === 'orders' && action !== 'view') return prev;
    const next = { ...prev.permissions?.[mod], [action]: checked };
    if (action === 'view' && !checked) Object.keys(next).forEach((key) => { next[key] = false; });
    if (action !== 'view' && checked) next.view = true;
    return { ...prev, permissions: lockLivreur({ ...prev.permissions, [mod]: next }, prev.role) };
  });

  const modules = catalog?.modules || {};
  const moduleIds = [...PAGE_ORDER.filter((id) => modules[id]), ...Object.keys(modules).filter((id) => !PAGE_ORDER.includes(id))];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="text-2xl font-extrabold">{tx('Utilisateurs', 'المستخدمون')}</h1><div className="flex flex-wrap gap-2">{allowed('users', 'view') && <Link className="btn btn-ghost" to="/users/performance">{tx('Performance', 'الأداء')}</Link>}{allowed('users', 'create') && <button className="btn btn-primary" onClick={openCreate}>{tx('Inviter', 'إضافة')}</button>}</div></div>
      <div className="card table-wrap"><table className="data"><thead><tr><th></th><th>{tx('Nom', 'الاسم')}</th><th>Email</th><th>{tx('Rôle', 'الدور')}</th><th>{tx('Actions', 'إجراءات')}</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row._id}><td><Avatar user={row} size={36} /></td><td className="font-bold"><span className="user-name"><span className={`presence-dot${online.has(String(row._id)) ? ' is-online' : ''}`} role="img" aria-label={online.has(String(row._id)) ? tx('En ligne', 'متصل') : tx('Hors ligne', 'غير متصل')} title={online.has(String(row._id)) ? tx('En ligne', 'متصل') : tx('Hors ligne', 'غير متصل')} />{row.name}</span></td><td>{row.email}</td><td>{roleLabel(row.role, tx)}</td><td><div className="row-actions">{allowed('users', 'edit') && <button className="btn btn-edit" type="button" onClick={() => openEdit(row)}><Pencil size={15} />{tx('Modifier', 'تعديل')}</button>}{allowed('users', 'delete') && <button className="btn btn-delete" type="button" onClick={async () => {
              const proceed = await notify.confirm({
                title: tx('Supprimer l’utilisateur', 'حذف المستخدم'),
                message: tx(`Retirer ${row.name} de FBMS ?`, `حذف ${row.name} من FBMS؟`),
                cancelLabel: tx('Annuler', 'إلغاء'),
                confirmLabel: tx('Supprimer', 'حذف')
              });
              if (!proceed) return;
              try {
                await api.delete(`/users/${row._id}`);
                notify.success({ title: tx('Utilisateur supprimé', 'تم حذف المستخدم'), message: row.name });
                load();
              } catch (error) { fail(error); }
            }}><Trash2 size={15} />{tx('Supprimer', 'حذف')}</button>}</div></td></tr>)}</tbody>
      </table></div>
      {form && <Modal wide title={form.email || tx('Utilisateur', 'مستخدم')} onClose={() => setForm(null)}><div className="grid gap-3">
        <div className="flex items-center gap-3">
          <Avatar user={form} size={64} />
          {form._id && <label className="btn btn-ghost cursor-pointer">
            {tx('Photo', 'صورة')}
            <input className="hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              const data = new FormData();
              data.append('avatar', file);
              try {
                const res = await api.post(`/users/${form._id}/avatar`, data);
                setForm({ ...form, avatar: res.data.user.avatar });
                notify.success({ title: tx('Photo enregistrée', 'تم حفظ الصورة'), message: tx('La photo de profil est à jour.', 'تم تحديث صورة الملف.') });
                load();
              } catch (error) { fail(error); }
            }} />
          </label>}
        </div>
        <Field label={tx('Nom', 'الاسم')}><input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        {!form._id && <Field label="Email"><input className="field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>}
        <Field label={tx('Mot de passe', 'كلمة المرور')}><input className="field" type="password" value={form.password || ''} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <Field label={tx('Rôle', 'الدور')}><select className="select" value={form.role} onChange={(e) => setRole(e.target.value)}>{ROLES.map(([id, fr, ar]) => <option key={id} value={id}>{tx(fr, ar)}</option>)}</select></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> {tx('Compte actif', 'حساب نشط')}</label>
        {superAdmin && (
          <section className="perm-box">
            <div className="perm-head">
              <div>
                <h3>{tx('Accès aux pages', 'الوصول إلى الصفحات')}</h3>
                <p>{locked
                  ? tx('Le super administrateur a toujours un accès complet.', 'المشرف الأعلى يملك دائماً وصولاً كاملاً.')
                  : tx('Cochez les pages et les actions autorisées. Le profil reste accessible.', 'حدد الصفحات والإجراءات المسموحة. يبقى الملف الشخصي متاحاً.')}</p>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-ghost" type="button" disabled={locked || !catalog} onClick={() => setForm((prev) => ({ ...prev, permissions: lockLivreur(fillPermissions(modules, true), prev.role) }))}>{tx('Tout sélectionner', 'تحديد الكل')}</button>
                <button className="btn btn-ghost" type="button" disabled={locked || !catalog} onClick={() => setForm((prev) => ({ ...prev, permissions: lockLivreur(fillPermissions(modules, false), prev.role) }))}>{tx('Tout désélectionner', 'إلغاء الكل')}</button>
              </div>
            </div>
            <label className="perm-card perm-fixed">
              <input type="checkbox" checked disabled />
              <span>
                <span className="perm-title">{tx('Profil', 'الملف الشخصي')}</span>
                <span className="perm-hint">{tx('Toujours accessible', 'متاح دائماً')}</span>
              </span>
            </label>
            {form.permissions && moduleIds.map((mod) => (
              <PageAccess
                key={mod}
                label={tx(...(PAGE_LABELS[mod] || [mod, mod]))}
                hint={mod === 'orders' ? tx('Liste et détail', 'القائمة والتفاصيل') : ''}
                actions={modules[mod]}
                values={locked ? fillPermissions(modules, true)[mod] : form.permissions[mod]}
                disabled={locked}
                lockedActions={form.role === 'livreur' && mod === 'orders' ? ['create', 'edit', 'delete', 'export'] : []}
                tx={tx}
                onTogglePage={(checked) => setPage(mod, modules[mod], checked)}
                onToggleAction={(action, checked) => setAction(mod, action, checked)}
              />
            ))}
          </section>
        )}
        <button className="btn btn-primary" disabled={superAdmin && !form.permissionsReady} onClick={async () => {
          const payload = { name: form.name, role: form.role, active: form.active !== false };
          if (form.password) payload.password = form.password;
          if (superAdmin && form.permissions && form.role !== 'super_admin') payload.permissions = form.permissions;
          try {
            if (form._id) await api.put(`/users/${form._id}`, payload);
            else await api.post('/users', { ...payload, email: form.email, password: form.password }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
            notify.success({ title: tx('Utilisateur enregistré', 'تم حفظ المستخدم'), message: tx('Le compte a été mis à jour.', 'تم تحديث الحساب.') });
            setForm(null);
            load();
          } catch (error) { fail(error); }
        }}>{tx('Enregistrer', 'حفظ')}</button>
      </div></Modal>}
    </div>
  );
}
