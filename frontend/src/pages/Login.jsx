import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useApp } from '../context';
import { errorText } from '../services/api';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export default function Login() {
  const { login, tx, notify } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const switching = params.get('switch') === '1';
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { isSubmitting } } = useForm({ resolver: zodResolver(schema) });

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between p-10 text-white lg:flex" style={{ background: 'radial-gradient(circle at 20% 20%, #1aa396, #102129 55%)' }}>
        <div className="text-2xl font-extrabold">FBMS</div>
        <div>
          <h1 className="max-w-md text-4xl font-extrabold leading-tight">{tx('Pilotez vos commandes, livraisons et marges au Maroc.', 'ديروا الطلبات والتوصيل والهوامش في المغرب.')}</h1>
          <p className="mt-4 max-w-md text-white/80">Full Business Management System · MAD</p>
        </div>
        <div className="text-sm text-white/70">Casablanca · Rabat · Marrakech</div>
      </section>
      <section className="grid place-items-center p-6">
        <form className="card w-full max-w-md p-6" onSubmit={handleSubmit(async (values) => {
          setError('');
          try {
            await login(values.email, values.password);
            notify.success({
              title: tx('Connexion réussie', 'تم تسجيل الدخول'),
              message: tx('Bienvenue dans FBMS.', 'مرحبا بك في FBMS.')
            });
            const from = location.state?.from;
            navigate(typeof from === 'string' && from.startsWith('/scan/') ? from : '/');
          } catch (err) {
            const message = errorText(err);
            setError(message);
            notify.error({
              title: tx('Connexion refusée', 'فشل تسجيل الدخول'),
              message
            });
          }
        })}>
          <div className="mb-6 lg:hidden text-2xl font-extrabold" style={{ color: 'var(--brand)' }}>FBMS</div>
          <h2 className="text-2xl font-extrabold">{tx('Connexion', 'تسجيل الدخول')}</h2>
          <p className="mb-5 mt-1 text-sm" style={{ color: 'var(--muted)' }}>{switching ? tx('Ce compte s’ouvre dans cette fenêtre. L’autre compte reste connecté.', 'يفتح هذا الحساب في هذه النافذة. الحساب الآخر يبقى متصلاً.') : tx('Accès réservé à votre équipe.', 'الدخول مخصص لفريقكم.')}</p>
          <label className="label">{tx('Email', 'البريد')}</label>
          <input className="field mb-3" type="email" {...register('email')} />
          <label className="label">{tx('Mot de passe', 'كلمة المرور')}</label>
          <input className="field mb-4" type="password" {...register('password')} />
          {error && <p className="mb-3 text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
          <button className="btn btn-primary w-full" disabled={isSubmitting}>{tx('Entrer', 'دخول')}</button>
          <Link className="mt-4 block text-sm" style={{ color: 'var(--brand)' }} to="/forgot-password">{tx('Mot de passe oublié', 'نسيت كلمة المرور')}</Link>
        </form>
      </section>
    </div>
  );
}
