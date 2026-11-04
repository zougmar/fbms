import { Fragment, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api from '../services/api';
import { useApp } from '../context';
import { formatDate, roleLabel } from '../utils';

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remain = seconds % 60;
  return [hours, minutes, remain].map((part) => String(part).padStart(2, '0')).join(':');
}

function LiveDuration({ seconds, running, anchor }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const extra = running && anchor ? Math.max(0, Math.floor((now - anchor) / 1000)) : 0;
  return formatDuration((Number(seconds) || 0) + extra);
}

function monthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function Performance() {
  const { tx, fail } = useApp();
  const [filters, setFilters] = useState({ from: monthStart(), to: today() });
  const [focus, setFocus] = useState('');
  const [data, setData] = useState(null);
  const [open, setOpen] = useState('');
  const load = (quiet) => api.get('/users/performance', { params: filters }).then((res) => {
    setData({ ...res.data, anchor: Date.now() });
  }).catch((error) => { if (!quiet) fail(error); });
  useEffect(() => { load(false); }, [filters]);
  useEffect(() => {
    const timer = setInterval(() => load(true), 5000);
    return () => clearInterval(timer);
  }, [filters]);
  useEffect(() => {
    let stop = false;
    const pull = () => api.get('/users/presence').then((res) => {
      if (stop) return;
      const online = new Set((res.data.online || []).map(String));
      setData((prev) => {
        if (!prev?.ranking) return prev;
        const extra = prev.anchor ? Math.max(0, Math.floor((Date.now() - prev.anchor) / 1000)) : 0;
        let changed = false;
        const ranking = prev.ranking.map((row) => {
          const nextOnline = online.has(String(row.userId));
          if (nextOnline === Boolean(row.online)) return row;
          changed = true;
          if (row.online && !nextOnline) {
            return {
              ...row,
              online: false,
              todaySeconds: (row.todaySeconds || 0) + extra,
              sessions: (row.sessions || []).map((session) => (session.open ? { ...session, open: false, seconds: (session.seconds || 0) + extra } : session))
            };
          }
          return { ...row, online: nextOnline };
        });
        return changed ? { ...prev, ranking } : prev;
      });
    }).catch(() => {});
    pull();
    const timer = setInterval(pull, 3000);
    return () => { stop = true; clearInterval(timer); };
  }, []);

  const ranking = data?.ranking || [];
  const chartPeople = useMemo(() => ranking.map((row) => ({
    name: row.name.split(' ')[0],
    delivered: row.delivered,
    confirmed: row.confirmed,
    tasks: row.tasksCompleted,
    cancelled: row.cancelled
  })), [ranking]);
  const daily = useMemo(() => {
    if (!focus) return data?.daily || [];
    return ranking.find((row) => row.userId === focus)?.daily || [];
  }, [data, focus, ranking]);

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-extrabold">{tx('Performance des employés', 'أداء الموظفين')}</h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>{tx('Classement calculé à partir des livraisons, confirmations, tâches terminées et heures de session enregistrées.', 'الترتيب محسوب من التسليمات والتأكيدات والمهام المنتهية وساعات الجلسات المسجلة.')}</p>
      </div>
      <div className="card grid gap-3 p-4 md:grid-cols-3">
        <input className="field" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <input className="field" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        <select className="select" value={focus} onChange={(e) => setFocus(e.target.value)}>
          <option value="">{tx('Toute l’équipe', 'كل الفريق')}</option>
          {ranking.map((row) => <option key={row.userId} value={row.userId}>{row.name}</option>)}
        </select>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 font-extrabold">{tx('Comparaison', 'المقارنة')}</h2>
          <div className="h-72 w-full">
            <ResponsiveContainer>
              <BarChart data={chartPeople}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="delivered" name={tx('Livrées', 'مسلّمة')} fill="#0f766e" />
                <Bar dataKey="confirmed" name={tx('Confirmées', 'مؤكدة')} fill="#1d4ed8" />
                <Bar dataKey="tasks" name={tx('Tâches', 'المهام')} fill="#c47b12" />
                <Bar dataKey="cancelled" name={tx('Annulées', 'ملغاة')} fill="#be3a31" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card p-4">
          <h2 className="mb-3 font-extrabold">{tx('Évolution quotidienne', 'التطور اليومي')}</h2>
          <div className="h-72 w-full">
            <ResponsiveContainer>
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="delivered" name={tx('Livrées', 'مسلّمة')} stroke="#0f766e" dot={false} />
                <Line type="monotone" dataKey="confirmed" name={tx('Confirmées', 'مؤكدة')} stroke="#1d4ed8" dot={false} />
                <Line type="monotone" dataKey="tasks" name={tx('Tâches', 'المهام')} stroke="#c47b12" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
      {data?.monthly?.length > 0 && <section className="card p-4">
        <h2 className="mb-3 font-extrabold">{tx('Mensuel', 'شهري')}</h2>
        <div className="h-64 w-full">
          <ResponsiveContainer>
            <BarChart data={data.monthly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="delivered" name={tx('Livrées', 'مسلّمة')} fill="#0f766e" />
              <Bar dataKey="confirmed" name={tx('Confirmées', 'مؤكدة')} fill="#1d4ed8" />
              <Bar dataKey="tasks" name={tx('Tâches', 'المهام')} fill="#c47b12" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>}
      <div className="card table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>{tx('Employé', 'الموظف')}</th>
              <th>{tx('Rôle', 'الدور')}</th>
              <th className="num">{tx('Aujourd’hui', 'اليوم')}</th>
              <th className="num">{tx('Heures', 'الساعات')}</th>
              <th className="num">{tx('Tâches', 'المهام')}</th>
              <th className="num">{tx('Confirmées', 'مؤكدة')}</th>
              <th className="num">{tx('Livrées', 'مسلّمة')}</th>
              <th className="num">{tx('Annulées', 'ملغاة')}</th>
              <th className="num">{tx('Résultat', 'النتيجة')}</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((row) => (
              <Fragment key={row.userId}>
                <tr onClick={() => setOpen(open === row.userId ? '' : row.userId)} className="cursor-pointer">
                  <td className="font-extrabold">{row.rank}</td>
                  <td className="font-bold">{row.name}</td>
                  <td>{roleLabel(row.role, tx)}</td>
                  <td className="num"><span className="live-clock">{row.online && <span className="presence-dot is-online" title={tx('En ligne', 'متصل')} />}<LiveDuration seconds={row.todaySeconds} running={Boolean(row.online)} anchor={data.anchor} /></span></td>
                  <td className="num">{formatDuration(row.seconds ?? Math.round((row.hours || 0) * 3600))}</td>
                  <td className="num">{row.tasksCompleted}</td>
                  <td className="num">{row.confirmed}</td>
                  <td className="num">{row.delivered}</td>
                  <td className="num">{row.cancelled}</td>
                  <td className="num font-extrabold">{row.result}</td>
                </tr>
                {open === row.userId && (
                  <tr key={`${row.userId}-detail`}>
                    <td colSpan={10}>
                      <div className="grid gap-2 py-2 text-sm">
                        <div>{tx('Tâches assignées sur la période', 'المهام المسندة خلال الفترة')}: {row.tasksAssigned}</div>
                        {row.sessions.length === 0 && <div style={{ color: 'var(--muted)' }}>{tx('Aucune session enregistrée.', 'لا توجد جلسات مسجلة.')}</div>}
                        {row.sessions.map((session, index) => (
                          <div key={`${row.userId}-${index}`}>{tx('Connexion', 'دخول')} {formatDate(session.login)} {new Date(session.login).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · {session.logout ? `${tx('Déconnexion', 'خروج')} ${new Date(session.logout).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : tx('Session ouverte', 'جلسة مفتوحة')} · <LiveDuration seconds={session.seconds ?? Math.round((session.hours || 0) * 3600)} running={Boolean(session.open && row.online)} anchor={data.anchor} /></div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
