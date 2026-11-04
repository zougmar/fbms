const express = require('express');
const { z } = require('zod');
const { Campaign, Order } = require('../models');
const { PLATFORMS } = require('../constants');
const { protect, requirePermission } = require('../middleware/auth');
const { wrap, pageParams, dateRange, round2 } = require('../utils/helpers');
const { campaignStats } = require('../services/analytics');
const { logActivity } = require('../services/orderService');

const router = express.Router();
router.use(protect);

async function withStats(campaign) {
  const obj = campaign.toObject ? campaign.toObject() : campaign;
  const [linked] = await Order.aggregate([
    { $match: { campaign: obj._id, status: { $ne: 'Annulée' } } },
    { $group: {
      _id: '$campaign',
      orders: { $sum: 1 },
      delivered: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, 1, 0] } },
      revenue: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, '$totalAmount', 0] } }
    } }
  ]);
  const stats = campaignStats(obj, linked);
  return { ...obj, stats, roi: stats.roi, cpa: stats.cpa, deliveredCpa: stats.deliveredCpa, ordersCount: stats.orders, deliveredOrders: stats.delivered, revenue: stats.revenue };
}

router.get('/', requirePermission('advertising', 'view'), wrap(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = {};
  const range = dateRange(req.query);
  if (range) filter.date = range;
  if (req.query.platform) filter.platform = req.query.platform;
  const [items, total] = await Promise.all([
    Campaign.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
    Campaign.countDocuments(filter)
  ]);
  const decorated = [];
  for (const item of items) decorated.push(await withStats(item));
  const spend = round2(decorated.reduce((sum, item) => sum + item.actualSpending, 0));
  const revenue = round2(decorated.reduce((sum, item) => sum + (item.revenue || 0), 0));
  res.json({ items: decorated, total, page, pages: Math.ceil(total / limit) || 1, spend, revenue });
}));

router.post('/', requirePermission('advertising', 'create'), wrap(async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    platform: z.enum(PLATFORMS),
    platformName: z.string().optional(),
    product: z.string().nullable().optional(),
    date: z.string(),
    budget: z.coerce.number().min(0).optional(),
    actualSpending: z.coerce.number().min(0).optional(),
    manualOrders: z.coerce.number().int().min(0).nullable().optional(),
    manualDelivered: z.coerce.number().int().min(0).nullable().optional(),
    notes: z.string().optional()
  }).parse(req.body);
  let productName = '';
  if (body.product) {
    const { Product } = require('../models');
    const product = await Product.findById(body.product);
    if (!product) return res.status(400).json({ message: 'Produit introuvable' });
    productName = product.name;
  }
  const item = await Campaign.create({ ...body, product: body.product || null, productName, date: new Date(body.date) });
  await logActivity(null, { user: req.user._id, userName: req.user.name, action: 'campaign.create', entity: 'Campaign', entityId: String(item._id) });
  res.status(201).json({ item: await withStats(item) });
}));

router.put('/:id', requirePermission('advertising', 'edit'), wrap(async (req, res) => {
  const item = await Campaign.findById(req.params.id);
  if (!item) return res.status(404).json({ message: 'Campagne introuvable' });
  const body = z.object({
    name: z.string().min(2).optional(),
    platform: z.enum(PLATFORMS).optional(),
    platformName: z.string().optional(),
    product: z.string().nullable().optional(),
    date: z.string().optional(),
    budget: z.coerce.number().min(0).optional(),
    actualSpending: z.coerce.number().min(0).optional(),
    manualOrders: z.coerce.number().int().min(0).nullable().optional(),
    manualDelivered: z.coerce.number().int().min(0).nullable().optional(),
    notes: z.string().optional()
  }).parse(req.body);
  if (body.product) {
    const { Product } = require('../models');
    const product = await Product.findById(body.product);
    if (!product) return res.status(400).json({ message: 'Produit introuvable' });
    item.product = product._id;
    item.productName = product.name;
  } else if (body.product === null) {
    item.product = null;
    item.productName = '';
  }
  ['name', 'platform', 'platformName', 'budget', 'actualSpending', 'manualOrders', 'manualDelivered', 'notes'].forEach((key) => {
    if (body[key] !== undefined) item[key] = body[key];
  });
  if (body.date) item.date = new Date(body.date);
  await item.save();
  res.json({ item: await withStats(item) });
}));

router.delete('/:id', requirePermission('advertising', 'delete'), wrap(async (req, res) => {
  await Campaign.findByIdAndDelete(req.params.id);
  res.json({ message: 'Campagne supprimée' });
}));

module.exports = router;
