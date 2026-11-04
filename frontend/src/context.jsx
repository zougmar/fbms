import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api, { clearTabToken, errorText, readToken, storeToken, writesInFlight } from './services/api';
import { useNotify } from './notifications/ToastProvider';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState(localStorage.getItem('fbms_lang') || 'fr');
  const [theme, setThemeState] = useState(localStorage.getItem('fbms_theme') || 'light');
  const notify = useNotify();

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('fbms_lang', lang);
  }, [lang]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('fbms_theme', theme);
  }, [theme]);

  useEffect(() => {
    const token = readToken();
    if (!token) {
      setLoading(false);
      return undefined;
    }
    api.get('/auth/me').then((res) => {
      setUser(res.data.user);
      if (res.data.user.language) setLangState(res.data.user.language);
      if (res.data.user.theme) setThemeState(res.data.user.theme);
    }).catch((error) => {
      if (error.response?.status === 401) clearTabToken();
    }).finally(() => setLoading(false));
    return undefined;
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let clocks = null;
    let stopped = false;
    const pull = async () => {
      if (document.hidden || stopped) return;
      try {
        const res = await api.get('/sync');
        if (stopped) return;
        const next = res.data.clocks || {};
        if (clocks) {
          const changed = Object.keys(next).filter((key) => next[key] !== clocks[key]);
          if (changed.length && writesInFlight() > 0) return;
          if (changed.includes('users')) {
            const me = await api.get('/auth/me');
            if (!stopped) setUser(me.data.user);
          }
          if (changed.length) window.dispatchEvent(new CustomEvent('fbms:sync', { detail: { changed } }));
        }
        clocks = next;
      } catch { /* the session interceptor handles an expired login */ }
    };
    pull();
    const timer = setInterval(pull, 4000);
    window.addEventListener('focus', pull);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', pull);
    };
  }, [user?._id]);

  const toast = (message) => notify.success({
    title: lang === 'ar' ? 'نجاح' : 'Succès',
    message
  });

  const value = useMemo(() => ({
    user,
    loading,
    lang,
    theme,
    setLang: setLangState,
    setTheme: setThemeState,
    toast,
    notify,
    tx: (fr, ar) => (lang === 'ar' ? ar : fr),
    allowed(mod, action) {
      if (!user) return false;
      if (user.role === 'super_admin') return true;
      const bucket = user.permissions?.[mod];
      if (!bucket?.view) return false;
      return Boolean(bucket[action]);
    },
    async login(email, password) {
      const res = await api.post('/auth/login', { email, password });
      storeToken(res.data.token);
      setUser(res.data.user);
      if (res.data.user.language) setLangState(res.data.user.language);
      return res.data.user;
    },
    async logout() {
      try { await api.post('/auth/logout'); } catch { /* session already gone */ }
      clearTabToken();
      setUser(null);
    },
    refreshUser(next) { setUser(next); },
    fail(error) {
      notify.error({
        title: lang === 'ar' ? 'خطأ' : 'Erreur',
        message: errorText(error)
      });
    }
  }), [user, loading, lang, theme, notify]);

  return (
    <AppContext.Provider value={value}>{children}</AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
