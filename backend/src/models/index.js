const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { roleDefaults } = require('../constants');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 8, select: false },
  phone: { type: String, trim: true, default: '' },
  avatar: { type: String, default: '' },
  role: {
    type: String,
    enum: ['super_admin', 'admin', 'manager', 'livreur', 'confirmation_agent'],
    default: 'livreur'
  },
  permissions: { type: Object, default: undefined },
  permissionsCustom: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  language: { type: String, enum: ['fr', 'ar'], default: 'fr' },
  theme: { type: String, enum: ['light', 'dark'], default: 'light' },
  tokenVersion: { type: Number, default: 0 },
  lastLoginAt: { type: Date, default: null }
}, { timestamps: true });

userSchema.pre('save', async function hashPassword(next) {
  if (!this.permissions) this.permissions = roleDefaults(this.role);
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

const sessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  jti: { type: String, required: true, unique: true },
  userAgent: { type: String, default: '' },
  ip: { type: String, default: '' },
  expiresAt: { type: Date, required: true },
  revoked: { type: Boolean, default: false },
  loggedOutAt: { type: Date, default: null }
}, { timestamps: true });
sessionSchema.index({ revoked: 1, expiresAt: 1 });
sessionSchema.index({ user: 1, revoked: 1, createdAt: -1 });

const passwordResetSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  description: { type: String, default: '' }
}, { timestamps: true });

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, unique: true },
  description: { type: String, default: '' },
  images: [{ type: String }],
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  categoryName: { type: String, default: '' },
  purchasePrice: { type: Number, required: true, min: 0 },
  sellingPrice: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0, max: 100 },
  stock: { type: Number, required: true, min: 0, default: 0 },
  initialStock: { type: Number, required: true, min: 0, default: 0 },
  status: { type: String, enum: ['active', 'inactive', 'archived'], default: 'active' }
}, { timestamps: true });
productSchema.index({ name: 'text', code: 'text' });

const citySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  shippingPrice: { type: Number, required: true, min: 0 },
  zone: { type: String, default: '' },
  notes: { type: String, default: '' },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const shippingCompanySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  phone: { type: String, default: '' },
  notes: { type: String, default: '' },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true },
  orderDate: { type: Date, required: true, index: true },
  customerName: { type: String, required: true, trim: true },
  customerPhone: { type: String, required: true, trim: true, index: true },
  city: { type: mongoose.Schema.Types.ObjectId, ref: 'City', required: true },
  cityName: { type: String, required: true },
  address: { type: String, required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true },
  productCode: { type: String, default: '' },
  quantity: { type: Number, required: true, min: 1 },
  purchasePrice: { type: Number, required: true, min: 0 },
  sellingPrice: { type: Number, required: true, min: 0 },
  totalAmount: { type: Number, required: true, min: 0 },
  status: {
    type: String,
    enum: ['À confirmer', 'Confirmée', 'En préparation', 'Expédiée', 'Livrée', 'Retour', 'Annulée'],
    default: 'À confirmer',
    index: true
  },
  shippingCompany: { type: mongoose.Schema.Types.ObjectId, ref: 'ShippingCompany', default: null },
  shippingCompanyName: { type: String, default: '' },
  trackingNumber: { type: String, default: '', index: true },
  shippingCost: { type: Number, default: 0, min: 0 },
  advertisingCost: { type: Number, default: 0, min: 0 },
  additionalExpenses: { type: Number, default: 0, min: 0 },
  amountCollected: { type: Number, default: 0, min: 0 },
  paymentStatus: { type: String, enum: ['unpaid', 'partial', 'paid', 'refunded'], default: 'unpaid' },
  paymentStatusManual: { type: Boolean, default: false },
  comments: { type: String, default: '' },
  campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'AdvertisingCampaign', default: null },
  campaignName: { type: String, default: '' },
  stockDeducted: { type: Boolean, default: false },
  stockQtyApplied: { type: Number, default: 0 },
  duplicateWarning: { type: Boolean, default: false },
  qrToken: { type: String, unique: true, sparse: true },
  dedupeKey: { type: String },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  assignedToName: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  history: [{
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    action: { type: String, required: true },
    changes: { type: mongoose.Schema.Types.Mixed, default: {} },
    note: { type: String, default: '' }
  }]
}, { timestamps: true });
orderSchema.index({ orderDate: -1, status: 1 });
orderSchema.index({ customerPhone: 1, product: 1, orderDate: 1 });
orderSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
orderSchema.index({ updatedAt: -1 });

const campaignSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  platform: { type: String, enum: ['Meta Ads', 'Other'], required: true },
  platformName: { type: String, default: '' },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  productName: { type: String, default: '' },
  date: { type: Date, required: true },
  budget: { type: Number, default: 0, min: 0 },
  actualSpending: { type: Number, default: 0, min: 0 },
  manualOrders: { type: Number, default: null },
  manualDelivered: { type: Number, default: null },
  notes: { type: String, default: '' }
}, { timestamps: true });

const transactionSchema = new mongoose.Schema({
  type: { type: String, enum: ['income', 'expense'], required: true },
  category: { type: String, required: true, trim: true },
  amount: { type: Number, required: true, min: 0 },
  date: { type: Date, required: true, index: true },
  description: { type: String, default: '' },
  source: { type: String, enum: ['manual'], default: 'manual' },
  referenceKey: { type: String, default: undefined },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
transactionSchema.index({ referenceKey: 1 }, { unique: true, sparse: true });

const documentSchema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true },
  category: { type: String, required: true, index: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  filters: { type: Object, default: {} },
  lang: { type: String, default: 'fr' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const activitySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userName: { type: String, default: '' },
  action: { type: String, required: true },
  entity: { type: String, required: true },
  entityId: { type: String, default: '' },
  details: { type: Object, default: {} }
}, { timestamps: true });
activitySchema.index({ createdAt: -1 });

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  assigneeName: { type: String, default: '' },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedByName: { type: String, default: '' },
  deadline: { type: Date, default: null },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal', index: true },
  status: { type: String, enum: ['todo', 'in_progress', 'done', 'cancelled'], default: 'todo', index: true },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  completedAt: { type: Date, default: null },
  updates: [{
    at: { type: Date, default: Date.now },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    status: { type: String, default: '' },
    progress: { type: Number, default: 0 },
    note: { type: String, default: '' }
  }]
}, { timestamps: true });

const qrScanSchema = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  orderNumber: { type: String, default: '' },
  token: { type: String, required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName: { type: String, default: '' },
  userAgent: { type: String, default: '' }
}, { timestamps: true });

const deliveryConfirmationSchema = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  orderNumber: { type: String, default: '' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userName: { type: String, default: '' },
  previousStatus: { type: String, default: '' },
  note: { type: String, default: '' }
}, { timestamps: true });

const ticketSchema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  orderNumber: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String, default: '' },
  snapshot: { type: Object, default: {} }
}, { timestamps: true });

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  message: { type: String, default: '' },
  kind: { type: String, default: 'info' },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  orderNumber: { type: String, default: '' },
  request: { type: mongoose.Schema.Types.ObjectId, ref: 'OrderChangeRequest', default: null },
  href: { type: String, default: '' },
  read: { type: Boolean, default: false }
}, { timestamps: true });

const orderChangeRequestSchema = new mongoose.Schema({
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  orderNumber: { type: String, default: '' },
  action: { type: String, enum: ['edit', 'delete'], required: true },
  payload: { type: Object, default: {} },
  summary: { type: String, default: '' },
  orderSnapshot: { type: Object, default: {} },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requestedByName: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending', index: true },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedByName: { type: String, default: '' },
  decidedAt: { type: Date, default: null }
}, { timestamps: true });

const counterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 }
});

const syncClockSchema = new mongoose.Schema({
  resource: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
  at: { type: Date, default: Date.now }
});

const idempotencySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  key: { type: String, required: true },
  status: { type: Number, default: 0 },
  body: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now }
});
idempotencySchema.index({ user: 1, key: 1 }, { unique: true });
idempotencySchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  companyName: { type: String, default: 'FBMS' },
  legalName: { type: String, default: 'Full Business Management System' },
  address: { type: String, default: '' },
  city: { type: String, default: 'Casablanca' },
  country: { type: String, default: 'Maroc' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  ice: { type: String, default: '' },
  currency: { type: String, default: 'MAD' },
  lowStockThreshold: { type: Number, default: 5, min: 0 }
}, { timestamps: true });

function watchSync(schema, resources) {
  const bump = () => {
    const { touchSync } = require('../services/sync');
    touchSync(resources);
  };
  schema.post('save', bump);
  schema.post('insertMany', bump);
  schema.post('findOneAndUpdate', bump);
  schema.post('findOneAndDelete', bump);
  schema.post('updateOne', bump);
  schema.post('deleteOne', { document: true, query: false }, bump);
  schema.post('deleteOne', { document: false, query: true }, bump);
}

orderSchema.set('optimisticConcurrency', true);
productSchema.set('optimisticConcurrency', true);
taskSchema.set('optimisticConcurrency', true);
userSchema.set('optimisticConcurrency', true);

watchSync(userSchema, 'users');
watchSync(productSchema, 'products');
watchSync(categorySchema, 'products');
watchSync(orderSchema, ['orders', 'finances']);
watchSync(taskSchema, 'tasks');
watchSync(citySchema, 'cities');
watchSync(shippingCompanySchema, 'cities');
watchSync(campaignSchema, 'campaigns');
watchSync(transactionSchema, 'finances');
watchSync(settingsSchema, 'settings');

module.exports = {
  User: mongoose.model('User', userSchema),
  Session: mongoose.model('Session', sessionSchema),
  PasswordReset: mongoose.model('PasswordReset', passwordResetSchema),
  Category: mongoose.model('Category', categorySchema),
  Product: mongoose.model('Product', productSchema),
  City: mongoose.model('City', citySchema),
  ShippingCompany: mongoose.model('ShippingCompany', shippingCompanySchema),
  Order: mongoose.model('Order', orderSchema),
  Campaign: mongoose.model('AdvertisingCampaign', campaignSchema),
  Transaction: mongoose.model('FinancialTransaction', transactionSchema),
  DocumentRecord: mongoose.model('Document', documentSchema),
  ActivityLog: mongoose.model('ActivityLog', activitySchema),
  Counter: mongoose.model('Counter', counterSchema),
  Settings: mongoose.model('Settings', settingsSchema),
  Task: mongoose.model('Task', taskSchema),
  QrScan: mongoose.model('QrScan', qrScanSchema),
  DeliveryConfirmation: mongoose.model('DeliveryConfirmation', deliveryConfirmationSchema),
  Ticket: mongoose.model('Ticket', ticketSchema),
  Notification: mongoose.model('Notification', notificationSchema),
  OrderChangeRequest: mongoose.model('OrderChangeRequest', orderChangeRequestSchema),
  SyncClock: mongoose.model('SyncClock', syncClockSchema),
  Idempotency: mongoose.model('Idempotency', idempotencySchema)
};
