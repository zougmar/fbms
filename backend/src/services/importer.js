const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { Product, City, ShippingCompany, Order } = require('../models');
const { ORDER_STATUSES, PAYMENT_STATUSES } = require('../constants');
const { stripAccents, normalizePhone, parseDateOnly, dayKey } = require('../utils/helpers');
const { findDuplicates, createOrder } = require('./orderService');

const ORDER_HEADERS = {
  'order id': 'orderNumber',
  id: 'orderNumber',
  date: 'orderDate',
  'date commande': 'orderDate',
  client: 'customerName',
  nom: 'customerName',
  'nom client': 'customerName',
  customer: 'customerName',
  'customer name': 'customerName',
  telephone: 'customerPhone',
  tel: 'customerPhone',
  phone: 'customerPhone',
  'customer phone': 'customerPhone',
  ville: 'city',
  city: 'city',
  adresse: 'address',
  address: 'address',
  produit: 'product',
  product: 'product',
  'code produit': 'product',
  quantite: 'quantity',
  qte: 'quantity',
  qty: 'quantity',
  quantity: 'quantity',
  'prix achat': 'purchasePrice',
  'purchase price': 'purchasePrice',
  'prix vente': 'sellingPrice',
  'selling price': 'sellingPrice',
  statut: 'status',
  status: 'status',
  societe: 'shippingCompany',
  'societe de livraison': 'shippingCompany',
  'shipping company': 'shippingCompany',
  transporteur: 'shippingCompany',
  tracking: 'trackingNumber',
  suivi: 'trackingNumber',
  'numero de suivi': 'trackingNumber',
  'frais de livraison': 'shippingCost',
  'shipping cost': 'shippingCost',
  livraison: 'shippingCost',
  publicite: 'advertisingCost',
  advertising: 'advertisingCost',
  'frais pub': 'advertisingCost',
  'frais supplementaires': 'additionalExpenses',
  'additional expenses': 'additionalExpenses',
  encaisse: 'amountCollected',
  'amount collected': 'amountCollected',
  paiement: 'paymentStatus',
  'payment status': 'paymentStatus',
  commentaires: 'comments',
  comments: 'comments'
};

const STATUS_MAP = {
  'a confirmer': 'À confirmer',
  confirmee: 'Confirmée',
  confirme: 'Confirmée',
  'en preparation': 'En préparation',
  expediee: 'Expédiée',
  expedie: 'Expédiée',
  livree: 'Livrée',
  livre: 'Livrée',
  retour: 'Retour',
  annulee: 'Annulée',
  annule: 'Annulée'
};

const PAYMENT_MAP = {
  'non paye': 'unpaid',
  impaye: 'unpaid',
  unpaid: 'unpaid',
  partiel: 'partial',
  partial: 'partial',
  paye: 'paid',
  paid: 'paid',
  rembourse: 'refunded',
  refunded: 'refunded'
};

const { uploadDir } = require('../uploads');

function importDir() {
  return uploadDir('imports');
}

async function readRows(filePath) {
  const workbook = new ExcelJS.Workbook();
  if (filePath.endsWith('.csv')) {
    await workbook.csv.readFile(filePath, { map: (value) => value });
  } else {
    await workbook.xlsx.readFile(filePath);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const headerRow = sheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, index) => {
    headers[index] = ORDER_HEADERS[stripAccents(cell.text || cell.value)] || null;
  });
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const data = {};
    let hasValue = false;
    headers.forEach((key, index) => {
      if (!key) return;
      const cell = row.getCell(index);
      let value = cell.value;
      if (value && typeof value === 'object' && value.text) value = value.text;
      if (value && typeof value === 'object' && value.result !== undefined) value = value.result;
      if (value instanceof Date) value = value.toISOString().slice(0, 10);
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        data[key] = typeof value === 'string' ? value.trim() : value;
        hasValue = true;
      }
    });
    if (hasValue) rows.push({ rowNumber, data });
  });
  return rows;
}

async function resolveOrderRow(entry, seen) {
  const data = { ...entry.data };
  const errors = [];
  const warnings = [];
  if (!data.customerName) errors.push('Nom client manquant');
  if (!data.customerPhone || normalizePhone(data.customerPhone).length < 6) errors.push('Téléphone invalide');
  if (!data.address) errors.push('Adresse manquante');
  if (!data.product) errors.push('Produit manquant');
  if (!data.city) errors.push('Ville manquante');
  const quantity = Number(data.quantity || 1);
  if (!Number.isInteger(quantity) || quantity < 1) errors.push('Quantité invalide');
  let product = null;
  if (data.product) {
    const text = String(data.product).trim();
    product = await Product.findOne({
      $or: [{ code: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, { name: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }],
      status: { $ne: 'archived' }
    });
    if (!product) errors.push(`Produit introuvable: ${text}`);
  }
  let city = null;
  if (data.city) {
    city = await City.findOne({ name: new RegExp(`^${String(data.city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim()}$`, 'i'), active: true });
    if (!city) errors.push(`Ville introuvable: ${data.city}`);
  }
  let carrier = null;
  if (data.shippingCompany) {
    carrier = await ShippingCompany.findOne({ name: new RegExp(`^${String(data.shippingCompany).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim()}$`, 'i') });
    if (!carrier) warnings.push(`Société inconnue, ignorée: ${data.shippingCompany}`);
  }
  let status = 'À confirmer';
  if (data.status) {
    status = STATUS_MAP[stripAccents(data.status)] || (ORDER_STATUSES.includes(data.status) ? data.status : null);
    if (!status) errors.push(`Statut inconnu: ${data.status}`);
  }
  let paymentStatus;
  if (data.paymentStatus) {
    paymentStatus = PAYMENT_MAP[stripAccents(data.paymentStatus)] || (PAYMENT_STATUSES.includes(data.paymentStatus) ? data.paymentStatus : null);
    if (!paymentStatus) errors.push(`Paiement inconnu: ${data.paymentStatus}`);
  }
  const orderDate = data.orderDate ? parseDateOnly(data.orderDate) : new Date();
  const phone = normalizePhone(data.customerPhone || '');
  const fingerprint = `${phone}|${product ? String(product._id) : data.product}|${dayKey(orderDate)}`;
  let duplicate = false;
  if (seen.has(fingerprint)) {
    duplicate = true;
    warnings.push('Doublon dans le fichier');
  }
  seen.add(fingerprint);
  if (product && phone && !errors.length) {
    const existing = await findDuplicates({ phone, product: product._id, orderDate });
    if (existing.length) {
      duplicate = true;
      warnings.push(`Doublon existant ${existing[0].orderNumber}`);
    }
  }
  if (data.purchasePrice === undefined && product) warnings.push('Prix d\'achat repris du produit');
  if (data.shippingCost === undefined && city) warnings.push(`Livraison reprise de la ville (${city.shippingPrice} MAD)`);
  return {
    rowNumber: entry.rowNumber,
    errors,
    warnings,
    duplicate,
    payload: errors.length ? null : {
      orderDate,
      customerName: data.customerName,
      customerPhone: phone,
      city: city?._id,
      address: data.address,
      product: product?._id,
      quantity,
      purchasePrice: data.purchasePrice,
      sellingPrice: data.sellingPrice,
      status,
      shippingCompany: carrier?._id,
      trackingNumber: data.trackingNumber || '',
      shippingCost: data.shippingCost,
      advertisingCost: data.advertisingCost || 0,
      additionalExpenses: data.additionalExpenses || 0,
      amountCollected: data.amountCollected || 0,
      paymentStatus,
      comments: data.comments || '',
      allowDuplicate: false
    },
    preview: {
      customerName: data.customerName || '',
      customerPhone: phone,
      city: city?.name || data.city || '',
      product: product?.name || data.product || '',
      quantity,
      status: status || data.status || ''
    }
  };
}

async function previewOrderImport(filePath, userId) {
  const parsed = await readRows(filePath);
  if (!parsed.length) {
    const error = new Error('Le fichier ne contient aucune ligne');
    error.status = 400;
    throw error;
  }
  if (parsed.length > 2000) {
    const error = new Error('2000 lignes maximum par import');
    error.status = 400;
    throw error;
  }
  const seen = new Set();
  const rows = [];
  for (const entry of parsed) rows.push(await resolveOrderRow(entry, seen));
  const id = `${Date.now()}-${userId}`;
  const stored = { id, userId: String(userId), createdAt: new Date().toISOString(), rows };
  fs.writeFileSync(path.join(importDir(), `${id}.json`), JSON.stringify(stored));
  return {
    id,
    total: rows.length,
    valid: rows.filter((row) => row.payload && !row.duplicate).length,
    duplicates: rows.filter((row) => row.duplicate).length,
    invalid: rows.filter((row) => row.errors.length).length,
    rows: rows.map(({ rowNumber, errors, warnings, duplicate, preview }) => ({ rowNumber, errors, warnings, duplicate, preview }))
  };
}

async function commitOrderImport(id, user, allowDuplicates) {
  const file = path.join(importDir(), `${id}.json`);
  if (!fs.existsSync(file)) {
    const error = new Error('Aperçu d\'import expiré ou introuvable');
    error.status = 404;
    throw error;
  }
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (String(stored.userId) !== String(user._id)) {
    const error = new Error('Import non autorisé');
    error.status = 403;
    throw error;
  }
  const created = [];
  const skipped = [];
  for (const row of stored.rows) {
    if (!row.payload || row.errors?.length) {
      skipped.push({ rowNumber: row.rowNumber, reason: (row.errors || []).join(', ') || 'invalide' });
      continue;
    }
    if (row.duplicate && !allowDuplicates) {
      skipped.push({ rowNumber: row.rowNumber, reason: 'doublon' });
      continue;
    }
    try {
      const order = await createOrder({ ...row.payload, allowDuplicate: Boolean(allowDuplicates && row.duplicate) }, user);
      created.push({ rowNumber: row.rowNumber, orderNumber: order.orderNumber });
    } catch (error) {
      skipped.push({ rowNumber: row.rowNumber, reason: error.message });
    }
  }
  fs.unlinkSync(file);
  return { created: created.length, skipped, orders: created };
}

module.exports = { previewOrderImport, commitOrderImport };
