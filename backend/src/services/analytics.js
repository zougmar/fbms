const { Order, Campaign, Transaction, Product, Settings } = require('../models');
const { economics } = require('../utils/finance');
const { escapeRegex, toObjectId, dateRange, round2, dayKey } = require('../utils/helpers');
const { can } = require('../middleware/auth');

function buildOrderMatch(query, overrides = {}) {
  const match = {};
  if (overrides.statuses || query.statuses) {
    const list = overrides.statuses || query.statuses;
    match.status = { $in: Array.isArray(list) ? list : String(list).split(',') };
  } else if (overrides.status || query.status) match.status = overrides.status || query.status;
  const range = dateRange(query);
  if (range) match.orderDate = range;
  if (query.city) {
    const city = toObjectId(query.city);
    if (!city) {
      const error = new Error('Ville invalide');
      error.status = 400;
      throw error;
    }
    match.city = city;
  }
  if (query.product) {
    const product = toObjectId(query.product);
    if (!product) {
      const error = new Error('Produit invalide');
      error.status = 400;
      throw error;
    }
    match.product = product;
  }
  if (query.shippingCompany) {
    const carrier = toObjectId(query.shippingCompany);
    if (!carrier) {
      const error = new Error('Société de livraison invalide');
      error.status = 400;
      throw error;
    }
    match.shippingCompany = carrier;
  }
  if (query.orderId) {
    const id = toObjectId(query.orderId);
    if (!id) {
      const error = new Error('Commande invalide');
      error.status = 400;
      throw error;
    }
    match._id = id;
  }
  const and = [];
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    and.push({ $or: [
      { orderNumber: rx }, { customerName: rx }, { customerPhone: rx },
      { trackingNumber: rx }, { productName: rx }, { cityName: rx }
    ] });
  }
  if (query.customer) {
    const rx = new RegExp(escapeRegex(query.customer), 'i');
    and.push({ $or: [{ customerName: rx }, { customerPhone: rx }] });
  }
  if (and.length) match.$and = and;
  return match;
}

function emptyKpi() {
  return {
    totalOrders: 0, pending: 0, confirmed: 0, preparing: 0, shipped: 0,
    delivered: 0, returned: 0, cancelled: 0, revenue: 0, cogs: 0, shipping: 0,
    extra: 0, orderAdsLinked: 0, orderAdsUnlinked: 0
  };
}

async function aggregateOrders(match) {
  const [row] = await Order.aggregate([
    { $match: match },
    { $group: {
      _id: null,
      totalOrders: { $sum: 1 },
      pending: { $sum: { $cond: [{ $eq: ['$status', 'À confirmer'] }, 1, 0] } },
      confirmed: { $sum: { $cond: [{ $eq: ['$status', 'Confirmée'] }, 1, 0] } },
      preparing: { $sum: { $cond: [{ $eq: ['$status', 'En préparation'] }, 1, 0] } },
      shipped: { $sum: { $cond: [{ $eq: ['$status', 'Expédiée'] }, 1, 0] } },
      delivered: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, 1, 0] } },
      returned: { $sum: { $cond: [{ $eq: ['$status', 'Retour'] }, 1, 0] } },
      cancelled: { $sum: { $cond: [{ $eq: ['$status', 'Annulée'] }, 1, 0] } },
      revenue: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, { $ifNull: ['$totalAmount', 0] }, 0] } },
      cogs: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, { $multiply: [{ $ifNull: ['$purchasePrice', 0] }, { $ifNull: ['$quantity', 0] }] }, 0] } },
      shipping: { $sum: { $cond: [{ $in: ['$status', ['Expédiée', 'Livrée', 'Retour']] }, { $ifNull: ['$shippingCost', 0] }, 0] } },
      extra: { $sum: { $cond: [{ $ne: ['$status', 'Annulée'] }, { $ifNull: ['$additionalExpenses', 0] }, 0] } },
      orderAds: { $sum: { $ifNull: ['$advertisingCost', 0] } },
      orderAdsLinked: { $sum: { $cond: [
        { $ne: [{ $ifNull: ['$campaign', null] }, null] },
        { $ifNull: ['$advertisingCost', 0] },
        0
      ] } },
      orderAdsUnlinked: { $sum: { $cond: [
        { $eq: [{ $ifNull: ['$campaign', null] }, null] },
        { $ifNull: ['$advertisingCost', 0] },
        0
      ] } }
    } }
  ]);
  return row || emptyKpi();
}

async function manualTotals(query) {
  const match = { source: 'manual' };
  const range = dateRange(query);
  if (range) match.date = range;
  const rows = await Transaction.aggregate([
    { $match: match },
    { $group: { _id: '$type', total: { $sum: '$amount' } } }
  ]);
  const income = rows.find((row) => row._id === 'income')?.total || 0;
  const expense = rows.find((row) => row._id === 'expense')?.total || 0;
  return { income: round2(income), expense: round2(expense) };
}

async function campaignSpend(query) {
  const match = {};
  const range = dateRange(query);
  if (range) match.date = range;
  if (query.product) {
    const product = toObjectId(query.product);
    if (product) match.product = product;
  }
  const [row] = await Campaign.aggregate([
    { $match: match },
    { $group: { _id: null, spend: { $sum: '$actualSpending' }, budget: { $sum: '$budget' } } }
  ]);
  return { spend: round2(row?.spend || 0), budget: round2(row?.budget || 0) };
}

function finalizeKpi(row, extras, narrowed) {
  const advertisingExpenses = narrowed
    ? round2((row.orderAdsLinked || 0) + (row.orderAdsUnlinked || 0))
    : round2(extras.campaignSpend + (row.orderAdsUnlinked || 0));
  const manualExpense = narrowed ? 0 : extras.manualExpense;
  const manualIncome = narrowed ? 0 : extras.manualIncome;
  const closed = (row.delivered || 0) + (row.returned || 0);
  const netProfit = round2(
    (row.revenue || 0) - (row.cogs || 0) - (row.shipping || 0) - (row.extra || 0)
    - advertisingExpenses - manualExpense + manualIncome
  );
  return {
    totalOrders: row.totalOrders || 0,
    confirmedOrders: row.confirmed || 0,
    pendingOrders: row.pending || 0,
    preparingOrders: row.preparing || 0,
    shippedOrders: row.shipped || 0,
    deliveredOrders: row.delivered || 0,
    returnedOrders: row.returned || 0,
    cancelledOrders: row.cancelled || 0,
    totalRevenue: round2(row.revenue || 0),
    cogs: round2(row.cogs || 0),
    shippingCosts: round2(row.shipping || 0),
    additionalExpenses: round2(row.extra || 0),
    advertisingExpenses,
    manualIncome: round2(manualIncome),
    manualExpenses: round2(manualExpense),
    netProfit,
    deliverySuccessRate: closed ? round2((row.delivered / closed) * 100) : 0,
    returnRate: closed ? round2((row.returned / closed) * 100) : 0,
    cancellationRate: row.totalOrders ? round2(((row.cancelled || 0) / row.totalOrders) * 100) : 0,
    averageOrderValue: row.delivered ? round2(row.revenue / row.delivered) : 0
  };
}

async function dashboard(query, user) {
  const match = buildOrderMatch(query);
  const narrowed = Boolean(query.city || query.status || query.product);
  const [row, manual, ads, sales, months, byCity, topProducts, byStatus] = await Promise.all([
    aggregateOrders(match),
    manualTotals(query),
    campaignSpend(query),
    Order.aggregate([
      { $match: match },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$orderDate' } },
        orders: { $sum: 1 },
        revenue: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, '$totalAmount', 0] } }
      } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', orders: 1, revenue: { $round: ['$revenue', 2] } } }
    ]),
    Order.aggregate([
      { $match: match },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$orderDate' } },
        revenue: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, '$totalAmount', 0] } },
        cogs: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, { $multiply: ['$purchasePrice', '$quantity'] }, 0] } },
        shipping: { $sum: { $cond: [{ $in: ['$status', ['Expédiée', 'Livrée', 'Retour']] }, '$shippingCost', 0] } },
        extra: { $sum: { $ifNull: ['$additionalExpenses', 0] } },
        ads: { $sum: { $ifNull: ['$advertisingCost', 0] } },
        orders: { $sum: 1 }
      } },
      { $sort: { _id: 1 } }
    ]),
    Order.aggregate([
      { $match: match },
      { $group: {
        _id: '$cityName',
        orders: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, 1, 0] } },
        revenue: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, '$totalAmount', 0] } }
      } },
      { $sort: { orders: -1 } },
      { $limit: 12 }
    ]),
    Order.aggregate([
      { $match: { ...match, status: match.status || { $ne: 'Annulée' } } },
      { $group: {
        _id: '$productName',
        quantity: { $sum: '$quantity' },
        revenue: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, '$totalAmount', 0] } }
      } },
      { $sort: { quantity: -1 } },
      { $limit: 8 }
    ]),
    Order.aggregate([
      { $match: match },
      { $group: { _id: '$status', value: { $sum: 1 } } }
    ])
  ]);
  const kpis = finalizeKpi(row, {
    campaignSpend: ads.spend,
    manualExpense: manual.expense,
    manualIncome: manual.income
  }, narrowed);
  const profitByMonth = months.map((month) => ({
    month: month._id,
    revenue: round2(month.revenue),
    costs: round2(month.cogs + month.shipping + month.extra + month.ads),
    profit: round2(month.revenue - month.cogs - month.shipping - month.extra - month.ads)
  }));
  const seeMoney = !user || can(user, 'finances', 'view');
  const seeAds = !user || can(user, 'advertising', 'view') || seeMoney;
  const payload = {
    kpis: seeMoney ? kpis : {
      totalOrders: kpis.totalOrders,
      confirmedOrders: kpis.confirmedOrders,
      pendingOrders: kpis.pendingOrders,
      preparingOrders: kpis.preparingOrders,
      shippedOrders: kpis.shippedOrders,
      deliveredOrders: kpis.deliveredOrders,
      returnedOrders: kpis.returnedOrders,
      cancelledOrders: kpis.cancelledOrders,
      deliverySuccessRate: kpis.deliverySuccessRate,
      returnRate: kpis.returnRate,
      cancellationRate: kpis.cancellationRate
    },
    sales,
    ordersByStatus: byStatus.map((item) => ({ status: item._id, value: item.value })),
    ordersByCity: byCity.map((item) => ({
      city: item._id,
      orders: item.orders,
      delivered: item.delivered,
      revenue: seeMoney ? round2(item.revenue) : undefined
    })),
    topProducts: topProducts.map((item) => ({
      product: item._id,
      quantity: item.quantity,
      revenue: seeMoney ? round2(item.revenue) : undefined
    })),
    deliveryPerformance: [
      { name: 'Livrée', value: kpis.deliveredOrders },
      { name: 'Retour', value: kpis.returnedOrders },
      { name: 'Expédiée', value: kpis.shippedOrders },
      { name: 'En préparation', value: kpis.preparingOrders }
    ],
    profitByMonth: seeMoney ? profitByMonth : [],
    revenueByMonth: seeMoney ? profitByMonth.map((item) => ({ month: item.month, revenue: item.revenue })) : []
  };
  if (seeAds) payload.advertising = await advertisingSeries(query);
  return payload;
}

async function advertisingSeries(query) {
  const match = {};
  const range = dateRange(query);
  if (range) match.date = range;
  if (query.product && toObjectId(query.product)) match.product = toObjectId(query.product);
  const campaigns = await Campaign.find(match).sort({ date: -1 }).limit(20).lean();
  const ids = campaigns.map((item) => item._id);
  const linked = ids.length ? await Order.aggregate([
    { $match: { campaign: { $in: ids }, status: { $ne: 'Annulée' } } },
    { $group: {
      _id: '$campaign',
      orders: { $sum: 1 },
      delivered: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, 1, 0] } },
      revenue: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, '$totalAmount', 0] } }
    } }
  ]) : [];
  const byId = new Map(linked.map((item) => [String(item._id), item]));
  return campaigns.map((campaign) => {
    const stats = campaignStats(campaign, byId.get(String(campaign._id)));
    return {
      name: campaign.name,
      platform: campaign.platform,
      spend: round2(campaign.actualSpending),
      revenue: stats.revenue,
      roi: stats.roi
    };
  });
}

function campaignStats(campaign, linked) {
  const useManual = !linked || (linked.orders === 0 && (campaign.manualOrders || campaign.manualDelivered));
  const orders = useManual ? Number(campaign.manualOrders || 0) : linked.orders;
  const delivered = useManual ? Number(campaign.manualDelivered || 0) : linked.delivered;
  const revenue = useManual ? 0 : round2(linked.revenue || 0);
  const spend = round2(campaign.actualSpending || 0);
  return {
    orders,
    delivered,
    revenue,
    source: useManual ? 'manual' : 'orders',
    cpa: orders ? round2(spend / orders) : null,
    deliveredCpa: delivered ? round2(spend / delivered) : null,
    roi: spend ? round2(((revenue - spend) / spend) * 100) : null
  };
}

async function listOrders(query, limit = 2000) {
  return Order.find(buildOrderMatch(query)).sort({ orderDate: -1, createdAt: -1 }).limit(limit).lean();
}

function presentRows(orders) {
  return orders.map((order) => {
    const money = economics(order);
    return { ...order, ...money };
  });
}

async function productPerformance(query) {
  const match = buildOrderMatch(query);
  const rows = await Order.aggregate([
    { $match: match },
    { $group: {
      _id: { name: '$productName', code: '$productCode' },
      orders: { $sum: 1 },
      quantity: { $sum: '$quantity' },
      deliveredQty: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, '$quantity', 0] } },
      revenue: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, '$totalAmount', 0] } },
      cogs: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, { $multiply: ['$purchasePrice', '$quantity'] }, 0] } },
      shipping: { $sum: { $cond: [{ $in: ['$status', ['Expédiée', 'Livrée', 'Retour']] }, '$shippingCost', 0] } },
      ads: { $sum: '$advertisingCost' },
      extra: { $sum: '$additionalExpenses' },
      returned: { $sum: { $cond: [{ $eq: ['$status', 'Retour'] }, 1, 0] } }
    } },
    { $sort: { revenue: -1 } }
  ]);
  return rows.map((row) => ({
    product: row._id.name,
    code: row._id.code,
    orders: row.orders,
    quantity: row.quantity,
    deliveredQty: row.deliveredQty,
    returned: row.returned,
    revenue: round2(row.revenue),
    cogs: round2(row.cogs),
    shipping: round2(row.shipping),
    advertising: round2(row.ads),
    additional: round2(row.extra),
    profit: round2(row.revenue - row.cogs - row.shipping - row.ads - row.extra)
  }));
}

async function grouped(query, field) {
  const match = buildOrderMatch(query);
  const rows = await Order.aggregate([
    { $match: match },
    { $group: {
      _id: `$${field}`,
      orders: { $sum: 1 },
      delivered: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, 1, 0] } },
      returned: { $sum: { $cond: [{ $eq: ['$status', 'Retour'] }, 1, 0] } },
      cancelled: { $sum: { $cond: [{ $eq: ['$status', 'Annulée'] }, 1, 0] } },
      revenue: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, '$totalAmount', 0] } },
      collected: { $sum: '$amountCollected' },
      shipping: { $sum: '$shippingCost' }
    } },
    { $sort: { orders: -1 } }
  ]);
  return rows.map((row) => ({
    name: row._id || '—',
    orders: row.orders,
    delivered: row.delivered,
    returned: row.returned,
    cancelled: row.cancelled,
    revenue: round2(row.revenue),
    collected: round2(row.collected),
    shipping: round2(row.shipping)
  }));
}

async function periodBuckets(query, format) {
  const match = buildOrderMatch(query);
  const rows = await Order.aggregate([
    { $match: match },
    { $group: {
      _id: { $dateToString: { format, date: '$orderDate' } },
      orders: { $sum: 1 },
      delivered: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, 1, 0] } },
      revenue: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, '$totalAmount', 0] } },
      cogs: { $sum: { $cond: [{ $eq: ['$status', 'Livrée'] }, { $multiply: ['$purchasePrice', '$quantity'] }, 0] } },
      shipping: { $sum: { $cond: [{ $in: ['$status', ['Expédiée', 'Livrée', 'Retour']] }, '$shippingCost', 0] } },
      ads: { $sum: '$advertisingCost' },
      extra: { $sum: '$additionalExpenses' }
    } },
    { $sort: { _id: 1 } }
  ]);
  return rows.map((row) => ({
    period: row._id,
    orders: row.orders,
    delivered: row.delivered,
    revenue: round2(row.revenue),
    cogs: round2(row.cogs),
    shipping: round2(row.shipping),
    advertising: round2(row.ads),
    additional: round2(row.extra),
    profit: round2(row.revenue - row.cogs - row.shipping - row.ads - row.extra)
  }));
}

async function financeSummary(query) {
  const match = buildOrderMatch(query);
  const narrowed = Boolean(query.city || query.status || query.product);
  const [row, manual, ads] = await Promise.all([
    aggregateOrders(match),
    manualTotals(query),
    campaignSpend(query)
  ]);
  return finalizeKpi(row, {
    campaignSpend: ads.spend,
    manualExpense: manual.expense,
    manualIncome: manual.income
  }, narrowed);
}

async function getSettings() {
  let settings = await Settings.findOne({ key: 'company' });
  if (!settings) {
    settings = await Settings.create({ key: 'company' });
  }
  return settings;
}

function isoWeek(date) {
  const value = new Date(date);
  const target = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function cashflow(query) {
  const orders = await listOrders(query, 5000);
  const manualMatch = {};
  const range = dateRange(query);
  if (range) manualMatch.date = range;
  const manual = await Transaction.find(manualMatch).sort({ date: 1 }).lean();
  const buckets = new Map();
  const touch = (date, patch) => {
    const key = dayKey(date);
    const current = buckets.get(key) || { date: key, inflow: 0, outflow: 0 };
    current.inflow = round2(current.inflow + (patch.inflow || 0));
    current.outflow = round2(current.outflow + (patch.outflow || 0));
    buckets.set(key, current);
  };
  for (const order of orders) {
    const money = economics(order);
    touch(order.orderDate, {
      inflow: money.revenue,
      outflow: round2(money.cogs + money.shippingCost + money.advertisingCost + money.additional)
    });
  }
  for (const tx of manual) {
    touch(tx.date, tx.type === 'income' ? { inflow: tx.amount } : { outflow: tx.amount });
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date)).map((row) => ({
    ...row,
    net: round2(row.inflow - row.outflow)
  }));
}

module.exports = {
  buildOrderMatch,
  dashboard,
  listOrders,
  presentRows,
  productPerformance,
  grouped,
  periodBuckets,
  financeSummary,
  getSettings,
  campaignStats,
  advertisingSeries,
  cashflow,
  isoWeek,
  manualTotals
};
