const crypto = require('crypto');
const QRCode = require('qrcode');
const { Order, Product, QrScan, DeliveryConfirmation, Ticket, Settings } = require('../models');
const { can } = require('../middleware/auth');
const { economics } = require('../utils/finance');
const { updateOrder, nextNumber } = require('./orderService');

function canDeliver(user) {
  if (!user || user.active === false) return false;
  if (user.role === 'super_admin' || user.role === 'admin' || user.role === 'livreur') return true;
  return can(user, 'delivery', 'edit') || can(user, 'orders', 'edit');
}

function canIssueTicket(user) {
  if (!user || user.active === false) return false;
  if (user.role === 'super_admin' || user.role === 'admin' || user.role === 'livreur') return true;
  return can(user, 'orders', 'view') || can(user, 'delivery', 'view');
}

function scanUrl(token) {
  const origin = (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
  return `${origin}/scan/${token}`;
}

async function ensureQr(order) {
  if (order.qrToken) return order.qrToken;
  order.qrToken = crypto.randomBytes(24).toString('hex');
  await order.save();
  return order.qrToken;
}

async function qrImage(token) {
  return QRCode.toDataURL(scanUrl(token), { width: 320, margin: 1 });
}

async function presentDeskOrder(order, user) {
  const product = await Product.findById(order.product).select('images').lean();
  const image = [...(product?.images || [])].reverse().find(Boolean) || '';
  const money = economics(order.toObject ? order.toObject() : order);
  const item = {
    _id: order._id,
    orderNumber: order.orderNumber,
    orderDate: order.orderDate,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    cityName: order.cityName,
    address: order.address,
    productName: order.productName,
    productCode: order.productCode,
    quantity: order.quantity,
    sellingPrice: order.sellingPrice,
    totalAmount: order.totalAmount,
    shippingCost: order.shippingCost,
    amountCollected: order.amountCollected,
    status: order.status,
    trackingNumber: order.trackingNumber,
    shippingCompanyName: order.shippingCompanyName,
    comments: order.comments,
    productImage: image,
    qrToken: order.qrToken
  };
  if (can(user, 'finances', 'view')) item.netProfit = money.netProfit;
  return item;
}

async function recordScan(order, user, userAgent) {
  await ensureQr(order);
  const scan = await QrScan.create({
    order: order._id,
    orderNumber: order.orderNumber,
    token: order.qrToken,
    user: user._id,
    userName: user.name,
    userAgent: String(userAgent || '').slice(0, 300)
  });
  return scan;
}

function assertAssigned(order, user) {
  if (!user || user.role !== 'livreur') return;
  if (String(order.assignedTo || '') !== String(user._id)) {
    const error = new Error('Cette commande ne vous est pas assignée');
    error.status = 403;
    throw error;
  }
}

async function confirmDelivery(order, user, note) {
  assertAssigned(order, user);
  const previousStatus = order.status;
  if (previousStatus === 'Livrée') {
    const error = new Error('Cette commande est déjà livrée');
    error.status = 409;
    throw error;
  }
  const updated = await updateOrder(order._id, { status: 'Livrée', expectedVersion: order.__v, claimDelivery: true }, user);
  if (user.role === 'livreur') {
    const { notifyDeliveryStatus } = require('./notifications');
    await notifyDeliveryStatus({ order: updated, fromStatus: previousStatus, toStatus: updated.status, livreur: user });
  }
  const confirmation = await DeliveryConfirmation.create({
    order: updated._id,
    orderNumber: updated.orderNumber,
    user: user._id,
    userName: user.name,
    previousStatus,
    note: String(note || '').slice(0, 500)
  });
  return { order: updated, confirmation };
}

function ticketSnapshot(order) {
  return {
    orderNumber: order.orderNumber,
    orderDate: order.orderDate,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    cityName: order.cityName,
    address: order.address,
    productName: order.productName,
    quantity: order.quantity,
    totalAmount: order.totalAmount,
    shippingCost: order.shippingCost,
    amountCollected: order.amountCollected,
    status: order.status,
    trackingNumber: order.trackingNumber || ''
  };
}

function money(value) {
  return `${Number(value || 0).toFixed(2)} MAD`;
}

function ticketHtml({ company, ticket, qr }) {
  const snap = ticket.snapshot || {};
  const when = new Date(ticket.createdAt || Date.now()).toLocaleString('fr-MA');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Reçu ${ticket.reference}</title>
<style>
  body { font-family: Segoe UI, Tahoma, sans-serif; color: #14212b; margin: 0; padding: 24px; }
  .sheet { max-width: 720px; margin: 0 auto; border: 1px solid #d5dee4; border-radius: 16px; padding: 24px; }
  h1 { margin: 0; font-size: 22px; }
  .muted { color: #5d6d7a; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  td { padding: 8px 0; border-bottom: 1px solid #e6edf1; vertical-align: top; }
  td:first-child { width: 38%; color: #5d6d7a; }
  .total { font-size: 20px; font-weight: 800; }
  .qr { margin-top: 18px; text-align: center; }
  @media print { body { padding: 0; } .sheet { border: 0; } }
</style></head><body><article class="sheet">
  <h1>${company.companyName || 'FBMS'}</h1>
  <div class="muted">${company.legalName || ''} · ${company.city || ''} ${company.country || ''}</div>
  <div class="muted">${company.phone || ''} ${company.email || ''}</div>
  <h2>Reçu de livraison ${ticket.reference}</h2>
  <div class="muted">Émis le ${when} · ${ticket.createdByName || ''}</div>
  <table>
    <tr><td>Commande</td><td>${snap.orderNumber || ''}</td></tr>
    <tr><td>Client</td><td>${snap.customerName || ''}<br>${snap.customerPhone || ''}</td></tr>
    <tr><td>Adresse</td><td>${snap.address || ''}<br>${snap.cityName || ''}</td></tr>
    <tr><td>Produit</td><td>${snap.productName || ''} × ${snap.quantity || 0}</td></tr>
    <tr><td>Livraison</td><td>${money(snap.shippingCost)}</td></tr>
    <tr><td>Encaissé</td><td>${money(snap.amountCollected)}</td></tr>
    <tr><td>Total</td><td class="total">${money(snap.totalAmount)}</td></tr>
    <tr><td>Statut</td><td>${snap.status || ''}</td></tr>
    <tr><td>Suivi</td><td>${snap.trackingNumber || '—'}</td></tr>
  </table>
  <div class="qr"><img alt="QR" src="${qr}" width="160" height="160"><div class="muted">${snap.orderNumber || ''}</div></div>
</article></body></html>`;
}

async function issueTicket(order, user) {
  await ensureQr(order);
  const reference = await nextNumber('ticket', 'REC', new Date());
  const ticket = await Ticket.create({
    reference,
    order: order._id,
    orderNumber: order.orderNumber,
    createdBy: user._id,
    createdByName: user.name,
    snapshot: ticketSnapshot(order)
  });
  const company = await Settings.findOne({ key: 'company' }).lean() || {};
  const qr = await qrImage(order.qrToken);
  return { ticket, html: ticketHtml({ company, ticket, qr }) };
}

async function findByToken(token) {
  const order = await Order.findOne({ qrToken: token });
  if (!order) {
    const error = new Error('QR code inconnu');
    error.status = 404;
    throw error;
  }
  return order;
}

module.exports = {
  canDeliver,
  canIssueTicket,
  assertAssigned,
  scanUrl,
  ensureQr,
  qrImage,
  presentDeskOrder,
  recordScan,
  confirmDelivery,
  issueTicket,
  findByToken
};
