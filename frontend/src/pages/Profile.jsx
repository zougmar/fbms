import { useEffect, useState } from 'react';
import api, { clearTabToken } from '../services/api';
import { useApp } from '../context';
import { formatDate } from '../utils';
import { Field } from '../components/ui';
import Avatar from '../components/Avatar';

export default function Profile() {
  const { user, tx, fail, notify, refreshUser, setLang, setTheme } = useApp();
  const [form, setForm] = useState({ name: user?.name || '', phone: user?.phone || '', language: user?.language || 'fr', theme: user?.theme || 'light' });
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '' });
  const [sessions, setSessions] = useState([]);
  const load = () => api.get('/auth/sessions').then((res) => setSessions(res.data.items)).catch(fail);
  useEffect(() => { load(); }, []);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-extrabold">{tx('Profil', 'الملف')}</h1>
      <section className="card flex max-w-xl items-center gap-4 p-5">
        <Avatar user={user} size={84} />
        <div className="grid gap-2">
          <div className="font-extrabold">{user?.name}</div>
          <label className="btn btn-primary w-fit cursor-pointer">
            {tx('Photo de profil', 'صورة الملف')}
            <input className="hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              const data = new FormData();
              data.append('avatar', file);
              try {
                const res = await api.post('/auth/avatar', data);
                refreshUser(res.data.user);
                notify.success({ title: tx('Photo enregistrée', 'تم حفظ الصورة'), message: tx('Votre photo de profil est à jour.', 'تم تحديث صورة ملفك.') });
              } catch (error) { fail(error); }
            }} />
          </label>
          {user?.avatar && <button className="btn btn-ghost w-fit" onClick={async () => {
            const res = await api.delete('/auth/avatar');
            refreshUser(res.data.user);
          }}>{tx('Retirer la photo', 'حذف الصورة')}</button>}
        </div>
      </section>
      <form className="card grid max-w-xl gap-3 p-5" onSubmit={async (event) => {
        event.preventDefault();
        const res = await api.put('/auth/profile', form);
        refreshUser(res.data.user);
        setLang(res.data.user.language);
        setTheme(res.data.user.theme);
        notify.success({ title: tx('Profil mis à jour', 'تم تحديث الملف'), message: tx('Vos informations ont été enregistrées.', 'تم حفظ معلوماتك.') });
      }}>
        <Field label={tx('Nom', 'الاسم')}><input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label={tx('Téléphone', 'الهاتف')}><input className="field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label={tx('Langue', 'اللغة')}><select className="select" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}><option value="fr">Français</option><option value="ar">العربية</option></select></Field>
        <Field label={tx('Thème', 'المظهر')}><select className="select" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}><option value="light">{tx('Clair', 'فاتح')}</option><option value="dark">{tx('Sombre', 'داكن')}</option></select></Field>
        <button className="btn btn-primary w-fit">{tx('Enregistrer', 'حفظ')}</button>
      </form>
      <form className="card grid max-w-xl gap-3 p-5" onSubmit={async (event) => {
        event.preventDefault();
        await api.put('/auth/password', password);
        setPassword({ currentPassword: '', newPassword: '' });
        notify.success({ title: tx('Mot de passe changé', 'تم تغيير كلمة المرور'), message: tx('Les autres sessions ont été fermées.', 'تم إغلاق الجلسات الأخرى.') });
      }}>
        <h2 className="font-extrabold">{tx('Changer le mot de passe', 'تغيير كلمة المرور')}</h2>
        <input className="field" type="password" placeholder={tx('Actuel', 'الحالية')} value={password.currentPassword} onChange={(e) => setPassword({ ...password, currentPassword: e.target.value })} />
        <input className="field" type="password" placeholder={tx('Nouveau', 'الجديدة')} value={password.newPassword} onChange={(e) => setPassword({ ...password, newPassword: e.target.value })} />
        <button className="btn btn-ghost w-fit">{tx('Mettre à jour', 'تحديث')}</button>
      </form>
      <section className="card max-w-xl p-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-extrabold">{tx('Sessions', 'الجلسات')}</h2><button className="btn btn-ghost" onClick={async () => { await api.post('/auth/logout-all'); clearTabToken(); window.location.assign('/login'); }}>{tx('Fermer toutes les sessions', 'إغلاق كل الجلسات')}</button></div>
        <ul className="grid gap-2 text-sm">{sessions.map((session) => <li key={session.id} className="flex items-center justify-between gap-2"><span>{formatDate(session.createdAt)} · {session.current ? tx('Cet appareil', 'هذا الجهاز') : session.ip}</span>{!session.current && <button className="btn btn-ghost" onClick={async () => { await api.delete(`/auth/sessions/${session.id}`); load(); }}>{tx('Révoquer', 'إلغاء')}</button>}</li>)}</ul>
      </section>
    </div>
  );
}
