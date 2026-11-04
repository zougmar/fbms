const express = require('express');
const { z } = require('zod');
const { Transaction } = require('../models');
const { protect, requirePermission } = require('../middleware/auth');
const { wrap, pageParams, dateRange } = require('../utils/helpers');
const { financeSummary, cashflow } = require('../services/analytics');
const { workbookBuffer, csvBuffer } = require('../services/excel');

const router = express.Router();
router.use(protect, requirePermission('finances', 'view'));

router.get('/summary', wrap(async (req, res) => {
  res.json(await financeSummary(req.query));
}));

router.get('/cashflow', wrap(async (req, res) => {
  res.json({ items: await cashflow(req.query) });
}));

router.get('/transactions', wrap(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = {};
  const range = dateRange(req.query);
  if (range) filter.date = range;
  if (req.query.type) filter.type = req.query.type;
  if (req.query.category) filter.category = req.query.category;
  const [items, total] = await Promise.all([
    Transaction.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
    Transaction.countDocuments(filter)
  ]);
  res.json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
}));

router.post('/transactions', requirePermission('finances', 'create'), wrap(async (req, res) => {
  const body = z.object({
    type: z.enum(['income', 'expense']),
    category: z.string().min(2),
    amount: z.coerce.number().positive(),
    date: z.string(),
    description: z.string().optional()
  }).parse(req.body);
  const item = await Transaction.create({ ...body, date: new Date(body.date), source: 'manual', createdBy: req.user._id });
  res.status(201).json({ item });
}));

router.delete('/transactions/:id', requirePermission('finances', 'delete'), wrap(async (req, res) => {
  const item = await Transaction.findById(req.params.id);
  if (!item) return res.status(404).json({ message: 'Transaction introuvable' });
  if (item.source !== 'manual') return res.status(400).json({ message: 'Seules les transactions manuelles peuvent être supprimées' });
  await item.deleteOne();
  res.json({ message: 'Transaction supprimée' });
}));

router.get('/export', requirePermission('finances', 'export'), wrap(async (req, res) => {
  const filter = {};
  const range = dateRange(req.query);
  if (range) filter.date = range;
  const items = await Transaction.find(filter).sort({ date: 1 }).lean();
  const columns = [
    { key: 'date', label: 'Date', format: 'date' },
    { key: 'type', label: 'Type' },
    { key: 'category', label: 'Catégorie' },
    { key: 'description', label: 'Description' },
    { key: 'amount', label: 'Montant', format: 'money' }
  ];
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="fbms-finances.csv"');
    return res.send(csvBuffer(columns, items));
  }
  const buffer = await workbookBuffer('Finances', columns, items);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="fbms-finances.xlsx"');
  res.send(Buffer.from(buffer));
}));

module.exports = router;
