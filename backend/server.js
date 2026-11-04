require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { connectDB } = require('./src/db');
const { migrateAccess } = require('./src/services/migrateAccess');
const { notFound, errorHandler } = require('./src/middleware/errors');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin(origin, callback) {
    const allowed = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((item) => item.trim());
    if (!origin || allowed.includes(origin) || process.env.NODE_ENV !== 'production') return callback(null, true);
    return callback(new Error('Origine non autorisée'));
  },
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 1200, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'FBMS', database: 'mongodb-atlas' });
});

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/notifications', require('./src/routes/notifications'));
app.use('/api/sync', require('./src/routes/sync'));
app.use('/api/users/performance', require('./src/routes/performance'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/tasks', require('./src/routes/tasks'));
app.use('/api/scan', require('./src/routes/scan'));
app.use('/api/products', require('./src/routes/catalog'));
app.use('/api', require('./src/routes/shipping'));
app.use('/api/orders', require('./src/routes/orders'));
app.use('/api/order-requests', require('./src/routes/orderRequests'));
app.use('/api/campaigns', require('./src/routes/campaigns'));
app.use('/api/finances', require('./src/routes/finance'));
app.use('/api', require('./src/routes/insights'));
app.use('/api/documents', require('./src/routes/documents'));
app.use('/api', require('./src/routes/system'));

app.use('/api', notFound);
app.use(errorHandler);

const port = process.env.PORT || 5000;

if (require.main === module) {
  connectDB()
    .then(() => migrateAccess())
    .then(() => {
      app.listen(port, () => {
        console.log(`FBMS API listening on ${port}`);
      });
    })
    .catch((error) => {
      console.error('FBMS failed to start:', error.message);
      process.exit(1);
    });
}

module.exports = app;
