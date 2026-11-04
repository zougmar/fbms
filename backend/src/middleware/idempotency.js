const { Idempotency } = require('../models');

function idempotency(req, res, next) {
  const key = String(req.get('Idempotency-Key') || '');
  if (!req.user || !/^[A-Za-z0-9-]{8,80}$/.test(key)) return next();

  Idempotency.findOne({ user: req.user._id, key }).then(async (existing) => {
    if (existing?.status >= 200 && existing.status < 300 && existing.body) {
      return res.status(existing.status).json(existing.body);
    }
    const age = existing ? Date.now() - new Date(existing.createdAt).getTime() : Infinity;
    if (existing && existing.status === 0 && age < 20000) {
      return res.status(409).json({ message: 'Cette action est déjà en cours', code: 'duplicate_submit' });
    }
    if (existing) {
      existing.status = 0;
      existing.body = null;
      existing.createdAt = new Date();
      await existing.save();
    } else {
      await Idempotency.create({ user: req.user._id, key, status: 0, body: null });
    }

    const original = res.json.bind(res);
    res.json = (body) => {
      const status = res.statusCode || 200;
      if (status >= 200 && status < 300) {
        Idempotency.updateOne({ user: req.user._id, key }, { status, body }).catch(() => {});
      } else {
        Idempotency.deleteOne({ user: req.user._id, key, status: 0 }).catch(() => {});
      }
      return original(body);
    };
    return next();
  }).catch((error) => {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Cette action est déjà en cours', code: 'duplicate_submit' });
    }
    return next(error);
  });
}

module.exports = { idempotency };
