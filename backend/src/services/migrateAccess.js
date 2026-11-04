const crypto = require('crypto');
const { User, Order } = require('../models');
const { roleDefaults } = require('../constants');

async function migrateAccess() {
  await User.updateMany({ role: 'employee' }, { $set: { role: 'livreur' } });
  const users = await User.find();
  for (const user of users) {
    const current = user.permissions && typeof user.permissions === 'object' ? { ...user.permissions } : {};
    const defaults = roleDefaults(user.role);
    let changed = false;
    if (!current.tasks) {
      user.permissions = { ...current, tasks: defaults.tasks };
      changed = true;
    }
    if (user.role === 'livreur') {
      user.permissions = { ...(user.permissions || current), orders: defaults.orders };
      changed = true;
    }
    if (!changed) continue;
    user.markModified('permissions');
    await user.save();
  }
  const missing = await Order.find({ $or: [{ qrToken: { $exists: false } }, { qrToken: null }, { qrToken: '' }] }).select('_id');
  for (const order of missing) {
    order.qrToken = crypto.randomBytes(24).toString('hex');
    await order.save();
  }
}

module.exports = { migrateAccess };
