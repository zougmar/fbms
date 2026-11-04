const express = require('express');
const { SyncClock } = require('../models');
const { protect } = require('../middleware/auth');
const { wrap } = require('../utils/helpers');

const RESOURCES = ['orders', 'products', 'tasks', 'users', 'cities', 'campaigns', 'finances', 'settings'];
const router = express.Router();

router.get('/', protect, wrap(async (req, res) => {
  const rows = await SyncClock.find({ resource: { $in: RESOURCES } }).select('resource seq').lean();
  const clocks = Object.fromEntries(RESOURCES.map((name) => [name, 0]));
  rows.forEach((row) => { clocks[row.resource] = row.seq || 0; });
  res.set('Cache-Control', 'no-store');
  res.json({ clocks });
}));

module.exports = router;
