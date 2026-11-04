const express = require('express');
const { z } = require('zod');
const { User, Session } = require('../models');
const { protect, requirePermission, publicUser } = require('../middleware/auth');
const { uploadAvatar, removeAvatarFile } = require('../middleware/avatar');
const { ROLES, PERMISSION_MODULES, roleDefaults, sanitizePermissions } = require('../constants');
const { wrap, pageParams } = require('../utils/helpers');
const { logActivity } = require('../services/orderService');
const { idempotency } = require('../middleware/idempotency');

const router = express.Router();
router.use(protect);

const passwordSchema = z.string().min(8).regex(/[A-Za-z]/).regex(/\d/);

async function guardSuperAdmin(actor, target, nextRole, nextActive) {
  if (actor.role !== 'super_admin' && (target.role === 'super_admin' || nextRole === 'super_admin')) {
    const error = new Error('Seul un super administrateur peut gérer ce rôle');
    error.status = 403;
    throw error;
  }
  const role = nextRole || target.role;
  const active = nextActive === undefined ? target.active : nextActive;
  if (target.role === 'super_admin' && (role !== 'super_admin' || active === false)) {
    const others = await User.countDocuments({ role: 'super_admin', active: true, _id: { $ne: target._id } });
    if (!others) {
      const error = new Error('Il doit rester au moins un super administrateur actif');
      error.status = 400;
      throw error;
    }
  }
}

function storedPermissions(actor, role, input, existingCustom, roleChanged) {
  if (role === 'super_admin') {
    return { permissions: roleDefaults('super_admin'), permissionsCustom: false };
  }
  if (actor.role === 'super_admin' && input) {
    return { permissions: sanitizePermissions(input), permissionsCustom: true };
  }
  if (roleChanged && !existingCustom) return { permissions: roleDefaults(role), permissionsCustom: false };
  return null;
}

function lockLivreurOrders(role, access) {
  if (role !== 'livreur' || !access?.permissions) return access;
  access.permissions.orders = roleDefaults('livreur').orders;
  return access;
}

router.get('/access-catalog', requirePermission('users', 'view'), wrap(async (req, res) => {
  if (req.user.role !== 'super_admin') return res.status(403).json({ message: 'Permission insuffisante' });
  const defaults = {};
  ROLES.forEach((role) => { defaults[role] = roleDefaults(role); });
  res.json({ modules: PERMISSION_MODULES, defaults });
}));

router.get('/presence', requirePermission('users', 'view'), wrap(async (req, res) => {
  const ids = await Session.distinct('user', { revoked: false, expiresAt: { $gt: new Date() } });
  res.set('Cache-Control', 'no-store');
  res.json({ online: ids.map(String) });
}));

router.get('/', requirePermission('users', 'view'), wrap(async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = {};
  if (req.query.search) filter.$or = [
    { name: new RegExp(req.query.search, 'i') },
    { email: new RegExp(req.query.search, 'i') }
  ];
  if (req.query.role) filter.role = req.query.role;
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter)
  ]);
  res.json({ items: items.map(publicUser), total, page, pages: Math.ceil(total / limit) });
}));

router.post('/', requirePermission('users', 'create'), idempotency, wrap(async (req, res) => {
  const body = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: passwordSchema,
    phone: z.string().optional(),
    role: z.enum(ROLES),
    permissions: z.record(z.any()).optional(),
    active: z.boolean().optional()
  }).parse(req.body);
  if (body.role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ message: 'Seul un super administrateur peut créer ce rôle' });
  }
  const access = lockLivreurOrders(body.role, storedPermissions(req.user, body.role, body.permissions, false, true));
  const user = await User.create({
    name: body.name,
    email: body.email,
    password: body.password,
    phone: body.phone || '',
    role: body.role,
    active: body.active !== false,
    permissions: access.permissions,
    permissionsCustom: access.permissionsCustom
  });
  await logActivity(null, { user: req.user._id, userName: req.user.name, action: 'user.create', entity: 'User', entityId: String(user._id), details: { email: user.email } });
  res.status(201).json({ user: publicUser(user) });
}));

router.put('/:id', requirePermission('users', 'edit'), wrap(async (req, res) => {
  const body = z.object({
    name: z.string().min(2).optional(),
    phone: z.string().optional(),
    role: z.enum(ROLES).optional(),
    permissions: z.record(z.any()).optional(),
    active: z.boolean().optional(),
    password: passwordSchema.optional()
  }).parse(req.body);
  const user = await User.findById(req.params.id).select('+password');
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
  await guardSuperAdmin(req.user, user, body.role, body.active);
  if (String(user._id) === String(req.user._id) && body.role && body.role !== user.role) {
    return res.status(400).json({ message: 'Vous ne pouvez pas changer votre propre rôle' });
  }
  if (body.name) user.name = body.name;
  if (body.phone !== undefined) user.phone = body.phone;
  if (body.active !== undefined) user.active = body.active;
  if (body.role) user.role = body.role;
  const access = lockLivreurOrders(user.role, storedPermissions(req.user, user.role, body.permissions, user.permissionsCustom, Boolean(body.role)));
  if (access) {
    user.permissions = access.permissions;
    user.permissionsCustom = access.permissionsCustom;
    user.markModified('permissions');
  }
  if (body.password || body.active === false) await revokeSessions(user._id);
  if (body.password) user.password = body.password;
  await user.save();
  await logActivity(null, { user: req.user._id, userName: req.user.name, action: 'user.update', entity: 'User', entityId: String(user._id) });
  res.json({ user: publicUser(user) });
}));

async function revokeSessions(userId) {
  await Session.updateMany({ user: userId, revoked: false }, { revoked: true, loggedOutAt: new Date() });
}

router.post('/:id/avatar', requirePermission('users', 'edit'), uploadAvatar, wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Image requise' });
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
  await guardSuperAdmin(req.user, user, user.role, user.active);
  removeAvatarFile(user.avatar);
  user.avatar = `/uploads/profiles/${req.file.filename}`;
  await user.save();
  res.json({ user: publicUser(user) });
}));

router.delete('/:id/avatar', requirePermission('users', 'edit'), wrap(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
  await guardSuperAdmin(req.user, user, user.role, user.active);
  removeAvatarFile(user.avatar);
  user.avatar = '';
  await user.save();
  res.json({ user: publicUser(user) });
}));

router.delete('/:id', requirePermission('users', 'delete'), wrap(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
  if (String(user._id) === String(req.user._id)) return res.status(400).json({ message: 'Vous ne pouvez pas supprimer votre compte' });
  await guardSuperAdmin(req.user, user, user.role, false);
  await revokeSessions(user._id);
  await user.deleteOne();
  res.json({ message: 'Utilisateur supprimé' });
}));

module.exports = router;
