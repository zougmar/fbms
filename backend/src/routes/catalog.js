const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { z } = require('zod');
const { Product, Category } = require('../models');
const { protect, requirePermission, requireAny, can } = require('../middleware/auth');
const { wrap, pageParams, escapeRegex } = require('../utils/helpers');
const { effectiveSellingPrice } = require('../utils/finance');
const { getSettings } = require('../services/analytics');
const { logActivity } = require('../services/orderService');
const { idempotency } = require('../middleware/idempotency');

const router = express.Router();
const uploadDir = path.join(__dirname, '../../uploads/products');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.\-]+/g, '_')}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Fichier image requis'));
    cb(null, true);
  }
});

function presentProduct(product, user) {
  const obj = product.toObject ? product.toObject() : { ...product };
  obj.effectivePrice = effectiveSellingPrice(obj);
  if (!can(user, 'finances', 'view') && !can(user, 'products', 'edit')) delete obj.purchasePrice;
  return obj;
}

router.use(protect);

router.get('/categories', requireAny([['products', 'view'], ['orders', 'view']]), wrap(async (req, res) => {
  const items = await Category.find().sort({ name: 1 });
  res.json({ items });
}));

router.post('/categories', requirePermission('products', 'create'), wrap(async (req, res) => {
  const body = z.object({ name: z.string().min(2), description: z.string().optional() }).parse(req.body);
  const item = await Category.create(body);
  res.status(201).json({ item });
}));

router.put('/categories/:id', requirePermission('products', 'edit'), wrap(async (req, res) => {
  const body = z.object({ name: z.string().min(2).optional(), description: z.string().optional() }).parse(req.body);
  const item = await Category.findByIdAndUpdate(req.params.id, body, { new: true });
  if (!item) return res.status(404).json({ message: 'Catégorie introuvable' });
  if (body.name) await Product.updateMany({ category: item._id }, { categoryName: item.name });
  res.json({ item });
}));

router.delete('/categories/:id', requirePermission('products', 'delete'), wrap(async (req, res) => {
  const used = await Product.countDocuments({ category: req.params.id });
  if (used) return res.status(400).json({ message: 'Cette catégorie est utilisée par des produits' });
  await Category.findByIdAndDelete(req.params.id);
  res.json({ message: 'Catégorie supprimée' });
}));

router.get('/low-stock', requirePermission('products', 'view'), wrap(async (req, res) => {
  const settings = await getSettings();
  const items = await Product.find({ status: 'active', stock: { $lte: settings.lowStockThreshold } }).sort({ stock: 1 });
  res.json({ threshold: settings.lowStockThreshold, items: items.map((item) => presentProduct(item, req.user)) });
}));

router.get('/performance', requirePermission('products', 'view'), wrap(async (req, res) => {
  const { productPerformance } = require('../services/analytics');
  const items = await productPerformance(req.query);
  res.json({ items });
}));

router.get('/', requireAny([['products', 'view'], ['orders', 'create'], ['orders', 'edit']]), wrap(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 50);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  else if (req.query.excludeArchived === '1') filter.status = { $ne: 'archived' };
  if (req.query.category) filter.category = req.query.category;
  if (req.query.search) {
    const rx = new RegExp(escapeRegex(req.query.search), 'i');
    filter.$or = [{ name: rx }, { code: rx }, { categoryName: rx }];
  }
  const [items, total] = await Promise.all([
    Product.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
    Product.countDocuments(filter)
  ]);
  res.json({ items: items.map((item) => presentProduct(item, req.user)), total, page, pages: Math.ceil(total / limit) || 1 });
}));

router.post('/', requirePermission('products', 'create'), idempotency, upload.array('images', 6), wrap(async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    code: z.string().min(1),
    description: z.string().optional(),
    category: z.string().optional(),
    purchasePrice: z.coerce.number().min(0),
    sellingPrice: z.coerce.number().min(0),
    discount: z.coerce.number().min(0).max(100).optional(),
    stock: z.coerce.number().int().min(0),
    initialStock: z.coerce.number().int().min(0).optional(),
    status: z.enum(['active', 'inactive', 'archived']).optional()
  }).parse(req.body);
  let categoryName = '';
  if (body.category) {
    const category = await Category.findById(body.category);
    if (!category) return res.status(400).json({ message: 'Catégorie introuvable' });
    categoryName = category.name;
  }
  const images = (req.files || []).map((file) => `/uploads/products/${file.filename}`);
  const product = await Product.create({
    ...body,
    category: body.category || null,
    categoryName,
    discount: body.discount || 0,
    initialStock: body.initialStock ?? body.stock,
    images
  });
  await logActivity(null, { user: req.user._id, userName: req.user.name, action: 'product.create', entity: 'Product', entityId: String(product._id), details: { code: product.code } });
  res.status(201).json({ item: presentProduct(product, req.user) });
}));

router.put('/:id', requirePermission('products', 'edit'), upload.array('images', 6), wrap(async (req, res) => {
  const body = z.object({
    name: z.string().min(2).optional(),
    code: z.string().min(1).optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    purchasePrice: z.coerce.number().min(0).optional(),
    sellingPrice: z.coerce.number().min(0).optional(),
    discount: z.coerce.number().min(0).max(100).optional(),
    stock: z.coerce.number().int().min(0).optional(),
    initialStock: z.coerce.number().int().min(0).optional(),
    status: z.enum(['active', 'inactive', 'archived']).optional(),
    keepImages: z.string().optional(),
    expectedVersion: z.coerce.number().int().nonnegative().optional()
  }).parse(req.body);
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).json({ message: 'Produit introuvable' });
  if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== Number(product.__v)) {
    return res.status(409).json({
      message: 'Ce produit a été modifié par un autre utilisateur. Les données ont été actualisées.',
      code: 'stale'
    });
  }
  if (body.category) {
    const category = await Category.findById(body.category);
    if (!category) return res.status(400).json({ message: 'Catégorie introuvable' });
    product.category = category._id;
    product.categoryName = category.name;
  }
  const fields = ['name', 'code', 'description', 'purchasePrice', 'sellingPrice', 'discount', 'stock', 'initialStock', 'status'];
  fields.forEach((field) => {
    if (body[field] !== undefined) product[field] = body[field];
  });
  let images = product.images;
  if (body.keepImages !== undefined) {
    try { images = JSON.parse(body.keepImages); } catch { images = []; }
  }
  images = images.concat((req.files || []).map((file) => `/uploads/products/${file.filename}`));
  product.images = images;
  await product.save();
  await logActivity(null, { user: req.user._id, userName: req.user.name, action: 'product.update', entity: 'Product', entityId: String(product._id) });
  res.json({ item: presentProduct(product, req.user) });
}));

router.delete('/:id', requirePermission('products', 'delete'), wrap(async (req, res) => {
  const { Order } = require('../models');
  const used = await Order.countDocuments({ product: req.params.id });
  if (used) {
    const product = await Product.findByIdAndUpdate(req.params.id, { status: 'archived' }, { new: true });
    return res.json({ message: 'Produit archivé car il est lié à des commandes', item: presentProduct(product, req.user) });
  }
  await Product.findByIdAndDelete(req.params.id);
  res.json({ message: 'Produit supprimé' });
}));

module.exports = router;
