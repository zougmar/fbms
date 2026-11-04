const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const { Order, Product, User } = require('../models');
const { ORDER_STATUSES, PAYMENT_STATUSES, DELIVERY_STATUSES } = require('../constants');
const { protect, requirePermission, can } = require('../middleware/auth');
const { wrap, pageParams } = require('../utils/helpers');
const { economics } = require('../utils/finance');
const { buildOrderMatch } = require('../services/analytics');
const { createOrder, updateOrder, deleteOrder, findDuplicates } = require('../services/orderService');
const { idempotency } = require('../middleware/idempotency');
const { htmlToPdf } = require('../services/documents');
const { ensureQr, qrImage, scanUrl, issueTicket, canIssueTicket } = require('../services/deliveryDesk');
const { workbookBuffer, csvBuffer } = require('../services/excel');
const { previewOrderImport, commitOrderImport } = require('../services/importer');
const { notifyDeliveryStatus, notifyAssignment } = require('../services/notifications');

const router = express.Router();
const uploadDir = path.join(__dirname, '../../uploads/imports');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 8 * 1024 * 1024 } });

function presentOrder(order, user) {
  const obj = order.toObject ? order.toObject() : { ...order };
  const money = economics(obj);
  const base = {
    ...obj,
    grossMargin: money.grossMargin,
    netProfit: money.netProfit,
    recognizedRevenue: money.revenue
  };
  if (!can(user, 'finances', 'view')) {
    delete base.purchasePrice;
    delete base.grossMargin;
    delete base.netProfit;
    delete base.advertisingCost;
  }
  return base;
}

async function withProductImages(orders, user) {
  const list = Array.isArray(orders) ? orders : [orders];
  const ids = [...new Set(list.map((order) => String(order.product || '')).filter(Boolean))];
  const products = ids.length ? await Product.find({ _id: { $in: ids } }).select('images').lean() : [];
  const images = new Map(products.map((product) => {
    const src = [...(product.images || [])].reverse().find(Boolean) || '';
    return [String(product._id), src];
  }));
  const presented = list.map((order) => {
    const item = presentOrder(order, user);
    item.productImage = images.get(String(item.product)) || '';
    return item;
  });
  return Array.isArray(orders) ? presented : presented[0];
}

const orderBody = z.object({
  orderDate: z.string().optional(),
  customerName: z.string().min(2),
  customerPhone: z.string().min(6),
  city: z.string().min(1),
  address: z.string().min(3),
  product: z.string().min(1),
  quantity: z.coerce.number().int().positive(),
  purchasePrice: z.coerce.number().min(0).optional(),
  sellingPrice: z.coerce.number().min(0).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  shippingCompany: z.string().nullable().optional(),
  trackingNumber: z.string().optional(),
  shippingCost: z.coerce.number().min(0).optional(),
  advertisingCost: z.coerce.number().min(0).optional(),
  additionalExpenses: z.coerce.number().min(0).optional(),
  amountCollected: z.coerce.number().min(0).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  comments: z.string().max(2000).optional(),
  campaign: z.string().nullable().optional(),
  allowDuplicate: z.coerce.boolean().optional(),
  expectedVersion: z.coerce.number().int().nonnegative().optional(),
  assignedTo: z.string().nullable().optional()
});

function blockLivreur(req, res, next) {
  if (req.user.role === 'livreur') return res.status(403).json({ message: 'Action non autorisée pour le livreur' });
  return next();
}

function assignedToLivreur(order, user) {
  return String(order.assignedTo || '') === String(user._id);
}

async function resolveAssignee(id) {
  if (!id) return { assignedTo: null, assignedToName: '' };
  const courier = await User.findOne({ _id: id, role: 'livreur', active: { $ne: false } }).select('name');
  if (!courier) {
    const error = new Error('Livreur introuvable');
    error.status = 400;
    throw error;
  }
  return { assignedTo: courier._id, assignedToName: courier.name };
}

router.use(protect);

router.get('/duplicates', blockLivreur, requirePermission('orders', 'view'), wrap(async (req, res) => {
  const items = await findDuplicates({
    phone: req.query.phone,
    product: req.query.product,
    orderDate: req.query.date || new Date(),
    excludeId: req.query.excludeId
  });
  res.json({ items });
}));

router.get('/export', blockLivreur, requirePermission('orders', 'export'), wrap(async (req, res) => {
  const orders = await Order.find(buildOrderMatch(req.query)).sort({ orderDate: -1 }).limit(5000).lean();
  const rows = orders.map((order) => ({ ...order, ...economics(order) }));
  const columns = [
    { key: 'orderNumber', label: 'N° commande' },
    { key: 'orderDate', label: 'Date', format: 'date' },
    { key: 'customerName', label: 'Client' },
    { key: 'customerPhone', label: 'Téléphone' },
    { key: 'cityName', label: 'Ville' },
    { key: 'address', label: 'Adresse' },
    { key: 'productName', label: 'Produit' },
    { key: 'quantity', label: 'Quantité', format: 'number' },
    { key: 'sellingPrice', label: 'Prix de vente', format: 'money' },
    { key: 'totalAmount', label: 'Total', format: 'money' },
    { key: 'status', label: 'Statut' },
    { key: 'shippingCompanyName', label: 'Société' },
    { key: 'trackingNumber', label: 'Suivi' },
    { key: 'shippingCost', label: 'Livraison', format: 'money' },
    { key: 'amountCollected', label: 'Encaissé', format: 'money' },
    { key: 'paymentStatus', label: 'Paiement' },
    { key: 'comments', label: 'Commentaires' }
  ];
  if (can(req.user, 'finances', 'view')) {
    columns.splice(8, 0, { key: 'purchasePrice', label: 'Prix d\'achat', format: 'money' });
    columns.push(
      { key: 'advertisingCost', label: 'Publicité', format: 'money' },
      { key: 'additionalExpenses', label: 'Frais supplémentaires', format: 'money' },
      { key: 'netProfit', label: 'Bénéfice', format: 'money' }
    );
  }
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="fbms-commandes.csv"');
    return res.send(csvBuffer(columns, rows));
  }
  const buffer = await workbookBuffer('Commandes', columns, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="fbms-commandes.xlsx"');
  res.send(Buffer.from(buffer));
}));

router.post('/import', blockLivreur, requirePermission('orders', 'create'), upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Fichier requis' });
  const preview = await previewOrderImport(req.file.path, req.user._id);
  fs.unlink(req.file.path, () => {});
  res.json(preview);
}));

router.post('/import/:id/commit', blockLivreur, requirePermission('orders', 'create'), wrap(async (req, res) => {
  const result = await commitOrderImport(req.params.id, req.user, Boolean(req.body.allowDuplicates));
  res.json(result);
}));

router.post('/bulk', blockLivreur, requirePermission('orders', 'edit'), wrap(async (req, res) => {
  if (req.user.role === 'confirmation_agent') return res.status(403).json({ message: 'Action non autorisée' });
  const body = z.object({
    ids: z.array(z.string()).min(1),
    action: z.enum(['status', 'delete']),
    status: z.enum(ORDER_STATUSES).optional()
  }).parse(req.body);
  if (body.action === 'delete' && !can(req.user, 'orders', 'delete')) {
    return res.status(403).json({ message: 'Suppression non autorisée' });
  }
  const results = [];
  for (const id of body.ids) {
    try {
      if (body.action === 'delete') {
        await deleteOrder(id, req.user);
        results.push({ id, ok: true });
      } else {
        const order = await updateOrder(id, { status: body.status }, req.user);
        results.push({ id, ok: true, orderNumber: order.orderNumber });
      }
    } catch (error) {
      results.push({ id, ok: false, message: error.message });
    }
  }
  res.json({ results });
}));

router.get('/couriers', requirePermission('orders', 'view'), wrap(async (req, res) => {
  if (req.user.role === 'livreur') return res.status(403).json({ message: 'Action non autorisée pour le livreur' });
  if (req.user.role !== 'confirmation_agent' && !can(req.user, 'orders', 'edit')) {
    return res.status(403).json({ message: 'Permission insuffisante' });
  }
  const items = await User.find({ role: 'livreur', active: { $ne: false } }).select('name').sort({ name: 1 });
  res.json({ items });
}));

router.get('/', requirePermission('orders', 'view'), wrap(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const match = buildOrderMatch(req.query);
  if (req.user.role === 'livreur') match.assignedTo = req.user._id;
  const [items, total] = await Promise.all([
    Order.find(match).sort({ orderDate: -1, createdAt: -1 }).skip(skip).limit(limit).select('-history'),
    Order.countDocuments(match)
  ]);
  res.json({
    items: await withProductImages(items, req.user),
    total,
    page,
    pages: Math.ceil(total / limit) || 1
  });
}));

router.post('/', blockLivreur, requirePermission('orders', 'create'), idempotency, wrap(async (req, res) => {
  const body = orderBody.parse(req.body);
  if (body.assignedTo !== undefined) Object.assign(body, await resolveAssignee(body.assignedTo));
  const order = await createOrder(body, req.user);
  res.status(201).json({ item: presentOrder(order, req.user) });
}));

router.get('/:id/qr', blockLivreur, requirePermission('orders', 'view'), wrap(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Commande introuvable' });
  const token = await ensureQr(order);
  const dataUrl = await qrImage(token);
  if (req.query.download === '1') {
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${order.orderNumber}-qr.png"`);
    return res.send(buffer);
  }
  res.json({ token, scanUrl: scanUrl(token), dataUrl });
}));

router.post('/:id/ticket', blockLivreur, requirePermission('orders', 'view'), wrap(async (req, res) => {
  if (!canIssueTicket(req.user)) return res.status(403).json({ message: 'Permission insuffisante' });
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Commande introuvable' });
  const { ticket, html } = await issueTicket(order, req.user);
  if (req.query.format === 'pdf') {
    const file = Buffer.from(await htmlToPdf(html));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${ticket.reference}.pdf"`);
    return res.send(file);
  }
  res.status(201).json({ ticket, html });
}));

router.get('/:id', requirePermission('orders', 'view'), wrap(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: 'Commande introuvable' });
  if (req.user.role === 'livreur' && !assignedToLivreur(order, req.user)) {
    return res.status(403).json({ message: 'Cette commande ne vous est pas assignée' });
  }
  res.json({ item: await withProductImages(order, req.user) });
}));

router.put('/:id', requirePermission('orders', 'view'), wrap(async (req, res) => {
  if (req.user.role === 'livreur') {
    const keys = Object.keys(req.body || {});
    if (keys.some((key) => key !== 'status' && key !== 'expectedVersion')) {
      return res.status(403).json({ message: 'Action non autorisée pour le livreur' });
    }
    const body = z.object({
      status: z.enum(DELIVERY_STATUSES),
      expectedVersion: z.coerce.number().int().nonnegative().optional()
    }).parse(req.body);
    const existing = await Order.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Commande introuvable' });
    if (!assignedToLivreur(existing, req.user)) return res.status(403).json({ message: 'Cette commande ne vous est pas assignée' });
    const previous = existing.status;
    const order = await updateOrder(req.params.id, { status: body.status, expectedVersion: body.expectedVersion }, req.user);
    if (previous !== order.status) {
      await notifyDeliveryStatus({ order, fromStatus: previous, toStatus: order.status, livreur: req.user });
    }
    return res.json({ item: presentOrder(order, req.user) });
  }
  const existing = await Order.findById(req.params.id);
  if (!existing) return res.status(404).json({ message: 'Commande introuvable' });
  if (req.user.role === 'confirmation_agent') {
    const keys = Object.keys(req.body || {}).filter((key) => key !== 'expectedVersion' && key !== 'allowDuplicate');
    const onlyStatus = keys.length === 1 && keys[0] === 'status';
    const onlyAssign = keys.length === 1 && keys[0] === 'assignedTo';
    if (onlyAssign) {
      const body = z.object({
        assignedTo: z.string().nullable().optional(),
        expectedVersion: z.coerce.number().int().nonnegative().optional()
      }).parse(req.body);
      const assignee = await resolveAssignee(body.assignedTo);
      const order = await updateOrder(req.params.id, { ...assignee, expectedVersion: body.expectedVersion }, req.user);
      await notifyAssignment(existing, order, req.user);
      return res.json({ item: presentOrder(order, req.user) });
    }
    if (onlyStatus && can(req.user, 'orders', 'edit')) {
      const body = orderBody.partial().parse(req.body);
      const order = await updateOrder(req.params.id, { status: body.status, expectedVersion: body.expectedVersion }, req.user);
      return res.json({ item: presentOrder(order, req.user) });
    }
    return res.status(403).json({ message: 'Cette modification doit être approuvée par le super administrateur' });
  }
  if (!can(req.user, 'orders', 'edit')) return res.status(403).json({ message: 'Permission insuffisante' });
  const body = orderBody.partial().parse(req.body);
  if (body.assignedTo !== undefined) Object.assign(body, await resolveAssignee(body.assignedTo));
  const order = await updateOrder(req.params.id, body, req.user);
  await notifyAssignment(existing, order, req.user);
  res.json({ item: presentOrder(order, req.user) });
}));

router.delete('/:id', blockLivreur, requirePermission('orders', 'delete'), wrap(async (req, res) => {
  if (req.user.role === 'confirmation_agent') {
    return res.status(403).json({ message: 'La suppression doit être approuvée par le super administrateur' });
  }
  const result = await deleteOrder(req.params.id, req.user);
  res.json({ message: 'Commande supprimée', ...result });
}));

module.exports = router;
