const express = require('express');
const { z } = require('zod');
const { City, ShippingCompany } = require('../models');
const { protect, requirePermission, requireAny, cityPageDenied } = require('../middleware/auth');
const { wrap } = require('../utils/helpers');

const router = express.Router();
router.use(protect);

function denyClosedCityPage(req, res, next) {
  if (cityPageDenied(req.user)) return res.status(403).json({ message: 'Permission insuffisante' });
  next();
}

router.get('/cities', requireAny([['settings', 'view'], ['orders', 'view'], ['orders', 'create'], ['delivery', 'view']]), wrap(async (req, res) => {
  const filter = {};
  if (req.query.active === 'true') filter.active = true;
  if (req.query.search) filter.name = new RegExp(req.query.search, 'i');
  const items = await City.find(filter).sort({ name: 1 });
  res.json({ items });
}));

router.post('/cities', denyClosedCityPage, requirePermission('settings', 'edit'), wrap(async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    shippingPrice: z.coerce.number().min(0),
    zone: z.string().optional(),
    notes: z.string().optional(),
    active: z.boolean().optional()
  }).parse(req.body);
  const item = await City.create(body);
  res.status(201).json({ item });
}));

router.put('/cities/:id', denyClosedCityPage, requirePermission('settings', 'edit'), wrap(async (req, res) => {
  const body = z.object({
    name: z.string().min(2).optional(),
    shippingPrice: z.coerce.number().min(0).optional(),
    zone: z.string().optional(),
    notes: z.string().optional(),
    active: z.boolean().optional()
  }).parse(req.body);
  const item = await City.findByIdAndUpdate(req.params.id, body, { new: true });
  if (!item) return res.status(404).json({ message: 'Ville introuvable' });
  res.json({ item });
}));

router.delete('/cities/:id', denyClosedCityPage, requirePermission('settings', 'edit'), wrap(async (req, res) => {
  const { Order } = require('../models');
  const used = await Order.countDocuments({ city: req.params.id });
  if (used) return res.status(400).json({ message: 'Cette ville est utilisée par des commandes. Désactivez-la.' });
  await City.findByIdAndDelete(req.params.id);
  res.json({ message: 'Ville supprimée' });
}));

router.get('/shipping-companies', requireAny([['settings', 'view'], ['orders', 'view'], ['delivery', 'view']]), wrap(async (req, res) => {
  const items = await ShippingCompany.find().sort({ name: 1 });
  res.json({ items });
}));

router.post('/shipping-companies', denyClosedCityPage, requirePermission('settings', 'edit'), wrap(async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    phone: z.string().optional(),
    notes: z.string().optional(),
    active: z.boolean().optional()
  }).parse(req.body);
  const item = await ShippingCompany.create(body);
  res.status(201).json({ item });
}));

router.put('/shipping-companies/:id', denyClosedCityPage, requirePermission('settings', 'edit'), wrap(async (req, res) => {
  const body = z.object({
    name: z.string().min(2).optional(),
    phone: z.string().optional(),
    notes: z.string().optional(),
    active: z.boolean().optional()
  }).parse(req.body);
  const item = await ShippingCompany.findByIdAndUpdate(req.params.id, body, { new: true });
  if (!item) return res.status(404).json({ message: 'Société introuvable' });
  res.json({ item });
}));

router.delete('/shipping-companies/:id', denyClosedCityPage, requirePermission('settings', 'edit'), wrap(async (req, res) => {
  const item = await ShippingCompany.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!item) return res.status(404).json({ message: 'Société introuvable' });
  res.json({ message: 'Société désactivée', item });
}));

module.exports = router;
