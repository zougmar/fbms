const test = require('node:test');
const assert = require('node:assert/strict');
const { orderAmounts, economics, shouldDeductStock, suggestPaymentStatus } = require('../utils/finance');
const { roleDefaults } = require('../constants');

test('order total is quantity times selling price', () => {
  const amounts = orderAmounts({ quantity: 3, sellingPrice: 150, purchasePrice: 80 });
  assert.equal(amounts.totalAmount, 450);
  assert.equal(amounts.grossMargin, 210);
  assert.equal(amounts.cogs, 240);
});

test('delivered profit subtracts every applicable cost', () => {
  const result = economics({
    status: 'Livrée',
    quantity: 2,
    sellingPrice: 200,
    purchasePrice: 90,
    shippingCost: 35,
    advertisingCost: 20,
    additionalExpenses: 5,
    amountCollected: 400
  });
  assert.equal(result.revenue, 400);
  assert.equal(result.cogs, 180);
  assert.equal(result.shippingCost, 35);
  assert.equal(result.netProfit, 160);
});

test('returned and cancelled orders are not completed sales', () => {
  const returned = economics({
    status: 'Retour',
    quantity: 1,
    sellingPrice: 200,
    purchasePrice: 90,
    shippingCost: 35,
    advertisingCost: 20,
    additionalExpenses: 0,
    amountCollected: 0
  });
  assert.equal(returned.revenue, 0);
  assert.equal(returned.cogs, 0);
  assert.equal(returned.shippingCost, 35);
  assert.equal(returned.netProfit, -55);

  const cancelled = economics({
    status: 'Annulée',
    quantity: 1,
    sellingPrice: 200,
    purchasePrice: 90,
    shippingCost: 35,
    advertisingCost: 15,
    additionalExpenses: 0
  });
  assert.equal(cancelled.revenue, 0);
  assert.equal(cancelled.cogs, 0);
  assert.equal(cancelled.shippingCost, 0);
  assert.equal(cancelled.netProfit, -15);
});

test('shipping is incurred only after the parcel leaves or comes back', () => {
  const preparing = economics({
    status: 'En préparation',
    quantity: 1,
    sellingPrice: 100,
    purchasePrice: 40,
    shippingCost: 45,
    advertisingCost: 10,
    additionalExpenses: 0
  });
  assert.equal(preparing.revenue, 0);
  assert.equal(preparing.shippingCost, 0);
  assert.equal(preparing.netProfit, -10);
  assert.equal(shouldDeductStock('En préparation'), true);
  assert.equal(shouldDeductStock('À confirmer'), false);
  assert.equal(shouldDeductStock('Retour'), false);
});

test('payment suggestion follows collected cash', () => {
  assert.equal(suggestPaymentStatus({ status: 'Livrée', quantity: 1, sellingPrice: 100, amountCollected: 100 }), 'paid');
  assert.equal(suggestPaymentStatus({ status: 'Livrée', quantity: 1, sellingPrice: 100, amountCollected: 40 }), 'partial');
  assert.equal(suggestPaymentStatus({ status: 'Retour', quantity: 1, sellingPrice: 100, amountCollected: 0 }), 'refunded');
});

test('confirmation agents cannot open finances or delete orders', () => {
  const permissions = roleDefaults('confirmation_agent');
  assert.equal(permissions.orders.view, true);
  assert.equal(permissions.orders.edit, true);
  assert.equal(permissions.orders.delete, false);
  assert.equal(permissions.finances.view, false);
  assert.equal(permissions.documents.financial, false);
  assert.equal(roleDefaults('admin').finances.delete, true);
});
