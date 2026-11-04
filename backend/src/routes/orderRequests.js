const express = require('express');
const { z } = require('zod');
const { Order, City, Product, OrderChangeRequest, User } = require('../models');
const { ORDER_STATUSES } = require('../constants');
const { protect, can } = require('../middleware/auth');
const { wrap } = require('../utils/helpers');
const { updateOrder, deleteOrder } = require('../services/orderService');
const { notifyUsers } = require('../services/notifications');

const router = express.Router();
router.use(protect);

const LABELS = {
  customerName: 'Nom',
  customerPhone: 'Téléphone',
  city: 'Ville',
  address: 'Adresse',
  product: 'Produit',
  quantity: 'Quantité',
  sellingPrice: 'Prix de vente',
  purchasePrice: 'Prix d’achat',
  status: 'Statut',
  shippingCost: 'Livraison',
  trackingNumber: 'Suivi',
  comments: 'Commentaires'
};

const editPayload = z.object({
  customerName: z.string().min(2).optional(),
  customerPhone: z.string().min(6).optional(),
  city: z.string().min(1).optional(),
  address: z.string().min(3).optional(),
  product: z.string().min(1).optional(),
  quantity: z.coerce.number().int().positive().optional(),
  sellingPrice: z.coerce.number().min(0).optional(),
  purchasePrice: z.coerce.number().min(0).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  shippingCost: z.coerce.number().min(0).optional(),
  trackingNumber: z.string().max(80).optional(),
  comments: z.string().max(2000).optional()
}).strict();

function snapshotOf(order) {
  return {
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    cityName: order.cityName,
    address: order.address,
    productName: order.productName,
    quantity: order.quantity,
    status: order.status,
    totalAmount: order.totalAmount,
    sellingPrice: order.sellingPrice,
    comments: order.comments || ''
  };
}

async function displayPayload(payload) {
  const shown = { ...payload };
  if (payload.city) {
    const city = await City.findById(payload.city).select('name');
    if (city) shown.city = city.name;
  }
  if (payload.product) {
    const product = await Product.findById(payload.product).select('name');
    if (product) shown.product = product.name;
  }
  return shown;
}

function summaryFor(order, action, shown) {
  const lines = [
    `Action : ${action === 'delete' ? 'Suppression' : 'Modification'}`,
    `Commande : ${order.orderNumber}`,
    `Client : ${order.customerName} · ${order.customerPhone}`,
    `Ville : ${order.cityName}`,
    `Adresse : ${order.address}`,
    `Produit : ${order.productName} × ${order.quantity}`,
    `Statut : ${order.status}`,
    `Total : ${order.totalAmount} MAD`
  ];
  if (action === 'edit') {
    lines.push('Modifications demandées :');
    Object.entries(shown).forEach(([key, value]) => {
      lines.push(`- ${LABELS[key] || key} : ${value}`);
    });
  }
  return lines.join('\n');
}

router.get('/', wrap(async (req, res) => {
  const filter = {};
  if (req.user.role === 'super_admin' || req.user.role === 'admin') {
    if (req.query.status) filter.status = req.query.status;
  } else if (req.user.role === 'confirmation_agent') {
    filter.requestedBy = req.user._id;
    if (req.query.status) filter.status = req.query.status;
  } else {
    return res.status(403).json({ message: 'Permission insuffisante' });
  }
  if (req.query.order) filter.order = req.query.order;
  const items = await OrderChangeRequest.find(filter).sort({ createdAt: -1 }).limit(100);
  res.set('Cache-Control', 'no-store');
  res.json({ items });
}));

router.post('/', wrap(async (req, res) => {
  if (req.user.role !== 'confirmation_agent') {
    return res.status(403).json({ message: 'Seul un agent de confirmation peut faire cette demande' });
  }
  const body = z.object({
    order: z.string().min(1),
    action: z.enum(['edit', 'delete']),
    payload: z.record(z.any()).optional()
  }).parse(req.body);
  if (body.action === 'edit' && !can(req.user, 'orders', 'edit')) {
    return res.status(403).json({ message: 'Permission de modification non accordée' });
  }
  const order = await Order.findById(body.order);
  if (!order) return res.status(404).json({ message: 'Commande introuvable' });
  const pending = await OrderChangeRequest.findOne({ order: order._id, status: 'pending' });
  if (pending) return res.status(409).json({ message: 'Une demande est déjà en attente pour cette commande' });
  let payload = {};
  if (body.action === 'edit') {
    payload = editPayload.parse(body.payload || {});
    if (!Object.keys(payload).length) return res.status(400).json({ message: 'Aucune modification à demander' });
  }
  const shown = await displayPayload(payload);
  const summary = summaryFor(order, body.action, shown);
  const request = await OrderChangeRequest.create({
    order: order._id,
    orderNumber: order.orderNumber,
    action: body.action,
    payload,
    summary,
    orderSnapshot: snapshotOf(order),
    requestedBy: req.user._id,
    requestedByName: req.user.name
  });
  const admins = await User.find({ role: { $in: ['super_admin', 'admin'] }, active: { $ne: false } }).select('_id');
  await notifyUsers(admins.map((admin) => admin._id), {
    kind: 'approval',
    title: body.action === 'delete' ? 'Demande de suppression' : 'Demande de modification',
    message: `${req.user.name} demande une ${body.action === 'delete' ? 'suppression' : 'modification'}.\n${summary}`,
    order: order._id,
    orderNumber: order.orderNumber,
    request: request._id,
    href: `/orders/${order._id}`
  });
  res.status(201).json({ item: request });
}));

router.post('/:id/decide', wrap(async (req, res) => {
  if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Seul un administrateur peut décider' });
  }
  const decision = z.object({ decision: z.enum(['accept', 'reject']) }).parse(req.body).decision;
  const request = await OrderChangeRequest.findById(req.params.id);
  if (!request) return res.status(404).json({ message: 'Demande introuvable' });
  if (request.status !== 'pending') return res.status(409).json({ message: 'Cette demande a déjà été traitée' });
  if (decision === 'accept') {
    if (request.action === 'delete') {
      await deleteOrder(request.order, req.user);
    } else {
      const order = await Order.findById(request.order);
      if (!order) return res.status(404).json({ message: 'Commande introuvable' });
      await updateOrder(order._id, { ...request.payload, expectedVersion: order.__v }, req.user);
    }
  }
  request.status = decision === 'accept' ? 'accepted' : 'rejected';
  request.decidedBy = req.user._id;
  request.decidedByName = req.user.name;
  request.decidedAt = new Date();
  await request.save();
  const accepted = decision === 'accept';
  await notifyUsers([request.requestedBy], {
    kind: 'info',
    title: accepted ? 'Demande acceptée' : 'Demande refusée',
    message: accepted
      ? `${req.user.name} a accepté votre demande sur ${request.orderNumber}.`
      : `${req.user.name} a refusé votre demande sur ${request.orderNumber}. La commande reste inchangée.`,
    order: request.order,
    orderNumber: request.orderNumber,
    request: request._id,
    href: `/orders/${request.order}`
  });
  res.json({ item: request });
}));

module.exports = router;
