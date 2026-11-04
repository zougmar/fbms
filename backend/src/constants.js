const ORDER_STATUSES = [
  'À confirmer',
  'Confirmée',
  'En préparation',
  'Expédiée',
  'Livrée',
  'Retour',
  'Annulée'
];

const SHIPPED_STATUSES = ['Expédiée', 'Livrée', 'Retour'];
const DELIVERY_STATUSES = ['Expédiée', 'Livrée', 'Retour'];
const STOCK_DEDUCT_STATUSES = ['Confirmée', 'En préparation', 'Expédiée', 'Livrée'];
const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'refunded'];
const ROLES = ['super_admin', 'admin', 'manager', 'livreur', 'confirmation_agent'];
const PRODUCT_STATUSES = ['active', 'inactive', 'archived'];
const PLATFORMS = ['Meta Ads', 'Other'];

const PERMISSION_MODULES = {
  dashboard: ['view'],
  orders: ['view', 'create', 'edit', 'delete', 'export'],
  products: ['view', 'create', 'edit', 'delete'],
  delivery: ['view', 'edit', 'export'],
  cities: ['view'],
  advertising: ['view', 'create', 'edit', 'delete'],
  finances: ['view', 'create', 'edit', 'delete', 'export'],
  reports: ['view', 'export'],
  users: ['view', 'create', 'edit', 'delete'],
  settings: ['view', 'edit'],
  documents: ['view', 'generate', 'financial'],
  tasks: ['view', 'create', 'edit', 'delete']
};

function emptyPermissions(value = false) {
  const permissions = {};
  for (const [mod, actions] of Object.entries(PERMISSION_MODULES)) {
    permissions[mod] = {};
    for (const action of actions) permissions[mod][action] = value;
  }
  return permissions;
}

function grant(permissions, mod, actions) {
  actions.forEach((action) => {
    permissions[mod][action] = true;
  });
}

function roleDefaults(role) {
  if (role === 'super_admin' || role === 'admin') return emptyPermissions(true);
  const permissions = emptyPermissions(false);
  if (role === 'manager') {
    grant(permissions, 'dashboard', ['view']);
    grant(permissions, 'orders', ['view', 'create', 'edit', 'export']);
    grant(permissions, 'products', ['view', 'create', 'edit', 'delete']);
    grant(permissions, 'delivery', ['view', 'edit', 'export']);
    grant(permissions, 'cities', ['view']);
    grant(permissions, 'advertising', ['view', 'create', 'edit']);
    grant(permissions, 'finances', ['view', 'export']);
    grant(permissions, 'reports', ['view', 'export']);
    grant(permissions, 'users', ['view']);
    grant(permissions, 'settings', ['view']);
    grant(permissions, 'documents', ['view', 'generate', 'financial']);
    grant(permissions, 'tasks', ['view']);
    return permissions;
  }
  if (role === 'livreur') {
    grant(permissions, 'dashboard', ['view']);
    grant(permissions, 'orders', ['view']);
    grant(permissions, 'products', ['view']);
    grant(permissions, 'delivery', ['view']);
    grant(permissions, 'cities', ['view']);
    grant(permissions, 'documents', ['view', 'generate']);
    grant(permissions, 'tasks', ['view']);
    return permissions;
  }
  if (role === 'confirmation_agent') {
    grant(permissions, 'dashboard', ['view']);
    grant(permissions, 'orders', ['view', 'edit']);
    grant(permissions, 'delivery', ['view']);
    grant(permissions, 'cities', ['view']);
    grant(permissions, 'documents', ['view', 'generate']);
    grant(permissions, 'tasks', ['view']);
    return permissions;
  }
  return permissions;
}

function sanitizePermissions(input) {
  const clean = emptyPermissions(false);
  for (const [mod, actions] of Object.entries(PERMISSION_MODULES)) {
    for (const action of actions) {
      clean[mod][action] = Boolean(input?.[mod]?.[action]);
    }
  }
  return clean;
}

const DOCUMENT_TYPES = {
  orders: ['individual', 'all', 'confirmed', 'delivered', 'returned', 'cancelled', 'daily', 'monthly', 'by-city', 'by-product', 'by-range'],
  delivery: ['bon', 'manifest', 'labels', 'report', 'returns', 'by-city', 'by-carrier', 'reconciliation'],
  finance: ['daily', 'weekly', 'monthly', 'revenue', 'expenses', 'pnl', 'cashflow', 'ads', 'product-profit'],
  products: ['catalog', 'pricelist', 'stock', 'low-stock', 'performance'],
  dashboard: ['summary']
};

module.exports = {
  ORDER_STATUSES,
  SHIPPED_STATUSES,
  DELIVERY_STATUSES,
  STOCK_DEDUCT_STATUSES,
  PAYMENT_STATUSES,
  ROLES,
  PRODUCT_STATUSES,
  PLATFORMS,
  PERMISSION_MODULES,
  DOCUMENT_TYPES,
  emptyPermissions,
  roleDefaults,
  sanitizePermissions
};
