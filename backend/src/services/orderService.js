const crypto = require('crypto');
const mongoose = require('mongoose');
const {
  Order, Product, City, ShippingCompany, Campaign, Counter, ActivityLog
} = require('../models');
const { ORDER_STATUSES } = require('../constants');
const { orderAmounts, shouldDeductStock, suggestPaymentStatus } = require('../utils/finance');
const { parseDateOnly, dayKey, normalizePhone, toObjectId, round2 } = require('../utils/helpers');

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

function transactionsUnsupported(error) {
  const message = String(error?.message || '');
  return error?.code === 20 || /Transaction numbers are only allowed|replica set/i.test(message);
}

async function withTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (error) {
    if (transactionsUnsupported(error)) return work(null);
    throw error;
  } finally {
    await session.endSession();
  }
}

function queryOptions(session) {
  return session ? { session } : {};
}

async function nextNumber(key, prefix, date) {
  const year = new Date(date).getUTCFullYear();
  const counter = await Counter.findOneAndUpdate(
    { key: `${key}-${year}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `${prefix}-${year}-${String(counter.seq).padStart(5, '0')}`;
}

async function logActivity(session, entry) {
  await ActivityLog.create([{
    userName: entry.userName || '',
    ...entry
  }], queryOptions(session));
}

async function findDuplicates({ phone, product, orderDate, excludeId }) {
  const day = dayKey(orderDate);
  const query = {
    customerPhone: normalizePhone(phone),
    product: toObjectId(product),
    orderDate: { $gte: new Date(`${day}T00:00:00.000Z`), $lte: new Date(`${day}T23:59:59.999Z`) },
    status: { $ne: 'Annulée' }
  };
  if (excludeId) query._id = { $ne: excludeId };
  return Order.find(query).select('orderNumber customerName orderDate status totalAmount').limit(5).lean();
}

async function applyStock({ productId, delta, session }) {
  if (!delta) return;
  if (delta > 0) {
    const updated = await Product.findOneAndUpdate(
      { _id: productId, stock: { $gte: delta } },
      { $inc: { stock: -delta } },
      { new: true, ...queryOptions(session) }
    );
    if (!updated) throw new HttpError(400, 'Stock insuffisant pour ce produit');
    return;
  }
  await Product.findByIdAndUpdate(productId, { $inc: { stock: Math.abs(delta) } }, queryOptions(session));
}

async function hydrateRefs(data, previousProductId) {
  const product = await Product.findById(data.product);
  if (!product) throw new HttpError(400, 'Produit introuvable');
  if (product.status === 'archived' && String(product._id) !== String(previousProductId || '')) {
    throw new HttpError(400, 'Ce produit est archivé');
  }
  const city = await City.findById(data.city);
  if (!city || city.active === false) throw new HttpError(400, 'Ville introuvable');
  let carrier = null;
  if (data.shippingCompany) {
    carrier = await ShippingCompany.findById(data.shippingCompany);
    if (!carrier) throw new HttpError(400, 'Société de livraison introuvable');
  }
  let campaign = null;
  if (data.campaign) {
    campaign = await Campaign.findById(data.campaign);
    if (!campaign) throw new HttpError(400, 'Campagne introuvable');
  }
  return { product, city, carrier, campaign };
}

function numberOr(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (Number.isNaN(number) || number < 0) throw new HttpError(400, 'Montant invalide');
  return round2(number);
}

function buildPayload(data, refs) {
  const sellingPrice = numberOr(data.sellingPrice, refs.product.sellingPrice);
  const purchasePrice = numberOr(data.purchasePrice, refs.product.purchasePrice);
  const quantity = Number(data.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) throw new HttpError(400, 'Quantité invalide');
  const amounts = orderAmounts({ quantity, sellingPrice, purchasePrice });
  const status = data.status || 'À confirmer';
  if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, 'Statut invalide');
  const payload = {
    orderDate: parseDateOnly(data.orderDate),
    customerName: String(data.customerName || '').trim(),
    customerPhone: normalizePhone(data.customerPhone),
    city: refs.city._id,
    cityName: refs.city.name,
    address: String(data.address || '').trim(),
    product: refs.product._id,
    productName: refs.product.name,
    productCode: refs.product.code,
    quantity: amounts.quantity,
    purchasePrice: amounts.purchasePrice,
    sellingPrice: amounts.sellingPrice,
    totalAmount: amounts.totalAmount,
    status,
    shippingCompany: refs.carrier ? refs.carrier._id : null,
    shippingCompanyName: refs.carrier ? refs.carrier.name : '',
    trackingNumber: String(data.trackingNumber || '').trim(),
    shippingCost: numberOr(data.shippingCost, refs.city.shippingPrice || 0),
    advertisingCost: numberOr(data.advertisingCost, 0),
    additionalExpenses: numberOr(data.additionalExpenses, 0),
    amountCollected: numberOr(data.amountCollected, 0),
    comments: String(data.comments || '').trim(),
    campaign: refs.campaign ? refs.campaign._id : null,
    campaignName: refs.campaign ? refs.campaign.name : ''
  };
  if (!payload.customerName || payload.customerPhone.length < 6 || payload.address.length < 3) {
    throw new HttpError(400, 'Client, téléphone et adresse sont requis');
  }
  if (data.paymentStatus) {
    payload.paymentStatus = data.paymentStatus;
    payload.paymentStatusManual = true;
  } else if (data.keepManualPayment && data.currentPaymentStatus) {
    payload.paymentStatus = data.currentPaymentStatus;
    payload.paymentStatusManual = true;
  } else {
    payload.paymentStatus = suggestPaymentStatus(payload);
    payload.paymentStatusManual = false;
  }
  return payload;
}

function historyEntry(user, action, changes, note = '') {
  return { at: new Date(), by: user._id, byName: user.name, action, changes, note };
}

function isStatusOnly(data) {
  const keys = Object.keys(data).filter((key) => data[key] !== undefined && key !== 'expectedVersion');
  return keys.length === 1 && keys[0] === 'status';
}

function staleUpdate() {
  throw new HttpError(409, 'Cette commande a été modifiée par un autre utilisateur. Les données affichées ont été actualisées.', { code: 'stale' });
}

function versionMismatch(current, data) {
  if (data.expectedVersion === undefined || data.expectedVersion === null || data.expectedVersion === '') return false;
  return Number(current.__v) !== Number(data.expectedVersion);
}

function dedupeValue(payload) {
  return `${payload.customerPhone}|${String(payload.product)}|${dayKey(payload.orderDate)}`;
}

function mergeOrder(data, current) {
  return {
    orderDate: data.orderDate || current.orderDate,
    customerName: data.customerName ?? current.customerName,
    customerPhone: data.customerPhone ?? current.customerPhone,
    city: data.city || current.city,
    address: data.address ?? current.address,
    product: data.product || current.product,
    quantity: data.quantity ?? current.quantity,
    purchasePrice: data.purchasePrice ?? current.purchasePrice,
    sellingPrice: data.sellingPrice ?? current.sellingPrice,
    status: data.status || current.status,
    shippingCompany: data.shippingCompany === '' ? null : (data.shippingCompany !== undefined ? data.shippingCompany : current.shippingCompany),
    trackingNumber: data.trackingNumber !== undefined ? data.trackingNumber : current.trackingNumber,
    shippingCost: data.shippingCost !== undefined ? data.shippingCost : current.shippingCost,
    advertisingCost: data.advertisingCost !== undefined ? data.advertisingCost : current.advertisingCost,
    additionalExpenses: data.additionalExpenses !== undefined ? data.additionalExpenses : current.additionalExpenses,
    amountCollected: data.amountCollected !== undefined ? data.amountCollected : current.amountCollected,
    comments: data.comments !== undefined ? data.comments : current.comments,
    campaign: data.campaign === '' ? null : (data.campaign !== undefined ? data.campaign : current.campaign),
    paymentStatus: data.paymentStatus,
    keepManualPayment: !data.paymentStatus && current.paymentStatusManual,
    currentPaymentStatus: current.paymentStatus
  };
}

async function guardDuplicateKey(error, payload) {
  if (error?.code !== 11000) throw error;
  if (error.keyPattern?.dedupeKey) {
    const duplicates = payload ? await findDuplicates({
      phone: payload.customerPhone,
      product: payload.product,
      orderDate: payload.orderDate
    }) : [];
    throw new HttpError(409, 'Une commande similaire existe déjà pour ce téléphone, ce produit et ce jour', { duplicates });
  }
  if (error.keyPattern?.orderNumber) throw new HttpError(409, 'Numéro de commande déjà utilisé');
  throw error;
}

async function createOrder(data, user) {
  const refs = await hydrateRefs(data);
  const payload = buildPayload(data, refs);
  const duplicates = await findDuplicates({
    phone: payload.customerPhone,
    product: payload.product,
    orderDate: payload.orderDate
  });
  if (duplicates.length && !data.allowDuplicate) {
    throw new HttpError(409, 'Une commande similaire existe déjà pour ce téléphone, ce produit et ce jour', { duplicates });
  }
  let orderNumber = String(data.orderNumber || '').trim();
  if (orderNumber) {
    if (!/^[\w-]{3,40}$/.test(orderNumber)) throw new HttpError(400, 'Numéro de commande invalide');
    const taken = await Order.exists({ orderNumber });
    if (taken) throw new HttpError(409, 'Numéro de commande déjà utilisé');
  } else {
    orderNumber = await nextNumber('order', 'FBMS', payload.orderDate);
  }
  try {
    return await withTransaction(async (session) => {
      const deduct = shouldDeductStock(payload.status) ? payload.quantity : 0;
      if (deduct) await applyStock({ productId: refs.product._id, delta: deduct, session });
      const [order] = await Order.create([{
        ...payload,
        orderNumber,
        dedupeKey: data.allowDuplicate ? undefined : dedupeValue(payload),
        stockDeducted: deduct > 0,
        stockQtyApplied: deduct,
      duplicateWarning: duplicates.length > 0,
      assignedTo: data.assignedTo || null,
      assignedToName: data.assignedTo ? String(data.assignedToName || '') : '',
      qrToken: crypto.randomBytes(24).toString('hex'),
        createdBy: user._id,
        history: [historyEntry(user, 'create', { status: payload.status })]
      }], queryOptions(session));
      await logActivity(session, {
        user: user._id,
        userName: user.name,
        action: 'order.create',
        entity: 'Order',
        entityId: String(order._id),
        details: { orderNumber }
      });
      return order;
    });
  } catch (error) {
    await guardDuplicateKey(error, payload);
  }
}

async function updateOrder(id, data, user) {
  const existing = await Order.findById(id);
  if (!existing) throw new HttpError(404, 'Commande introuvable');
  if (versionMismatch(existing, data) && !isStatusOnly(data)) staleUpdate();

  let savedPayload = null;
  try {
    return await withTransaction(async (session) => {
      const query = Order.findById(id);
      if (session) query.session(session);
      const current = await query;
      if (!current) throw new HttpError(404, 'Commande introuvable');
      if (data.claimDelivery && current.status === 'Livrée') {
        throw new HttpError(409, 'Cette commande est déjà livrée', { code: 'stale' });
      }
      if (versionMismatch(current, data) && !isStatusOnly(data)) staleUpdate();

      const merged = mergeOrder(data, current);
      const refs = await hydrateRefs(merged, current.product);
      const payload = buildPayload(merged, refs);
      savedPayload = payload;
      const identityChanged = ['customerPhone', 'product', 'orderDate'].some((key) => data[key] !== undefined)
        && (
          normalizePhone(data.customerPhone ?? current.customerPhone) !== current.customerPhone
          || String(data.product || current.product) !== String(current.product)
          || dayKey(data.orderDate || current.orderDate) !== dayKey(current.orderDate)
        );
      if (identityChanged && !data.allowDuplicate) {
        const duplicates = await findDuplicates({
          phone: payload.customerPhone,
          product: payload.product,
          orderDate: payload.orderDate,
          excludeId: current._id
        });
        if (duplicates.length) {
          throw new HttpError(409, 'Une commande similaire existe déjà pour ce téléphone, ce produit et ce jour', { duplicates });
        }
      }
      const oldProduct = String(current.product);
      const newProduct = String(refs.product._id);
      const oldQty = current.stockDeducted ? current.stockQtyApplied : 0;
      const newQty = shouldDeductStock(payload.status) ? payload.quantity : 0;
      if (oldProduct === newProduct) {
        await applyStock({ productId: current.product, delta: newQty - oldQty, session });
      } else {
        if (oldQty) await applyStock({ productId: current.product, delta: -oldQty, session });
        if (newQty) await applyStock({ productId: refs.product._id, delta: newQty, session });
      }
      const watched = ['status', 'quantity', 'totalAmount', 'customerName', 'cityName', 'trackingNumber', 'shippingCost', 'paymentStatus'];
      const changes = {};
      for (const key of watched) {
        if (String(current[key] ?? '') !== String(payload[key] ?? '')) {
          changes[key] = { from: current[key], to: payload[key] };
        }
      }
      const nextKey = payload.status === 'Annulée' || data.allowDuplicate
        ? undefined
        : (current.dedupeKey || identityChanged ? dedupeValue(payload) : undefined);
      current.set({
        ...payload,
        stockDeducted: newQty > 0,
        stockQtyApplied: newQty,
        updatedBy: user._id
      });
      if (Object.prototype.hasOwnProperty.call(data, 'assignedTo') && user.role !== 'livreur') {
        current.assignedTo = data.assignedTo || null;
        current.assignedToName = data.assignedTo ? String(data.assignedToName || '') : '';
      }
      if (nextKey) current.dedupeKey = nextKey;
      else if (payload.status === 'Annulée' || data.allowDuplicate) current.dedupeKey = undefined;
      if (Object.keys(changes).length) current.history.push(historyEntry(user, 'update', changes));
      await current.save(queryOptions(session));
      await logActivity(session, {
        user: user._id,
        userName: user.name,
        action: 'order.update',
        entity: 'Order',
        entityId: String(current._id),
        details: { orderNumber: current.orderNumber, changes }
      });
      return current;
    });
  } catch (error) {
    if (error?.name === 'VersionError') staleUpdate();
    await guardDuplicateKey(error, savedPayload);
  }
}

async function deleteOrder(id, user) {
  return withTransaction(async (session) => {
    const query = Order.findById(id);
    if (session) query.session(session);
    const order = await query;
    if (!order) throw new HttpError(404, 'Commande introuvable');
    if (order.stockDeducted && order.stockQtyApplied) {
      await applyStock({ productId: order.product, delta: -order.stockQtyApplied, session });
    }
    await Order.deleteOne({ _id: order._id }, queryOptions(session));
    await logActivity(session, {
      user: user._id,
      userName: user.name,
      action: 'order.delete',
      entity: 'Order',
      entityId: String(order._id),
      details: { orderNumber: order.orderNumber }
    });
    return { id: order._id, orderNumber: order.orderNumber };
  });
}

module.exports = {
  HttpError,
  withTransaction,
  nextNumber,
  logActivity,
  findDuplicates,
  createOrder,
  updateOrder,
  deleteOrder
};
