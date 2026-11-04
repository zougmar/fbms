import { useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errorText } from '../services/api';
import { useApp } from '../context';

export default function Forgot() {
  const { tx, notify } = useApp();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [token, setToken] = useState('');
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <form className="card w-full max-w-md p-6" onSubmit={async (event) => {
        event.preventDefault();
        try {
          const res = await api.post('/auth/forgot-password', { email });
          setMessage(res.data.message);
          setToken(res.data.devResetToken || '');
          notify.info({
            title: tx('Demande envoyée', 'تم إرسال الطلب'),
            message: res.data.message
          });
        } catch (error) {
          const message = errorText(error);
          setMessage(message);
          notify.error({ title: tx('Échec', 'فشل'), message });
        }
      }}>
        <h1 className="mb-4 text-2xl font-extrabold">{tx('Réinitialiser', 'إعادة التعيين')}</h1>
        <label className="label">Email</label>
        <input className="field mb-4" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn btn-primary w-full">{tx('Créer le lien', 'إنشاء الرابط')}</button>
        {message && <p className="mt-4 text-sm">{message}</p>}
        {token && <Link className="mt-3 block text-sm" style={{ color: 'var(--brand)' }} to={`/reset-password?token=${token}`}>{tx('Ouvrir la page de nouveau mot de passe', 'فتح صفحة كلمة المرور الجديدة')}</Link>}
        <Link className="mt-4 block text-sm" to="/login">{tx('Retour', 'رجوع')}</Link>
      </form>
    </div>
  );
}
