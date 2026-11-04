const { User, Notification } = require('../models');

async function notifyUsers(userIds, payload) {
  const ids = [...new Set((userIds || []).map((id) => String(id || '')).filter(Boolean))];
  if (!ids.length) return [];
  return Notification.insertMany(ids.map((id) => ({
    user: id,
    kind: payload.kind || 'info',
    title: payload.title,
    message: payload.message || '',
    order: payload.order || null,
    orderNumber: payload.orderNumber || '',
    request: payload.request || null,
    href: payload.href || ''
  })));
}

async function notifyDeliveryStatus({ order, fromStatus, toStatus, livreur }) {
  if (!order || fromStatus === toStatus) return [];
  const agents = await User.find({ role: 'confirmation_agent', active: { $ne: false } }).select('_id');
  return notifyUsers(agents.map((agent) => agent._id), {
    kind: 'delivery',
    title: 'Statut de livraison',
    message: `${livreur?.name || 'Un livreur'} a mis ${order.orderNumber} à « ${toStatus} » (auparavant « ${fromStatus} »).`,
    order: order._id,
    orderNumber: order.orderNumber,
    href: `/orders/${order._id}`
  });
}

async function notifyAssignment(previous, order, actor) {
  const next = String(order?.assignedTo || '');
  const prev = String(previous?.assignedTo || '');
  if (!next || next === prev || next === String(actor?._id || '')) return [];
  return notifyUsers([next], {
    kind: 'assignment',
    title: 'Commande assignée',
    message: `${actor?.name || 'Un agent'} vous a assigné ${order.orderNumber} · ${order.customerName || ''} · ${order.cityName || ''}.`,
    order: order._id,
    orderNumber: order.orderNumber,
    href: `/orders/${order._id}`
  });
}

module.exports = { notifyUsers, notifyDeliveryStatus, notifyAssignment };
