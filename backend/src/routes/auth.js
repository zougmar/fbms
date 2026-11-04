const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { User, Session, PasswordReset } = require('../models');
const { protect, publicUser } = require('../middleware/auth');
const { uploadAvatar, removeAvatarFile } = require('../middleware/avatar');
const { wrap } = require('../utils/helpers');

const router = express.Router();
const passwordSchema = z.string().min(8).regex(/[A-Za-z]/, 'lettre requise').regex(/\d/, 'chiffre requis');

function signToken(user) {
  const jti = crypto.randomUUID();
  const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
  const token = jwt.sign({ id: user._id.toString(), jti }, process.env.JWT_SECRET, { expiresIn });
  const decoded = jwt.decode(token);
  return { token, jti, expiresAt: new Date(decoded.exp * 1000) };
}

router.post('/login', wrap(async (req, res) => {
  const body = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  }).parse(req.body);
  const user = await User.findOne({ email: body.email.toLowerCase() }).select('+password');
  if (!user || !user.active || !(await user.comparePassword(body.password))) {
    return res.status(401).json({ message: 'Email ou mot de passe incorrect' });
  }
  const { token, jti, expiresAt } = signToken(user);
  await Session.create({
    user: user._id,
    jti,
    userAgent: req.headers['user-agent'] || '',
    ip: req.ip,
    expiresAt
  });
  user.lastLoginAt = new Date();
  await user.save();
  res.json({ token, expiresAt, user: publicUser(user) });
}));

router.post('/logout', protect, wrap(async (req, res) => {
  req.session.revoked = true;
  req.session.loggedOutAt = new Date();
  await req.session.save();
  res.json({ message: 'Déconnecté' });
}));

router.post('/logout-all', protect, wrap(async (req, res) => {
  await Session.updateMany({ user: req.user._id, revoked: false }, { revoked: true, loggedOutAt: new Date() });
  res.json({ message: 'Toutes les sessions ont été fermées' });
}));

router.get('/me', protect, wrap(async (req, res) => {
  res.json({ user: publicUser(req.user) });
}));

router.put('/profile', protect, wrap(async (req, res) => {
  const body = z.object({
    name: z.string().min(2).optional(),
    phone: z.string().optional(),
    language: z.enum(['fr', 'ar']).optional(),
    theme: z.enum(['light', 'dark']).optional()
  }).parse(req.body);
  Object.assign(req.user, body);
  await req.user.save();
  res.json({ user: publicUser(req.user) });
}));

router.post('/avatar', protect, uploadAvatar, wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Image requise' });
  removeAvatarFile(req.user.avatar);
  req.user.avatar = `/uploads/profiles/${req.file.filename}`;
  await req.user.save();
  res.json({ user: publicUser(req.user) });
}));

router.delete('/avatar', protect, wrap(async (req, res) => {
  removeAvatarFile(req.user.avatar);
  req.user.avatar = '';
  await req.user.save();
  res.json({ user: publicUser(req.user) });
}));

router.put('/password', protect, wrap(async (req, res) => {
  const body = z.object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema
  }).parse(req.body);
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(body.currentPassword))) {
    return res.status(400).json({ message: 'Mot de passe actuel incorrect' });
  }
  user.password = body.newPassword;
  await user.save();
  await Session.updateMany({ user: user._id, jti: { $ne: req.session.jti } }, { revoked: true, loggedOutAt: new Date() });
  res.json({ message: 'Mot de passe mis à jour' });
}));

router.get('/sessions', protect, wrap(async (req, res) => {
  const items = await Session.find({ user: req.user._id, revoked: false, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
  res.json({
    items: items.map((session) => ({
      id: session._id,
      userAgent: session.userAgent,
      ip: session.ip,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      current: session.jti === req.session.jti
    }))
  });
}));

router.delete('/sessions/:id', protect, wrap(async (req, res) => {
  const session = await Session.findOne({ _id: req.params.id, user: req.user._id });
  if (!session) return res.status(404).json({ message: 'Session introuvable' });
  if (session.jti === req.session.jti) return res.status(400).json({ message: 'Utilisez la déconnexion pour la session en cours' });
  session.revoked = true;
  session.loggedOutAt = new Date();
  await session.save();
  res.json({ message: 'Session révoquée' });
}));

router.post('/forgot-password', wrap(async (req, res) => {
  const body = z.object({ email: z.string().email() }).parse(req.body);
  const user = await User.findOne({ email: body.email.toLowerCase(), active: true });
  const response = { message: 'Si le compte existe, un lien de réinitialisation a été créé' };
  if (!user) return res.json(response);
  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  await PasswordReset.deleteMany({ user: user._id });
  await PasswordReset.create({
    user: user._id,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000)
  });
  if (!process.env.SMTP_HOST && process.env.NODE_ENV !== 'production') {
    response.devResetToken = raw;
  }
  res.json(response);
}));

router.post('/reset-password', wrap(async (req, res) => {
  const body = z.object({ token: z.string().min(20), password: passwordSchema }).parse(req.body);
  const tokenHash = crypto.createHash('sha256').update(body.token).digest('hex');
  const row = await PasswordReset.findOne({ tokenHash, expiresAt: { $gt: new Date() } });
  if (!row) return res.status(400).json({ message: 'Lien invalide ou expiré' });
  const user = await User.findById(row.user).select('+password');
  user.password = body.password;
  user.tokenVersion += 1;
  await user.save();
  await Session.updateMany({ user: user._id }, { revoked: true });
  await PasswordReset.deleteMany({ user: user._id });
  res.json({ message: 'Mot de passe réinitialisé' });
}));

module.exports = router;
