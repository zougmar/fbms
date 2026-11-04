export const STATUSES = ['À confirmer', 'Confirmée', 'En préparation', 'Expédiée', 'Livrée', 'Retour', 'Annulée'];
export const DELIVERY_STATUSES = ['Expédiée', 'Livrée', 'Retour'];

export function money(value) {
  if (value === undefined || value === null || value === '') return '—';
  return `${new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)} MAD`;
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date);
}

export function statusLabel(status, tx) {
  const labels = {
    'À confirmer': tx('À confirmer', 'بانتظار التأكيد'),
    'Confirmée': tx('Confirmée', 'مؤكدة'),
    'En préparation': tx('En préparation', 'قيد التحضير'),
    'Expédiée': tx('Expédiée', 'تم الشحن'),
    'Livrée': tx('Livrée', 'مسلّمة'),
    'Retour': tx('Retour', 'مرتجع'),
    'Annulée': tx('Annulée', 'ملغاة')
  };
  return labels[status] || status;
}

export function roleLabel(role, tx) {
  const labels = {
    super_admin: ['Super Admin', 'مشرف أعلى'],
    admin: ['Admin', 'مدير'],
    manager: ['Manager', 'مسؤول'],
    employee: ['Livreur', 'موصّل'],
    livreur: ['Livreur', 'موصّل'],
    confirmation_agent: ['Agent de confirmation', 'وكيل التأكيد']
  };
  const pair = labels[role];
  return pair ? tx(pair[0], pair[1]) : (role || '—');
}

export function allowsPage(user, allowed, path, perm) {
  if (user?.role === 'super_admin') return true;
  if (path === '/cities') {
    const cities = user?.permissions?.cities;
    if (cities && Object.prototype.hasOwnProperty.call(cities, 'view')) return Boolean(cities.view);
    return allowed('settings', 'view') || allowed('orders', 'view');
  }
  return allowed(...perm);
}

export function statusTone(status) {
  const tones = {
    'À confirmer': 'status-wait',
    'Confirmée': 'status-progress',
    'En préparation': 'status-progress',
    'Expédiée': 'status-ship',
    'Livrée': 'status-done',
    'Retour': 'status-return',
    'Annulée': 'status-cancel'
  };
  return tones[status] || 'status-progress';
}
