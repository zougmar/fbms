const express = require('express');
const { Order } = require('../models');
const { protect, requirePermission, can } = require('../middleware/auth');
const { wrap } = require('../utils/helpers');
const { dashboard, grouped, periodBuckets, productPerformance, financeSummary, listOrders, presentRows } = require('../services/analytics');
const { economics } = require('../utils/finance');
const { workbookBuffer, csvBuffer } = require('../services/excel');

const router = express.Router();
router.use(protect);

router.get('/dashboard', requirePermission('dashboard', 'view'), wrap(async (req, res) => {
  res.json(await dashboard(req.query, req.user));
}));

router.get('/reports/:type', requirePermission('reports', 'view'), wrap(async (req, res) => {
  const { type } = req.params;
  const query = { ...req.query };
  let payload;
  if (type === 'daily' || type === 'weekly' || type === 'monthly') {
    const format = type === 'monthly' ? '%Y-%m' : '%Y-%m-%d';
    payload = { columns: periodColumns(), rows: await periodBuckets(query, format) };
  } else if (type === 'by-city') {
    payload = { columns: groupColumns('Ville'), rows: await grouped(query, 'cityName') };
  } else if (type === 'by-product' || type === 'revenue-product' || type === 'profit-product') {
    payload = { columns: productColumns(), rows: await productPerformance(query) };
  } else if (type === 'delivery') {
    payload = { columns: groupColumns('Statut'), rows: await grouped(query, 'status') };
  } else if (type === 'returns') {
    query.status = 'Retour';
    payload = { columns: orderColumns(), rows: presentRows(await listOrders(query)) };
  } else if (type === 'cancellations') {
    query.status = 'Annulée';
    payload = { columns: orderColumns(), rows: presentRows(await listOrders(query)) };
  } else if (type === 'advertising') {
    if (!can(req.user, 'advertising', 'view') && !can(req.user, 'finances', 'view')) {
      return res.status(403).json({ message: 'Permission insuffisante' });
    }
    const { advertisingSeries } = require('../services/analytics');
    payload = {
      columns: [
        { key: 'name', label: 'Campagne' },
        { key: 'platform', label: 'Plateforme' },
        { key: 'spend', label: 'Dépense', format: 'money' },
        { key: 'revenue', label: 'CA livré', format: 'money' },
        { key: 'roi', label: 'ROI %', format: 'number' }
      ],
      rows: await advertisingSeries(query)
    };
  } else if (type === 'financial') {
    if (!can(req.user, 'finances', 'view')) return res.status(403).json({ message: 'Permission insuffisante' });
    payload = { summary: await financeSummary(query), columns: [], rows: [] };
  } else {
    return res.status(404).json({ message: 'Rapport inconnu' });
  }
  if (!can(req.user, 'finances', 'view')) {
    payload.columns = (payload.columns || []).filter((column) => !['revenue', 'profit', 'cogs', 'spend'].includes(column.key));
  }
  res.json(payload);
}));

router.get('/reports/:type/export', requirePermission('reports', 'export'), wrap(async (req, res) => {
  const response = await fetchReport(req);
  const columns = response.columns?.length ? response.columns : [{ key: 'message', label: 'Info' }];
  const rows = response.rows?.length ? response.rows : [response.summary || { message: 'Résumé disponible dans l\'application' }];
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fbms-${req.params.type}.csv"`);
    return res.send(csvBuffer(columns, rows));
  }
  const buffer = await workbookBuffer('Rapport', columns, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="fbms-${req.params.type}.xlsx"`);
  res.send(Buffer.from(buffer));
}));

function periodColumns() {
  return [
    { key: 'period', label: 'Période' },
    { key: 'orders', label: 'Commandes', format: 'number' },
    { key: 'delivered', label: 'Livrées', format: 'number' },
    { key: 'revenue', label: 'CA livré', format: 'money' },
    { key: 'profit', label: 'Bénéfice', format: 'money' }
  ];
}
function groupColumns(label) {
  return [
    { key: 'name', label },
    { key: 'orders', label: 'Commandes', format: 'number' },
    { key: 'delivered', label: 'Livrées', format: 'number' },
    { key: 'returned', label: 'Retours', format: 'number' },
    { key: 'revenue', label: 'CA livré', format: 'money' }
  ];
}
function productColumns() {
  return [
    { key: 'product', label: 'Produit' },
    { key: 'orders', label: 'Commandes', format: 'number' },
    { key: 'deliveredQty', label: 'Qté livrée', format: 'number' },
    { key: 'revenue', label: 'CA livré', format: 'money' },
    { key: 'profit', label: 'Bénéfice', format: 'money' }
  ];
}
function orderColumns() {
  return [
    { key: 'orderNumber', label: 'N°' },
    { key: 'orderDate', label: 'Date', format: 'date' },
    { key: 'customerName', label: 'Client' },
    { key: 'cityName', label: 'Ville' },
    { key: 'status', label: 'Statut' },
    { key: 'totalAmount', label: 'Total', format: 'money' }
  ];
}

async function fetchReport(req) {
  const query = { ...req.query };
  const { type } = req.params;
  if (type === 'by-city') return { columns: groupColumns('Ville'), rows: await grouped(query, 'cityName') };
  if (type === 'by-product' || type === 'profit-product' || type === 'revenue-product') {
    return { columns: productColumns(), rows: await productPerformance(query) };
  }
  if (type === 'returns') {
    query.status = 'Retour';
    return { columns: orderColumns(), rows: (await listOrders(query)).map((order) => ({ ...order, ...economics(order) })) };
  }
  return { columns: periodColumns(), rows: await periodBuckets(query, type === 'monthly' ? '%Y-%m' : '%Y-%m-%d') };
}

router.get('/delivery/board', requirePermission('delivery', 'view'), wrap(async (req, res) => {
  const query = { ...req.query };
  if (!query.status) query.statuses = ['En préparation', 'Expédiée', 'Livrée', 'Retour'];
  const { page, limit, skip } = require('../utils/helpers').pageParams(req.query);
  const { buildOrderMatch } = require('../services/analytics');
  const match = buildOrderMatch(query);
  if (req.user.role === 'livreur') match.assignedTo = req.user._id;
  const [items, total] = await Promise.all([
    Order.find(match).sort({ orderDate: -1 }).skip(skip).limit(limit).select('-history'),
    Order.countDocuments(match)
  ]);
  const summary = await grouped(query, 'shippingCompanyName');
  res.json({
    items: items.map((order) => {
      const obj = order.toObject();
      if (!can(req.user, 'finances', 'view')) delete obj.purchasePrice;
      return obj;
    }),
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    byCarrier: summary
  });
}));

module.exports = router;
