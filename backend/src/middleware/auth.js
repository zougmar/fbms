const jwt = require('jsonwebtoken');
const { User, Session } = require('../models');

function can(user, mod, action) {
  if (!user || user.active === false) return false;
  if (user.role === 'super_admin') return true;
  const bucket = user.permissions?.[mod];
  if (!bucket?.view) return false;
  return Boolean(bucket[action]);
}

function cityPageDenied(user) {
  if (!user || user.role === 'super_admin') return false;
  const cities = user.permissions?.cities;
  if (!cities || !Object.prototype.hasOwnProperty.call(cities, 'view')) return false;
  return !cities.view;
}

async function protect(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ message: 'Authentification requise' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const session = await Session.findOne({ jti: decoded.jti, revoked: false });
    if (!session || session.expiresAt < new Date() || String(session.user) !== String(decoded.id)) {
      return res.status(401).json({ message: 'Session expirée' });
    }
    const user = await User.findById(decoded.id);
    if (!user || !user.active) return res.status(401).json({ message: 'Compte inactif ou introuvable' });
    req.user = user;
    req.session = session;
    req.lang = String(req.headers['accept-language'] || user.language || 'fr').toLowerCase().startsWith('ar') ? 'ar' : 'fr';
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Session invalide' });
  }
}

function requirePermission(mod, action) {
  return (req, res, next) => {
    if (!can(req.user, mod, action)) {
      return res.status(403).json({ message: 'Permission insuffisante' });
    }
    next();
  };
}

function requireAny(checks) {
  return (req, res, next) => {
    if (checks.some(([mod, action]) => can(req.user, mod, action))) return next();
    return res.status(403).json({ message: 'Permission insuffisante' });
  };
}

function publicUser(user) {
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  return obj;
}

module.exports = { can, cityPageDenied, protect, requirePermission, requireAny, publicUser };
