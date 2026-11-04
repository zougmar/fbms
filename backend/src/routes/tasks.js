const express = require('express');
const { z } = require('zod');
const { Task, User } = require('../models');
const { protect, requirePermission, can } = require('../middleware/auth');
const { wrap } = require('../utils/helpers');
const { logActivity } = require('../services/orderService');
const { notifyUsers } = require('../services/notifications');
const { idempotency } = require('../middleware/idempotency');

const router = express.Router();
router.use(protect);

const STATUSES = ['todo', 'in_progress', 'done', 'cancelled'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

function canOversee(user) {
  return user.role === 'super_admin' || user.role === 'admin';
}

function canManageTask(user) {
  if (user.role === 'super_admin') return true;
  if (user.role !== 'admin') return false;
  return can(user, 'tasks', 'create') || can(user, 'tasks', 'edit');
}

router.get('/summary', requirePermission('tasks', 'view'), wrap(async (req, res) => {
  if (!canOversee(req.user)) return res.status(403).json({ message: 'Réservé aux administrateurs' });
  const tasks = await Task.find().select('assignee assigneeName status progress deadline');
  const now = new Date();
  const totals = { total: 0, todo: 0, in_progress: 0, done: 0, cancelled: 0, overdue: 0 };
  const byUser = new Map();
  tasks.forEach((task) => {
    totals.total += 1;
    totals[task.status] = (totals[task.status] || 0) + 1;
    const late = task.deadline && task.status !== 'done' && task.status !== 'cancelled' && task.deadline < now;
    if (late) totals.overdue += 1;
    const key = String(task.assignee);
    if (!byUser.has(key)) byUser.set(key, { userId: key, name: task.assigneeName || '—', total: 0, done: 0, overdue: 0, progress: 0 });
    const row = byUser.get(key);
    row.total += 1;
    if (task.status === 'done') row.done += 1;
    if (late) row.overdue += 1;
    row.progress += Number(task.progress) || 0;
  });
  const people = [...byUser.values()].map((row) => ({
    ...row,
    progress: row.total ? Math.round(row.progress / row.total) : 0
  })).sort((a, b) => b.done - a.done || a.name.localeCompare(b.name));
  res.set('Cache-Control', 'no-store');
  res.json({ totals, people });
}));

router.get('/assignees', requirePermission('tasks', 'view'), wrap(async (req, res) => {
  if (!canManageTask(req.user)) return res.status(403).json({ message: 'Permission insuffisante' });
  const items = await User.find({ active: { $ne: false } }).select('name role').sort({ name: 1 });
  res.json({ items });
}));

router.get('/', requirePermission('tasks', 'view'), wrap(async (req, res) => {
  const filter = {};
  if (!canOversee(req.user)) filter.assignee = req.user._id;
  else if (req.query.assignee) filter.assignee = req.query.assignee;
  if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (PRIORITIES.includes(req.query.priority)) filter.priority = req.query.priority;
  const items = await Task.find(filter).sort({ createdAt: -1 }).limit(300);
  items.sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (b.status === 'done' && a.status !== 'done') return -1;
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return new Date(a.deadline) - new Date(b.deadline);
  });
  res.json({ items });
}));

router.post('/', requirePermission('tasks', 'create'), idempotency, wrap(async (req, res) => {
  if (!canManageTask(req.user)) return res.status(403).json({ message: 'Seul un administrateur peut assigner une tâche' });
  const body = z.object({
    title: z.string().min(2).max(160),
    description: z.string().max(2000).optional(),
    assignee: z.string().min(1),
    deadline: z.string().optional().nullable(),
    priority: z.enum(PRIORITIES).optional()
  }).parse(req.body);
  const assignee = await User.findOne({ _id: body.assignee, active: true });
  if (!assignee) return res.status(404).json({ message: 'Utilisateur introuvable' });
  const task = await Task.create({
    title: body.title,
    description: body.description || '',
    assignee: assignee._id,
    assigneeName: assignee.name,
    assignedBy: req.user._id,
    assignedByName: req.user.name,
    deadline: body.deadline ? new Date(body.deadline) : null,
    priority: body.priority || 'normal',
    updates: [{ at: new Date(), by: req.user._id, byName: req.user.name, status: 'todo', progress: 0, note: 'Création' }]
  });
  await logActivity(null, { user: req.user._id, userName: req.user.name, action: 'task.create', entity: 'Task', entityId: String(task._id), details: { assignee: assignee.name } });
  if (String(assignee._id) !== String(req.user._id)) {
    const when = task.deadline ? ` Échéance : ${task.deadline.toISOString().slice(0, 10)}.` : '';
    await notifyUsers([assignee._id], {
      kind: 'task',
      title: 'Nouvelle tâche',
      message: `${req.user.name} vous a assigné « ${task.title} ».${when}`,
      href: '/tasks'
    });
  }
  res.status(201).json({ item: task });
}));

router.put('/:id', requirePermission('tasks', 'view'), wrap(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) return res.status(404).json({ message: 'Tâche introuvable' });
  const mine = String(task.assignee) === String(req.user._id);
  const manager = canManageTask(req.user);
  const previousAssignee = String(task.assignee);
  if (!manager && !mine) return res.status(403).json({ message: 'Permission insuffisante' });
  const body = z.object({
    title: z.string().min(2).max(160).optional(),
    description: z.string().max(2000).optional(),
    assignee: z.string().optional(),
    deadline: z.string().nullable().optional(),
    priority: z.enum(PRIORITIES).optional(),
    status: z.enum(STATUSES).optional(),
    progress: z.coerce.number().min(0).max(100).optional(),
    note: z.string().max(500).optional(),
    expectedVersion: z.coerce.number().int().nonnegative().optional()
  }).parse(req.body);
  if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== Number(task.__v)) {
    return res.status(409).json({
      message: 'Cette tâche a été modifiée par un autre utilisateur. Les données ont été actualisées.',
      code: 'stale'
    });
  }
  if (!manager) {
    const extra = ['title', 'description', 'assignee', 'deadline', 'priority'].some((key) => body[key] !== undefined);
    if (extra) return res.status(403).json({ message: 'Seul un administrateur peut modifier cette tâche' });
  }
  if (body.assignee && manager) {
    const assignee = await User.findOne({ _id: body.assignee, active: true });
    if (!assignee) return res.status(404).json({ message: 'Utilisateur introuvable' });
    task.assignee = assignee._id;
    task.assigneeName = assignee.name;
  }
  if (body.title) task.title = body.title;
  if (body.description !== undefined) task.description = body.description;
  if (body.deadline !== undefined) task.deadline = body.deadline ? new Date(body.deadline) : null;
  if (body.priority) task.priority = body.priority;
  if (body.status) {
    task.status = body.status;
    task.completedAt = body.status === 'done' ? (task.completedAt || new Date()) : null;
    if (body.status === 'done') task.progress = 100;
  }
  if (body.progress !== undefined && task.status !== 'done') task.progress = body.progress;
  task.updates.push({
    at: new Date(),
    by: req.user._id,
    byName: req.user.name,
    status: task.status,
    progress: task.progress,
    note: body.note || ''
  });
  await task.save();
  if (String(task.assignee) !== previousAssignee && String(task.assignee) !== String(req.user._id)) {
    const when = task.deadline ? ` Échéance : ${new Date(task.deadline).toISOString().slice(0, 10)}.` : '';
    await notifyUsers([task.assignee], {
      kind: 'task',
      title: 'Nouvelle tâche',
      message: `${req.user.name} vous a assigné « ${task.title} ».${when}`,
      href: '/tasks'
    });
  }
  res.json({ item: task });
}));

router.delete('/:id', requirePermission('tasks', 'delete'), wrap(async (req, res) => {
  if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Seul un administrateur peut supprimer une tâche' });
  }
  const task = await Task.findByIdAndDelete(req.params.id);
  if (!task) return res.status(404).json({ message: 'Tâche introuvable' });
  res.json({ message: 'Tâche supprimée' });
}));

module.exports = router;
