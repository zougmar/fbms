import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info
};

export function AlertCard({ tone, title, message, onClose }) {
  const Icon = ICONS[tone] || Info;
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}>
      <Icon size={20} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="font-extrabold leading-tight">{title}</div>
        {message ? <p className="mt-1 text-sm leading-snug">{message}</p> : null}
      </div>
      {onClose ? (
        <button type="button" className="alert-close" onClick={onClose} aria-label={document.documentElement.lang === 'ar' ? 'إغلاق' : 'Fermer'}>
          <X size={16} />
        </button>
      ) : null}
    </div>
  );
}

export function SuccessAlert(props) {
  return <AlertCard tone="success" {...props} />;
}

export function ErrorAlert(props) {
  return <AlertCard tone="error" {...props} />;
}

export function WarningAlert(props) {
  return <AlertCard tone="warning" {...props} />;
}

export function InfoAlert(props) {
  return <AlertCard tone="info" {...props} />;
}
