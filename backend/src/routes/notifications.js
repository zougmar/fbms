const express = require('express');
const { Notification, OrderChangeRequest } = require('../models');
const { protect } = require('../middleware/auth');
const { wrap } = require('../utils/helpers');

const router = express.Router();
router.use(protect);

router.get('/', wrap(async (req, res) => {
  const items = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(30);
  const requestIds = items.map((item) => item.request).filter(Boolean);
  const requests = requestIds.length
    ? await OrderChangeRequest.find({ _id: { $in: requestIds } }).select('status')
    : [];
  const statuses = new Map(requests.map((request) => [String(request._id), request.status]));
  const unread = items.filter((item) => !item.read).length;
  res.set('Cache-Control', 'no-store');
  res.json({
    items: items.map((item) => ({
      ...item.toObject(),
      requestStatus: item.request ? statuses.get(String(item.request)) || '' : ''
    })),
    unread
  });
}));

router.post('/read', wrap(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
  res.json({ ok: true });
}));

module.exports = router;
