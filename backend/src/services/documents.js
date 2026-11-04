const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { Order, Product, Transaction, Campaign } = require('../models');
const { DOCUMENT_TYPES } = require('../constants');
const { economics } = require('../utils/finance');
const { round2, dateRange, escapeRegex } = require('../utils/helpers');
const {
  listOrders, productPerformance, grouped, periodBuckets, financeSummary,
  dashboard, cashflow, getSettings, isoWeek, campaignStats
} = require('./analytics');

const LABELS = {
  fr: {
    generated: 'Généré le',
    reference: 'Référence',
    filters: 'Filtres sélectionnés',
    none: 'Aucun filtre',
    empty: 'Aucune donnée pour les filtres sélectionnés.',
    note: 'Document généré par FBMS à partir des enregistrements de la base.',
    confidential: 'Document financier confidentiel.',
    clientSign: 'Signature du client',
    agentSign: 'Signature du livreur',
    cod: 'Montant à encaisser',
    qty: 'Qté',
    product: 'Produit',
    city: 'Ville',
    phone: 'Téléphone',
    address: 'Adresse',
    customer: 'Client',
    date: 'Date',
    status: 'Statut',
    total: 'Total',
    collected: 'Encaissé',
    shipping: 'Livraison',
    carrier: 'Société',
    tracking: 'Suivi',
    orders: 'Commandes',
    revenue: 'Chiffre d\'affaires livré',
    profit: 'Bénéfice net',
    count: 'Nombre'
  },
  ar: {
    generated: 'تاريخ الإنشاء',
    reference: 'المرجع',
    filters: 'التصفيات المحددة',
    none: 'بدون تصفية',
    empty: 'لا توجد بيانات للتصفيات المحددة.',
    note: 'وثيقة أنشأها نظام FBMS من السجلات الفعلية في قاعدة البيانات.',
    confidential: 'وثيقة مالية سرية.',
    clientSign: 'توقيع الزبون',
    agentSign: 'توقيع الموزع',
    cod: 'المبلغ الواجب تحصيله',
    qty: 'الكمية',
    product: 'المنتج',
    city: 'المدينة',
    phone: 'الهاتف',
    address: 'العنوان',
    customer: 'الزبون',
    date: 'التاريخ',
    status: 'الحالة',
    total: 'المجموع',
    collected: 'المحصّل',
    shipping: 'التوصيل',
    carrier: 'شركة النقل',
    tracking: 'التتبع',
    orders: 'الطلبات',
    revenue: 'رقم معاملات الطلبات المسلّمة',
    profit: 'الربح الصافي',
    count: 'العدد'
  }
};

const TITLES = {
  fr: {
    'orders:individual': 'Fiche commande',
    'orders:all': 'Toutes les commandes',
    'orders:confirmed': 'Commandes confirmées',
    'orders:delivered': 'Commandes livrées',
    'orders:returned': 'Commandes retournées',
    'orders:cancelled': 'Commandes annulées',
    'orders:daily': 'Rapport quotidien des commandes',
    'orders:monthly': 'Rapport mensuel des commandes',
    'orders:by-city': 'Commandes par ville',
    'orders:by-product': 'Commandes par produit',
    'orders:by-range': 'Commandes par période',
    'delivery:bon': 'Bon de livraison',
    'delivery:manifest': 'Manifeste de livraison',
    'delivery:labels': 'Étiquettes d\'expédition',
    'delivery:report': 'Rapport de livraison',
    'delivery:returns': 'Colis retournés',
    'delivery:by-city': 'Livraisons par ville',
    'delivery:by-carrier': 'Rapport par société de livraison',
    'delivery:reconciliation': 'Rapprochement des encaissements',
    'finance:daily': 'Rapport financier quotidien',
    'finance:weekly': 'Rapport financier hebdomadaire',
    'finance:monthly': 'Rapport financier mensuel',
    'finance:revenue': 'Rapport du chiffre d\'affaires',
    'finance:expenses': 'Rapport des charges',
    'finance:pnl': 'Compte de résultat',
    'finance:cashflow': 'Flux de trésorerie',
    'finance:ads': 'Dépenses publicitaires',
    'finance:product-profit': 'Rentabilité par produit',
    'products:catalog': 'Catalogue produits',
    'products:pricelist': 'Liste des prix',
    'products:stock': 'Rapport de stock',
    'products:low-stock': 'Stock faible',
    'products:performance': 'Performance produits',
    'dashboard:summary': 'Rapport du tableau de bord'
  },
  ar: {
    'orders:individual': 'بطاقة الطلب',
    'orders:all': 'جميع الطلبات',
    'orders:confirmed': 'الطلبات المؤكدة',
    'orders:delivered': 'الطلبات المسلّمة',
    'orders:returned': 'الطلبات المرجعة',
    'orders:cancelled': 'الطلبات الملغاة',
    'orders:daily': 'تقرير الطلبات اليومي',
    'orders:monthly': 'تقرير الطلبات الشهري',
    'orders:by-city': 'الطلبات حسب المدينة',
    'orders:by-product': 'الطلبات حسب المنتج',
    'orders:by-range': 'الطلبات حسب الفترة',
    'delivery:bon': 'وصل التسليم',
    'delivery:manifest': 'كشف التسليم',
    'delivery:labels': 'ملصقات الشحن',
    'delivery:report': 'تقرير التوصيل',
    'delivery:returns': 'الطرود المرجعة',
    'delivery:by-city': 'التوصيل حسب المدينة',
    'delivery:by-carrier': 'تقرير شركات النقل',
    'delivery:reconciliation': 'مطابقة التحصيل',
    'finance:daily': 'التقرير المالي اليومي',
    'finance:weekly': 'التقرير المالي الأسبوعي',
    'finance:monthly': 'التقرير المالي الشهري',
    'finance:revenue': 'تقرير المداخيل',
    'finance:expenses': 'تقرير المصاريف',
    'finance:pnl': 'قائمة الأرباح والخسائر',
    'finance:cashflow': 'التدفق النقدي',
    'finance:ads': 'مصاريف الإعلان',
    'finance:product-profit': 'ربحية المنتجات',
    'products:catalog': 'كتالوج المنتجات',
    'products:pricelist': 'لائحة الأسعار',
    'products:stock': 'تقرير المخزون',
    'products:low-stock': 'مخزون منخفض',
    'products:performance': 'أداء المنتجات',
    'dashboard:summary': 'تقرير لوحة التحكم'
  }
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function money(value, lang) {
  const formatted = new Intl.NumberFormat(lang === 'ar' ? 'ar-MA' : 'fr-MA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
  return `${formatted} MAD`;
}

function formatDate(value, lang) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return esc(value);
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-MA' : 'fr-FR', { dateStyle: 'medium' }).format(date);
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function withDefaults(category, type, query) {
  const next = { ...query };
  const today = todayStamp();
  if (type === 'daily' && !next.from && !next.to) {
    next.from = today;
    next.to = today;
  }
  if (type === 'weekly' && !next.from && !next.to) {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 6);
    next.from = start.toISOString().slice(0, 10);
    next.to = today;
  }
  if ((type === 'monthly' || category === 'orders' && type === 'monthly') && !next.from && !next.to) {
    next.from = `${today.slice(0, 8)}01`;
    next.to = today;
  }
  const forced = {
    'orders:confirmed': 'Confirmée',
    'orders:delivered': 'Livrée',
    'orders:returned': 'Retour',
    'orders:cancelled': 'Annulée',
    'delivery:returns': 'Retour',
    'finance:revenue': 'Livrée'
  }[`${category}:${type}`];
  if (forced) next.status = forced;
  if (category === 'delivery' && ['bon', 'manifest', 'labels'].includes(type) && !next.status && !next.orderId) {
    next.statuses = ['En préparation', 'Expédiée', 'Livrée'];
  }
  return next;
}

function orderColumns(lang, mode) {
  const t = LABELS[lang];
  const base = [
    { key: 'orderNumber', label: 'N°' },
    { key: 'orderDate', label: t.date, format: 'date' },
    { key: 'customerName', label: t.customer },
    { key: 'customerPhone', label: t.phone },
    { key: 'cityName', label: t.city },
    { key: 'productName', label: t.product },
    { key: 'quantity', label: t.qty, format: 'number' },
    { key: 'totalAmount', label: t.total, format: 'money' },
    { key: 'status', label: t.status },
    { key: 'shippingCompanyName', label: t.carrier },
    { key: 'trackingNumber', label: t.tracking }
  ];
  if (mode === 'delivery') {
    base.push(
      { key: 'shippingCost', label: t.shipping, format: 'money' },
      { key: 'amountCollected', label: t.collected, format: 'money' }
    );
  }
  if (mode === 'finance') {
    base.push(
      { key: 'cogs', label: lang === 'ar' ? 'تكلفة البضاعة' : 'Coût produit', format: 'money' },
      { key: 'shippingCost', label: t.shipping, format: 'money' },
      { key: 'advertisingCost', label: lang === 'ar' ? 'إعلان' : 'Publicité', format: 'money' },
      { key: 'netProfit', label: t.profit, format: 'money' }
    );
  }
  return base;
}

function sum(rows, key) {
  return round2(rows.reduce((total, row) => total + (Number(row[key]) || 0), 0));
}

async function buildDataset(category, type, rawQuery, lang) {
  if (!DOCUMENT_TYPES[category] || !DOCUMENT_TYPES[category].includes(type)) {
    const error = new Error('Type de document inconnu');
    error.status = 400;
    throw error;
  }
  const query = withDefaults(category, type, rawQuery);
  const title = TITLES[lang][`${category}:${type}`] || `${category} / ${type}`;
  const t = LABELS[lang];

  if (category === 'orders' && type === 'individual') {
    if (!query.orderId) {
      const error = new Error('Sélectionnez une commande');
      error.status = 400;
      throw error;
    }
    const order = await Order.findById(query.orderId).lean();
    if (!order) {
      const error = new Error('Commande introuvable');
      error.status = 404;
      throw error;
    }
    const priced = economics(order);
    return {
      title,
      layout: 'order',
      order: { ...order, ...priced, shippingQuoted: order.shippingCost },
      query
    };
  }

  if (category === 'orders' && (type === 'by-city' || type === 'by-product')) {
    const rows = await grouped(query, type === 'by-city' ? 'cityName' : 'productName');
    return {
      title, layout: 'table', query,
      columns: [
        { key: 'name', label: type === 'by-city' ? t.city : t.product },
        { key: 'orders', label: t.orders, format: 'number' },
        { key: 'delivered', label: lang === 'ar' ? 'مسلّمة' : 'Livrées', format: 'number' },
        { key: 'returned', label: lang === 'ar' ? 'مرجعة' : 'Retours', format: 'number' },
        { key: 'revenue', label: t.revenue, format: 'money' }
      ],
      rows,
      summary: [
        { label: t.count, value: String(sum(rows, 'orders')) },
        { label: t.revenue, value: money(sum(rows, 'revenue'), lang) }
      ]
    };
  }

  if (category === 'delivery' && type === 'labels') {
    const rows = await listOrders(query, 150);
    return { title, layout: 'labels', labels: rows, query };
  }
  if (category === 'delivery' && type === 'bon') {
    const rows = await listOrders(query, 80);
    return { title, layout: 'notes', notes: rows, query };
  }
  if (category === 'delivery' && ['by-city', 'by-carrier', 'report'].includes(type)) {
    const field = type === 'by-carrier' ? 'shippingCompanyName' : 'cityName';
    const rows = type === 'report' ? await grouped(query, 'status') : await grouped(query, field);
    return {
      title, layout: 'table', query, rows,
      columns: [
        { key: 'name', label: type === 'by-carrier' ? t.carrier : type === 'report' ? t.status : t.city },
        { key: 'orders', label: t.orders, format: 'number' },
        { key: 'delivered', label: lang === 'ar' ? 'مسلّمة' : 'Livrées', format: 'number' },
        { key: 'returned', label: lang === 'ar' ? 'مرجعة' : 'Retours', format: 'number' },
        { key: 'collected', label: t.collected, format: 'money' },
        { key: 'shipping', label: t.shipping, format: 'money' }
      ],
      summary: [{ label: t.orders, value: String(sum(rows, 'orders')) }]
    };
  }
  if (category === 'delivery' && type === 'reconciliation') {
    const rows = (await listOrders(query)).map((order) => {
      const gap = round2((order.totalAmount || 0) - (order.amountCollected || 0));
      return { ...order, gap };
    });
    return {
      title, layout: 'table', query, rows,
      columns: [
        { key: 'orderNumber', label: 'N°' },
        { key: 'customerName', label: t.customer },
        { key: 'cityName', label: t.city },
        { key: 'status', label: t.status },
        { key: 'totalAmount', label: t.total, format: 'money' },
        { key: 'amountCollected', label: t.collected, format: 'money' },
        { key: 'gap', label: lang === 'ar' ? 'الفارق' : 'Écart', format: 'money' },
        { key: 'paymentStatus', label: lang === 'ar' ? 'الدفع' : 'Paiement' }
      ],
      summary: [
        { label: t.total, value: money(sum(rows, 'totalAmount'), lang) },
        { label: t.collected, value: money(sum(rows, 'amountCollected'), lang) },
        { label: lang === 'ar' ? 'الفارق' : 'Écart', value: money(sum(rows, 'gap'), lang) }
      ]
    };
  }

  if (category === 'finance' && ['daily', 'weekly', 'monthly'].includes(type)) {
    const format = type === 'monthly' ? '%Y-%m' : '%Y-%m-%d';
    let rows = await periodBuckets(query, format);
    if (type === 'weekly') {
      const orders = await listOrders(query);
      const buckets = new Map();
      for (const order of orders) {
        const key = isoWeek(order.orderDate);
        const moneyRow = economics(order);
        const current = buckets.get(key) || { period: key, orders: 0, revenue: 0, profit: 0 };
        current.orders += 1;
        current.revenue = round2(current.revenue + moneyRow.revenue);
        current.profit = round2(current.profit + moneyRow.netProfit);
        buckets.set(key, current);
      }
      rows = [...buckets.values()];
    }
    const summary = await financeSummary(query);
    return {
      title, layout: 'table', query, rows,
      columns: [
        { key: 'period', label: lang === 'ar' ? 'الفترة' : 'Période' },
        { key: 'orders', label: t.orders, format: 'number' },
        { key: 'revenue', label: t.revenue, format: 'money' },
        { key: 'profit', label: t.profit, format: 'money' }
      ],
      summary: [
        { label: t.revenue, value: money(summary.totalRevenue, lang) },
        { label: t.profit, value: money(summary.netProfit, lang) }
      ]
    };
  }
  if (category === 'finance' && type === 'pnl') {
    const summary = await financeSummary(query);
    const rows = [
      { line: t.revenue, amount: summary.totalRevenue },
      { line: lang === 'ar' ? 'تكلفة البضاعة المباعة' : 'Coût des produits livrés', amount: -summary.cogs },
      { line: lang === 'ar' ? 'مصاريف الشحن' : 'Frais de livraison', amount: -summary.shippingCosts },
      { line: lang === 'ar' ? 'الإعلان' : 'Publicité', amount: -summary.advertisingExpenses },
      { line: lang === 'ar' ? 'مصاريف إضافية على الطلبات' : 'Frais supplémentaires des commandes', amount: -summary.additionalExpenses },
      { line: lang === 'ar' ? 'مصاريف يدوية' : 'Charges manuelles', amount: -summary.manualExpenses },
      { line: lang === 'ar' ? 'مداخيل يدوية' : 'Produits manuels', amount: summary.manualIncome },
      { line: t.profit, amount: summary.netProfit }
    ];
    return {
      title, layout: 'table', query, rows,
      columns: [
        { key: 'line', label: lang === 'ar' ? 'البند' : 'Poste' },
        { key: 'amount', label: 'MAD', format: 'money' }
      ],
      summary: [{ label: t.profit, value: money(summary.netProfit, lang) }]
    };
  }
  if (category === 'finance' && type === 'cashflow') {
    const rows = await cashflow(query);
    return {
      title, layout: 'table', query, rows,
      columns: [
        { key: 'date', label: t.date },
        { key: 'inflow', label: lang === 'ar' ? 'دخول' : 'Entrées', format: 'money' },
        { key: 'outflow', label: lang === 'ar' ? 'خروج' : 'Sorties', format: 'money' },
        { key: 'net', label: lang === 'ar' ? 'الصافي' : 'Net', format: 'money' }
      ],
      summary: [
        { label: lang === 'ar' ? 'دخول' : 'Entrées', value: money(sum(rows, 'inflow'), lang) },
        { label: lang === 'ar' ? 'خروج' : 'Sorties', value: money(sum(rows, 'outflow'), lang) },
        { label: lang === 'ar' ? 'الصافي' : 'Net', value: money(sum(rows, 'net'), lang) }
      ]
    };
  }
  if (category === 'finance' && type === 'expenses') {
    const orders = (await listOrders(query)).map((order) => ({ ...order, ...economics(order) }));
    const manualMatch = { type: 'expense' };
    const range = dateRange(query);
    if (range) manualMatch.date = range;
    const manual = await Transaction.find(manualMatch).lean();
    const rows = [
      { source: lang === 'ar' ? 'تكلفة المنتجات المسلّمة' : 'Coût produits livrés', amount: sum(orders, 'cogs') },
      { source: lang === 'ar' ? 'الشحن' : 'Livraison', amount: sum(orders, 'shippingCost') },
      { source: lang === 'ar' ? 'إعلان على الطلبات' : 'Publicité commandes', amount: sum(orders, 'advertisingCost') },
      { source: lang === 'ar' ? 'مصاريف إضافية' : 'Frais supplémentaires', amount: sum(orders, 'additional') },
      ...manual.map((tx) => ({ source: `${tx.category} — ${tx.description || ''}`.trim(), amount: tx.amount }))
    ];
    return {
      title, layout: 'table', query, rows,
      columns: [
        { key: 'source', label: lang === 'ar' ? 'المصدر' : 'Origine' },
        { key: 'amount', label: 'MAD', format: 'money' }
      ],
      summary: [{ label: t.total, value: money(sum(rows, 'amount'), lang) }]
    };
  }
  if (category === 'finance' && (type === 'product-profit' || type === 'ads')) {
    if (type === 'product-profit') {
      const rows = await productPerformance(query);
      return {
        title, layout: 'table', query, rows,
        columns: [
          { key: 'product', label: t.product },
          { key: 'deliveredQty', label: t.qty, format: 'number' },
          { key: 'revenue', label: t.revenue, format: 'money' },
          { key: 'cogs', label: lang === 'ar' ? 'التكلفة' : 'Coût', format: 'money' },
          { key: 'shipping', label: t.shipping, format: 'money' },
          { key: 'advertising', label: lang === 'ar' ? 'إعلان' : 'Publicité', format: 'money' },
          { key: 'profit', label: t.profit, format: 'money' }
        ],
        summary: [{ label: t.profit, value: money(sum(rows, 'profit'), lang) }]
      };
    }
    const campaignMatch = {};
    const campaignRange = dateRange(query);
    if (campaignRange) campaignMatch.date = campaignRange;
    const campaigns = await Campaign.find(campaignMatch).sort({ date: -1 }).lean();
    const rows = [];
    for (const campaign of campaigns) {
      const linked = await Order.aggregate([
        { $match: { campaign: campaign._id, status: { $ne: 'Annulée' } } },
        { $group: {
          _id: '$campaign',
          orders: { $sum: 1 },
          delivered: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, 1, 0] } },
          revenue: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, '$totalAmount', 0] } }
        } }
      ]);
      const stats = campaignStats(campaign, linked[0]);
      rows.push({
        name: campaign.name,
        platform: campaign.platform === 'Other' && campaign.platformName ? campaign.platformName : campaign.platform,
        date: campaign.date,
        spend: campaign.actualSpending,
        orders: stats.orders,
        delivered: stats.delivered,
        revenue: stats.revenue,
        cpa: stats.cpa,
        roi: stats.roi
      });
    }
    return {
      title, layout: 'table', query, rows,
      columns: [
        { key: 'name', label: lang === 'ar' ? 'الحملة' : 'Campagne' },
        { key: 'platform', label: lang === 'ar' ? 'المنصة' : 'Plateforme' },
        { key: 'date', label: t.date, format: 'date' },
        { key: 'spend', label: lang === 'ar' ? 'الإنفاق' : 'Dépense', format: 'money' },
        { key: 'orders', label: t.orders, format: 'number' },
        { key: 'revenue', label: t.revenue, format: 'money' },
        { key: 'roi', label: 'ROI %', format: 'number' }
      ],
      summary: [{ label: lang === 'ar' ? 'الإنفاق' : 'Dépense', value: money(sum(rows, 'spend'), lang) }]
    };
  }

  if (category === 'products') {
    const settings = await getSettings();
    const filter = {};
    if (type === 'low-stock') {
      filter.status = 'active';
      filter.stock = { $lte: settings.lowStockThreshold };
    } else if (query.excludeArchived === '1') {
      filter.status = { $ne: 'archived' };
    }
    if (query.product) filter._id = query.product;
    if (query.search) {
      const rx = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [{ name: rx }, { code: rx }, { categoryName: rx }];
    }
    let rows = await Product.find(filter).sort({ name: 1 }).lean();
    if (type === 'performance') {
      rows = await productPerformance(query);
      return {
        title, layout: 'table', query, rows,
        columns: [
          { key: 'product', label: t.product },
          { key: 'orders', label: t.orders, format: 'number' },
          { key: 'revenue', label: t.revenue, format: 'money' },
          { key: 'profit', label: t.profit, format: 'money' }
        ],
        summary: [{ label: t.revenue, value: money(sum(rows, 'revenue'), lang) }]
      };
    }
    const columns = type === 'pricelist'
      ? [
        { key: 'code', label: 'Code' },
        { key: 'name', label: t.product },
        { key: 'sellingPrice', label: lang === 'ar' ? 'سعر البيع' : 'Prix de vente', format: 'money' },
        { key: 'discount', label: '%', format: 'number' }
      ]
      : [
        { key: 'code', label: 'Code' },
        { key: 'name', label: t.product },
        { key: 'categoryName', label: lang === 'ar' ? 'الفئة' : 'Catégorie' },
        { key: 'stock', label: lang === 'ar' ? 'المخزون' : 'Stock', format: 'number' },
        { key: 'initialStock', label: lang === 'ar' ? 'المخزون الأولي' : 'Stock initial', format: 'number' },
        { key: 'sellingPrice', label: lang === 'ar' ? 'سعر البيع' : 'Prix', format: 'money' },
        { key: 'status', label: t.status }
      ];
    if (type === 'catalog') {
      columns.splice(3, 0, { key: 'description', label: lang === 'ar' ? 'الوصف' : 'Description' });
    }
    return { title, layout: 'table', query, columns, rows, summary: [{ label: t.count, value: String(rows.length) }] };
  }

  if (category === 'dashboard') {
    const data = await dashboard(query, null);
    return { title, layout: 'dashboard', query, dashboard: data };
  }

  const mode = category === 'finance' ? 'finance' : category === 'delivery' ? 'delivery' : 'orders';
  const rows = (await listOrders(query)).map((order) => ({ ...order, ...economics(order) }));
  return {
    title, layout: 'table', query, rows,
    columns: orderColumns(lang, mode),
    summary: [
      { label: t.count, value: String(rows.length) },
      { label: t.revenue, value: money(sum(rows, 'revenue'), lang) },
      { label: t.collected, value: money(sum(rows, 'amountCollected'), lang) }
    ]
  };
}

function fontCss() {
  const dir = path.join(__dirname, '../../assets/fonts');
  const faces = [];
  const files = [
    ['Noto Sans', 'NotoSans-Regular.ttf'],
    ['Noto Naskh Arabic', 'NotoNaskhArabic-Regular.ttf']
  ];
  for (const [family, file] of files) {
    const full = path.join(dir, file);
    if (fs.existsSync(full)) {
      const data = fs.readFileSync(full).toString('base64');
      faces.push(`@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${data}) format('truetype');font-weight:400;}`);
    }
  }
  return faces.join('');
}

function renderCell(column, row, lang) {
  const value = row[column.key];
  if (column.format === 'money') return money(value, lang);
  if (column.format === 'date') return formatDate(value, lang);
  if (column.format === 'number') return value === null || value === undefined || value === '' ? '—' : String(value);
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function tableHtml(columns, rows, lang) {
  const t = LABELS[lang];
  if (!rows.length) return `<p class="empty">${esc(t.empty)}</p>`;
  const head = columns.map((column) => `<th class="${column.format === 'money' || column.format === 'number' ? 'num' : ''}">${esc(column.label)}</th>`).join('');
  const body = rows.map((row) => `<tr>${columns.map((column) => {
    const numeric = column.format === 'money' || column.format === 'number';
    return `<td class="${numeric ? 'num' : ''}" ${numeric ? 'dir="ltr"' : ''}>${esc(renderCell(column, row, lang))}</td>`;
  }).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function summaryHtml(summary) {
  if (!summary?.length) return '';
  return `<table class="summary"><tbody>${summary.map((item) => `<tr><td>${esc(item.label)}</td><td class="num" dir="ltr">${esc(item.value)}</td></tr>`).join('')}</tbody></table>`;
}

function filtersHtml(query, lang, descriptions) {
  const t = LABELS[lang];
  const parts = [];
  if (query.from || query.to) parts.push(`${query.from || '…'} → ${query.to || '…'}`);
  if (descriptions.status || query.status) parts.push(descriptions.status || query.status);
  if (descriptions.city) parts.push(descriptions.city);
  if (descriptions.product) parts.push(descriptions.product);
  if (descriptions.customer || query.customer) parts.push(descriptions.customer || query.customer);
  if (descriptions.carrier) parts.push(descriptions.carrier);
  const text = parts.length ? parts.join(' · ') : t.none;
  return `<p class="filters"><strong>${esc(t.filters)} :</strong> ${esc(text)}</p>`;
}

function shell({ lang, title, reference, company, body, confidential }) {
  const t = LABELS[lang];
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    ${fontCss()}
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ${lang === 'ar' ? "'Noto Naskh Arabic','Segoe UI',Tahoma,sans-serif" : "'Noto Sans','Segoe UI',Tahoma,sans-serif"}; color: #14212b; font-size: 11px; }
    header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 3px solid #0f766e; padding-bottom: 10px; margin-bottom: 14px; }
    .brand { display: flex; gap: 10px; align-items: center; }
    h1 { font-size: 18px; margin: 12px 0 4px; }
    .muted { color: #5d6d7a; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th { background: #0f766e; color: white; text-align: start; padding: 6px 7px; font-weight: 650; }
    td { padding: 5px 7px; border-bottom: 1px solid #e3e8ec; vertical-align: top; }
    tr { break-inside: avoid; }
    thead { display: table-header-group; }
    .num { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .summary { width: 280px; margin-inline-start: auto; margin-top: 12px; }
    .summary td { background: #f4f7f8; }
    .empty { padding: 18px; background: #f4f7f8; border-radius: 8px; }
    .note { margin-top: 16px; color: #5d6d7a; font-size: 9px; }
    .card { border: 1px solid #d5dee3; border-radius: 10px; padding: 10px; margin: 0 0 10px; break-inside: avoid; }
    .kpis { display: flex; flex-wrap: wrap; gap: 8px; }
    .kpi { width: 23%; border: 1px solid #d5dee3; border-radius: 8px; padding: 8px; }
    .kpi b { display: block; font-size: 13px; margin-top: 3px; }
    .sign { display: flex; gap: 12px; margin-top: 16px; }
    .sign div { flex: 1; border-top: 1px solid #14212b; padding-top: 6px; min-height: 48px; }
    .bar { height: 8px; background: #e3e8ec; border-radius: 99px; overflow: hidden; margin-top: 4px; }
    .bar span { display: block; height: 100%; background: #0f766e; }
  </style></head><body>
  <header>
    <div class="brand">
      <svg width="42" height="42" viewBox="0 0 42 42" aria-hidden="true"><rect width="42" height="42" rx="10" fill="#0f766e"/><text x="21" y="27" text-anchor="middle" font-size="14" font-family="Segoe UI, Arial" fill="white" font-weight="700">FB</text></svg>
      <div><strong>${esc(company.companyName || 'FBMS')}</strong><div class="muted">${esc(company.legalName || 'Full Business Management System')}</div>
      <div class="muted">${esc([company.address, company.city, company.country].filter(Boolean).join(' · '))}</div>
      <div class="muted">${esc([company.phone, company.email, company.ice ? `ICE ${company.ice}` : ''].filter(Boolean).join(' · '))}</div></div>
    </div>
    <div style="text-align:${dir === 'rtl' ? 'left' : 'right'}">
      <div><strong>${esc(t.reference)}</strong></div>
      <div dir="ltr">${esc(reference)}</div>
      <div class="muted">${esc(t.generated)} ${esc(formatDate(new Date(), lang))}</div>
    </div>
  </header>
  <h1>${esc(title)}</h1>
  ${confidential ? `<p class="muted">${esc(t.confidential)}</p>` : ''}
  ${body}
  <p class="note">${esc(t.note)} · MAD</p>
  </body></html>`;
}

function renderHtml(dataset, company, lang, reference, descriptions = {}) {
  const t = LABELS[lang];
  let body = filtersHtml(dataset.query || {}, lang, descriptions);
  if (dataset.layout === 'table') {
    body += tableHtml(dataset.columns, dataset.rows, lang);
    body += summaryHtml(dataset.summary);
  } else if (dataset.layout === 'order') {
    const order = dataset.order;
    body += `<div class="card"><strong>${esc(order.orderNumber)}</strong> · ${esc(formatDate(order.orderDate, lang))} · ${esc(order.status)}<br>
      ${esc(t.customer)}: ${esc(order.customerName)} · <span dir="ltr">${esc(order.customerPhone)}</span><br>
      ${esc(t.city)}: ${esc(order.cityName)} · ${esc(t.address)}: ${esc(order.address)}<br>
      ${esc(t.product)}: ${esc(order.productName)} × ${esc(order.quantity)}<br>
      ${esc(t.carrier)}: ${esc(order.shippingCompanyName || '—')} · ${esc(t.tracking)}: <span dir="ltr">${esc(order.trackingNumber || '—')}</span></div>`;
    body += summaryHtml([
      { label: t.total, value: money(order.totalAmount, lang) },
      { label: lang === 'ar' ? 'الهامش' : 'Marge brute', value: money(order.grossMargin, lang) },
      { label: t.shipping, value: money(order.shippingQuoted ?? order.shippingCost, lang) },
      { label: lang === 'ar' ? 'الإعلان' : 'Publicité', value: money(order.advertisingCost, lang) },
      { label: lang === 'ar' ? 'مصاريف إضافية' : 'Frais supplémentaires', value: money(order.additional, lang) },
      { label: t.collected, value: money(order.collected, lang) },
      { label: t.profit, value: money(order.netProfit, lang) }
    ]);
  } else if (dataset.layout === 'labels') {
    body += (dataset.labels || []).map((order) => `<div class="card"><strong>${esc(company.companyName || 'FBMS')}</strong> · <span dir="ltr">${esc(order.orderNumber)}</span><br>
      <strong>${esc(order.customerName)}</strong> · <span dir="ltr">${esc(order.customerPhone)}</span><br>
      ${esc(order.address)}, ${esc(order.cityName)}<br>
      ${esc(order.productName)} × ${esc(order.quantity)}<br>
      ${esc(t.cod)}: <strong dir="ltr">${esc(money(order.totalAmount, lang))}</strong><br>
      ${esc(t.carrier)}: ${esc(order.shippingCompanyName || '—')} · ${esc(t.tracking)}: <span dir="ltr">${esc(order.trackingNumber || '—')}</span></div>`).join('') || `<p class="empty">${esc(t.empty)}</p>`;
  } else if (dataset.layout === 'notes') {
    body += (dataset.notes || []).map((order) => `<div class="card"><strong>${esc(t.reference)} <span dir="ltr">${esc(order.orderNumber)}</span></strong><br>
      ${esc(formatDate(order.orderDate, lang))}<br><br>
      ${esc(t.customer)}: ${esc(order.customerName)}<br>
      ${esc(t.phone)}: <span dir="ltr">${esc(order.customerPhone)}</span><br>
      ${esc(t.address)}: ${esc(order.address)}, ${esc(order.cityName)}<br><br>
      ${esc(t.product)}: ${esc(order.productName)} · ${esc(t.qty)}: ${esc(order.quantity)}<br>
      ${esc(t.cod)}: <strong dir="ltr">${esc(money(order.totalAmount, lang))}</strong><br>
      ${esc(t.carrier)}: ${esc(order.shippingCompanyName || '—')} · ${esc(t.tracking)}: <span dir="ltr">${esc(order.trackingNumber || '—')}</span>
      <div class="sign"><div>${esc(t.agentSign)}</div><div>${esc(t.clientSign)}</div></div></div>`).join('') || `<p class="empty">${esc(t.empty)}</p>`;
  } else if (dataset.layout === 'dashboard') {
    const data = dataset.dashboard;
    const kpis = data.kpis || {};
    const cards = Object.entries(kpis).slice(0, 12);
    body += `<div class="kpis">${cards.map(([key, value]) => `<div class="kpi"><span class="muted">${esc(key)}</span><b dir="ltr">${esc(typeof value === 'number' && /rate|Rate/.test(key) ? `${value}%` : typeof value === 'number' && !/Orders|orders|Rate/.test(key) ? money(value, lang) : value)}</b></div>`).join('')}</div>`;
    const maxCity = Math.max(1, ...data.ordersByCity.map((item) => item.orders));
    body += `<h2>${esc(t.city)}</h2>` + data.ordersByCity.map((item) => `<div>${esc(item.city)} · ${item.orders}<div class="bar"><span style="width:${Math.round(item.orders / maxCity * 100)}%"></span></div></div>`).join('');
    body += `<h2>${esc(t.status)}</h2>${tableHtml(
      [{ key: 'status', label: t.status }, { key: 'value', label: t.count, format: 'number' }],
      data.ordersByStatus, lang
    )}`;
    if (data.profitByMonth?.length) {
      body += `<h2>${esc(t.profit)}</h2>${tableHtml(
        [
          { key: 'month', label: lang === 'ar' ? 'الشهر' : 'Mois' },
          { key: 'revenue', label: t.revenue, format: 'money' },
          { key: 'profit', label: t.profit, format: 'money' }
        ],
        data.profitByMonth, lang
      )}`;
    }
  }
  return shell({
    lang,
    title: dataset.title,
    reference,
    company,
    body,
    confidential: Boolean(dataset.sensitive)
  });
}

async function htmlToPdf(html) {
  const executablePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (!fs.existsSync(executablePath)) {
    const error = new Error('Chrome est introuvable. Définissez CHROME_PATH pour générer les PDF.');
    error.status = 503;
    throw error;
  }
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="font-size:8px;width:100%;padding:0 10mm;color:#5d6d7a;font-family:Segoe UI,Tahoma,sans-serif;display:flex;justify-content:space-between;"><span>FBMS</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
      margin: { top: '12mm', bottom: '16mm', left: '10mm', right: '10mm' }
    });
  } finally {
    await browser.close();
  }
}

module.exports = { buildDataset, renderHtml, htmlToPdf, money, formatDate };
