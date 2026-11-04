const { round2 } = require('./helpers');
const { SHIPPED_STATUSES, STOCK_DEDUCT_STATUSES } = require('../constants');

function orderAmounts({ quantity, sellingPrice, purchasePrice }) {
  const qty = Number(quantity) || 0;
  const sell = Number(sellingPrice) || 0;
  const buy = Number(purchasePrice) || 0;
  return {
    quantity: qty,
    sellingPrice: round2(sell),
    purchasePrice: round2(buy),
    totalAmount: round2(qty * sell),
    unitMargin: round2(sell - buy),
    grossMargin: round2(qty * (sell - buy)),
    cogs: round2(qty * buy)
  };
}

function effectiveSellingPrice(product) {
  const discount = Math.min(100, Math.max(0, Number(product.discount) || 0));
  return round2((Number(product.sellingPrice) || 0) * (1 - discount / 100));
}

function shouldDeductStock(status) {
  return STOCK_DEDUCT_STATUSES.includes(status);
}

function economics(order) {
  const qty = Number(order.quantity) || 0;
  const sell = Number(order.sellingPrice) || 0;
  const buy = Number(order.purchasePrice) || 0;
  const totalAmount = round2(qty * sell);
  const delivered = order.status === 'Livrée';
  const shippingIncurred = SHIPPED_STATUSES.includes(order.status);
  const revenue = delivered ? totalAmount : 0;
  const cogs = delivered ? round2(qty * buy) : 0;
  const shippingCost = shippingIncurred ? round2(order.shippingCost) : 0;
  const advertisingCost = round2(order.advertisingCost);
  const additional = round2(order.additionalExpenses);
  const hasCollected = order.amountCollected !== undefined && order.amountCollected !== null && order.amountCollected !== '';
  const collected = delivered
    ? round2(hasCollected ? order.amountCollected : totalAmount)
    : round2(hasCollected ? order.amountCollected : 0);
  const netProfit = round2(revenue - cogs - shippingCost - advertisingCost - additional);
  return {
    totalAmount,
    revenue,
    cogs,
    shippingCost,
    advertisingCost,
    additional,
    collected,
    netProfit,
    grossMargin: round2(revenue - cogs)
  };
}

function suggestPaymentStatus(order) {
  if (order.status === 'Retour') return 'refunded';
  if (order.status === 'Annulée') return 'unpaid';
  const total = round2((Number(order.quantity) || 0) * (Number(order.sellingPrice) || 0));
  const collected = Number(order.amountCollected || 0);
  if (collected <= 0) return 'unpaid';
  if (collected + 0.009 < total) return 'partial';
  return 'paid';
}

module.exports = {
  orderAmounts,
  effectiveSellingPrice,
  shouldDeductStock,
  economics,
  suggestPaymentStatus
};
