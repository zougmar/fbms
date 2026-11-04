import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import api, { errorText } from '../services/api';
import { useApp } from '../context';

export default function Reset() {
  const { tx, notify } = useApp();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <form className="card w-full max-w-md p-6" onSubmit={async (event) => {
        event.preventDefault();
        try {
          await api.post('/auth/reset-password', { token: params.get('token'), password });
          notify.success({
            title: tx('Mot de passe enregistré', 'تم حفظ كلمة المرور'),
            message: tx('Vous pouvez vous connecter.', 'يمكنك تسجيل الدخول.')
          });
          navigate('/login');
        } catch (err) {
          const message = errorText(err);
          setError(message);
          notify.error({ title: tx('Échec', 'فشل'), message });
        }
      }}>
        <h1 className="mb-4 text-2xl font-extrabold">{tx('Nouveau mot de passe', 'كلمة مرور جديدة')}</h1>
        <input className="field mb-4" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8+ lettres et chiffres" />
        {error && <p className="mb-3 text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <button className="btn btn-primary w-full">{tx('Enregistrer', 'حفظ')}</button>
        <Link className="mt-4 block text-sm" to="/login">{tx('Connexion', 'الدخول')}</Link>
      </form>
    </div>
  );
}
