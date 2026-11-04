const express = require('express');
const { z } = require('zod');
const { protect } = require('../middleware/auth');
const { wrap } = require('../utils/helpers');
const { htmlToPdf } = require('../services/documents');
const {
  canDeliver, canIssueTicket, assertAssigned, findByToken, recordScan, confirmDelivery, issueTicket, presentDeskOrder
} = require('../services/deliveryDesk');

const router = express.Router();
router.use(protect);

router.post('/:token', wrap(async (req, res) => {
  if (!canDeliver(req.user)) return res.status(403).json({ message: 'Permission insuffisante' });
  const order = await findByToken(req.params.token);
  assertAssigned(order, req.user);
  const scan = await recordScan(order, req.user, req.headers['user-agent']);
  res.json({ item: await presentDeskOrder(order, req.user), scanId: scan._id });
}));

router.post('/:token/confirm', wrap(async (req, res) => {
  if (!canDeliver(req.user)) return res.status(403).json({ message: 'Permission insuffisante' });
  const body = z.object({ note: z.string().max(500).optional() }).parse(req.body || {});
  const order = await findByToken(req.params.token);
  assertAssigned(order, req.user);
  await recordScan(order, req.user, req.headers['user-agent']);
  const result = await confirmDelivery(order, req.user, body.note);
  res.json({
    item: await presentDeskOrder(result.order, req.user),
    confirmation: result.confirmation
  });
}));

router.post('/:token/ticket', wrap(async (req, res) => {
  if (req.user.role === 'livreur' || !canIssueTicket(req.user)) return res.status(403).json({ message: 'Permission insuffisante' });
  const order = await findByToken(req.params.token);
  const { ticket, html } = await issueTicket(order, req.user);
  if (req.query.format === 'pdf') {
    const file = Buffer.from(await htmlToPdf(html));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${ticket.reference}.pdf"`);
    return res.send(file);
  }
  res.json({ ticket, html });
}));

module.exports = router;
