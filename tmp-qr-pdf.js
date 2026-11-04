const path = require('path');
const crypto = require('crypto');
const backend = path.join(__dirname, 'backend');
module.paths.unshift(path.join(backend, 'node_modules'));
require('dotenv').config({ path: path.join(backend, '.env') });
const jwt = require('jsonwebtoken');
const { connectDB } = require(path.join(backend, 'src/db'));
const { User, Session, Order } = require(path.join(backend, 'src/models'));
const API = 'http://localhost:5000/api';

async function raw(token, method, url) {
  const res = await fetch(API + url, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 80).toString('utf8');
  return { status: res.status, type: res.headers.get('content-type'), length: buf.length, head: head.replace(/\s+/g, ' ').slice(0, 180) };
}

async function mint(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ id: user._id.toString(), jti }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const decoded = jwt.decode(token);
  await Session.create({ user: user._id, jti, userAgent: 'qr-check', ip: '127.0.0.1', expiresAt: new Date(decoded.exp * 1000) });
  return { token, jti };
}

async function main() {
  await connectDB();
  const login = await fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@fbms.ma', password: 'Admin@12345' })
  });
  const admin = await login.json();
  const order = await Order.findOne().select('_id orderNumber qrToken assignedTo status');
  const livreur = await User.findOne({ role: 'livreur', active: { $ne: false } });
  const session = await mint(livreur);
  const report = {
    order: order?.orderNumber,
    assigned: Boolean(order?.assignedTo),
    adminQr: await raw(admin.token, 'GET', `/orders/${order._id}/qr`),
    adminPdf: await raw(admin.token, 'GET', `/documents/pdf?category=orders&type=all&lang=fr`),
    livreurQr: await raw(session.token, 'GET', `/orders/${order._id}/qr`),
    livreurScan: await raw(session.token, 'POST', `/scan/${order.qrToken}`)
  };
  await Session.updateOne({ jti: session.jti }, { revoked: true, loggedOutAt: new Date() });
  console.log(JSON.stringify(report, null, 2));
  await require('mongoose').disconnect();
}

main().catch(async (error) => {
  console.error(error.stack || error.message);
  try { await require('mongoose').disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
