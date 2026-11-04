import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import client, { readToken } from '../services/api';
import { ErrorAlert, InfoAlert, SuccessAlert, WarningAlert } from './alerts';

const NotificationContext = createContext(null);
const VIEWS = { success: SuccessAlert, error: ErrorAlert, warning: WarningAlert, info: InfoAlert };
const DURATION = { success: 4200, error: 7000, warning: 6000, info: 4500 };

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(null);

  const dismiss = useCallback((id) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback((tone, payload = {}) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const item = {
      id,
      tone,
      title: payload.title || tone,
      message: payload.message || '',
      createdAt: new Date().toISOString(),
      read: false
    };
    setItems((current) => [item, ...current].slice(0, 4));
    setHistory((current) => [item, ...current].slice(0, 40));
    const duration = payload.duration ?? DURATION[tone];
    if (duration > 0) window.setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    success: (payload) => push('success', payload),
    error: (payload) => push('error', payload),
    warning: (payload) => push('warning', payload),
    info: (payload) => push('info', payload),
    dismiss,
    history,
    unread: history.filter((item) => !item.read).length,
    open,
    setOpen,
    markAllRead() {
      setHistory((current) => current.map((item) => ({ ...item, read: true })));
    },
    confirm(payload) {
      return new Promise((resolve) => setDialog({ ...payload, resolve }));
    }
  }), [push, dismiss, history, open]);

  return (
    <NotificationContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-relevant="additions">
        {items.map((item) => {
          const View = VIEWS[item.tone] || InfoAlert;
          return <View key={item.id} title={item.title} message={item.message} onClose={() => dismiss(item.id)} />;
        })}
      </div>
      {dialog && (
        <div className="fixed inset-0 z-[95] grid place-items-center p-4">
          <button className="absolute inset-0 bg-black/45" aria-label="Close" onClick={() => { dialog.resolve(false); setDialog(null); }} />
          <div className="relative w-full max-w-md">
            <WarningAlert title={dialog.title} message={dialog.message} />
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => { dialog.resolve(false); setDialog(null); }}>{dialog.cancelLabel || 'Annuler'}</button>
              <button className="btn btn-primary" onClick={() => { dialog.resolve(true); setDialog(null); }}>{dialog.confirmLabel || 'Confirmer'}</button>
            </div>
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
}

export function useNotify() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotify must be used within ToastProvider');
  return context;
}

export function NotificationCenter() {
  const { history, open, setOpen, unread, markAllRead, info } = useNotify();
  const [serverItems, setServerItems] = useState([]);
  const seen = useRef(null);
  const toasted = useRef(new Set());
  const ar = document.documentElement.lang === 'ar';
  useEffect(() => {
    let stop = false;
    const pull = async () => {
      if (!readToken() || document.hidden) return;
      try {
        const res = await client.get('/notifications');
        if (stop) return;
        const items = res.data.items || [];
        if (seen.current) {
          items.filter((item) => !seen.current.has(item._id)).forEach((item) => {
            toasted.current.add(item._id);
            info({ title: item.title, message: item.message, duration: 7000 });
          });
        }
        seen.current = new Set(items.map((item) => item._id));
        setServerItems(items);
      } catch {
        /* the bell stays quiet when the request fails */
      }
    };
    pull();
    const timer = window.setInterval(pull, 3000);
    return () => { stop = true; window.clearInterval(timer); };
  }, [info]);
  const pending = serverItems.filter((item) => !item.read && !toasted.current.has(item._id)).length;
  const badge = unread + pending;
  const decideRequest = async (item, decision) => {
    try {
      await client.post(`/order-requests/${item.request}/decide`, { decision });
      setServerItems((current) => current.map((row) => row._id === item._id ? { ...row, requestStatus: decision === 'accept' ? 'accepted' : 'rejected' } : row));
      info({
        title: decision === 'accept' ? (ar ? 'تم قبول الطلب' : 'Demande acceptée') : (ar ? 'تم رفض الطلب' : 'Demande refusée'),
        message: item.orderNumber || ''
      });
    } catch (error) {
      info({ title: ar ? 'تعذر المعالجة' : 'Décision impossible', message: error.response?.data?.message || error.message });
    }
  };
  return (
    <div className="relative">
      <button
        className="btn btn-ghost"
        aria-label={ar ? 'الإشعارات' : 'Notifications'}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) {
            markAllRead();
            client.post('/notifications/read').catch(() => {});
            setServerItems((current) => current.map((item) => ({ ...item, read: true })));
          }
        }}
      >
        <Bell size={16} />
        {badge > 0 && <span className="alert-count">{badge}</span>}
      </button>
      {open && (
        <div className="notification-center card">
          <div className="mb-2 flex items-center justify-between">
            <strong>{ar ? 'الإشعارات' : 'Notifications'}</strong>
            <button className="btn btn-ghost" onClick={() => setOpen(false)} aria-label={ar ? 'إغلاق' : 'Fermer'}>×</button>
          </div>
          <div className="grid max-h-96 gap-2 overflow-auto">
            {history.length === 0 && serverItems.length === 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>{ar ? 'لا توجد إشعارات' : 'Aucune notification'}</p>}
            {serverItems.map((item) => (
              <div key={item._id} className="alert alert-info">
                <div className="min-w-0 flex-1">
                  <div className="font-extrabold leading-tight">{item.title}</div>
                  {item.message ? <p className="mt-1 whitespace-pre-line text-sm leading-snug">{item.message}</p> : null}
                  {item.kind === 'approval' && item.requestStatus === 'pending' && (
                    <div className="mt-2 flex gap-2">
                      <button className="btn btn-primary" type="button" onClick={() => decideRequest(item, 'accept')}>{ar ? 'قبول' : 'Accepter'}</button>
                      <button className="btn btn-ghost" type="button" onClick={() => decideRequest(item, 'reject')}>{ar ? 'رفض' : 'Refuser'}</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {history.map((item) => {
              const View = VIEWS[item.tone] || InfoAlert;
              return <View key={item.id} title={item.title} message={item.message} />;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
