const express = require('express');
const { City, Product, ShippingCompany, DocumentRecord } = require('../models');
const { DOCUMENT_TYPES } = require('../constants');
const { protect, requirePermission, can } = require('../middleware/auth');
const { wrap, pageParams } = require('../utils/helpers');
const { buildDataset, renderHtml, htmlToPdf } = require('../services/documents');
const { nextNumber } = require('../services/orderService');
const { workbookBuffer, csvBuffer } = require('../services/excel');

const router = express.Router();
router.use(protect);

function assertAccess(user, category) {
  if (user?.role === 'livreur' && (category === 'orders' || category === 'delivery')) {
    const error = new Error('Export non autorisé');
    error.status = 403;
    throw error;
  }
  if (!can(user, 'documents', 'view') && !can(user, 'documents', 'generate')) {
    const error = new Error('Permission insuffisante');
    error.status = 403;
    throw error;
  }
  if ((category === 'finance' || category === 'dashboard') && !can(user, 'documents', 'financial') && !can(user, 'finances', 'view')) {
    const error = new Error('Les documents financiers sont restreints');
    error.status = 403;
    throw error;
  }
}

router.get('/catalog', requirePermission('documents', 'view'), (req, res) => {
  res.json({ types: DOCUMENT_TYPES });
});

router.get('/', requirePermission('documents', 'view'), wrap(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = {};
  if (req.query.category) filter.category = req.query.category;
  if (req.query.search) filter.title = new RegExp(req.query.search, 'i');
  if (!can(req.user, 'finances', 'view') && !can(req.user, 'documents', 'financial')) {
    filter.category = filter.category && filter.category !== 'finance' && filter.category !== 'dashboard'
      ? filter.category
      : { $nin: ['finance', 'dashboard'] };
  }
  const [items, total] = await Promise.all([
    DocumentRecord.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('createdBy', 'name'),
    DocumentRecord.countDocuments(filter)
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
}));

async function compose(req) {
  const category = req.query.category;
  const type = req.query.type;
  assertAccess(req.user, category);
  const lang = req.query.lang === 'ar' ? 'ar' : (req.lang || 'fr');
  const dataset = await buildDataset(category, type, req.query, lang);
  dataset.sensitive = category === 'finance' || category === 'dashboard';
  const [city, product, carrier] = await Promise.all([
    req.query.city ? City.findById(req.query.city).select('name') : null,
    req.query.product ? Product.findById(req.query.product).select('name') : null,
    req.query.shippingCompany ? ShippingCompany.findById(req.query.shippingCompany).select('name') : null
  ]);
  const reference = await nextNumber('document', 'DOC', new Date());
  await DocumentRecord.create({
    reference,
    category,
    type,
    title: dataset.title,
    filters: req.query,
    lang,
    createdBy: req.user._id
  });
  const { getSettings } = require('../services/analytics');
  const company = await getSettings();
  const html = renderHtml(dataset, company.toObject(), lang, reference, {
    city: city?.name,
    product: product?.name,
    carrier: carrier?.name,
    status: req.query.status,
    customer: req.query.customer
  });
  return { html, reference, dataset };
}

router.get('/preview', requirePermission('documents', 'generate'), wrap(async (req, res) => {
  const { html } = await compose(req);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}));

router.get('/pdf', requirePermission('documents', 'generate'), wrap(async (req, res) => {
  const { html, reference } = await compose(req);
  const pdf = await htmlToPdf(html);
  const file = Buffer.from(pdf);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${reference}.pdf"`);
  res.setHeader('Content-Length', file.length);
  res.send(file);
}));

router.get('/export', requirePermission('documents', 'generate'), wrap(async (req, res) => {
  const { dataset, reference } = await compose(req);
  const columns = dataset.columns || [];
  const rows = dataset.rows || dataset.labels || dataset.notes || [];
  if (!columns.length) return res.status(400).json({ message: 'Cet aperçu se télécharge en PDF' });
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${reference}.csv"`);
    return res.send(csvBuffer(columns, rows));
  }
  const buffer = await workbookBuffer(dataset.title || 'FBMS', columns, rows);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${reference}.xlsx"`);
  res.send(Buffer.from(buffer));
}));

module.exports = router;
