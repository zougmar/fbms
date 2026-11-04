const express = require('express');
const { z } = require('zod');
const { ActivityLog } = require('../models');
const { protect, requirePermission, requireAny } = require('../middleware/auth');
const { wrap, pageParams } = require('../utils/helpers');
const { getSettings } = require('../services/analytics');

const router = express.Router();
router.use(protect);

router.get('/settings', requireAny([['settings', 'view'], ['documents', 'generate']]), wrap(async (req, res) => {
  res.json({ item: await getSettings() });
}));

router.put('/settings', requirePermission('settings', 'edit'), wrap(async (req, res) => {
  const body = z.object({
    companyName: z.string().min(2).optional(),
    legalName: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    ice: z.string().optional(),
    lowStockThreshold: z.coerce.number().int().min(0).optional()
  }).parse(req.body);
  const settings = await getSettings();
  Object.assign(settings, body);
  settings.currency = 'MAD';
  await settings.save();
  res.json({ item: settings });
}));

router.get('/activity', requireAny([['settings', 'view'], ['users', 'view']]), wrap(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const [items, total] = await Promise.all([
    ActivityLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
    ActivityLog.countDocuments()
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
}));

module.exports = router;
