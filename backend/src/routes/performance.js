const express = require('express');
const { User, Session, Task, Order } = require('../models');
const { protect, requirePermission } = require('../middleware/auth');
const { wrap } = require('../utils/helpers');

const router = express.Router();
router.use(protect, requirePermission('users', 'view'));

function dayKey(date) {
  const value = new Date(date);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function monthKey(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

function rangeFrom(query) {
  const now = new Date();
  const from = query.from ? new Date(`${query.from}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = query.to ? new Date(`${query.to}T23:59:59.999`) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    const error = new Error('Période invalide');
    error.status = 400;
    throw error;
  }
  return { from, to };
}

function eachDay(from, to) {
  const days = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor <= end && days.length < 370) {
    days.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function sessionEnd(session, now) {
  if (session.loggedOutAt) return new Date(session.loggedOutAt);
  if (session.revoked && session.updatedAt) return new Date(session.updatedAt);
  const expires = new Date(session.expiresAt);
  return expires < now ? expires : now;
}

function overlapHours(start, end, from, to) {
  const a = Math.max(new Date(start).getTime(), from.getTime());
  const b = Math.min(new Date(end).getTime(), to.getTime());
  if (b <= a) return 0;
  return (b - a) / 3600000;
}

function unionSeconds(intervals, from, to) {
  const clipped = [];
  for (const interval of intervals) {
    const start = Math.max(interval.start, from.getTime());
    const end = Math.min(interval.end, to.getTime());
    if (end > start) clipped.push({ start, end });
  }
  clipped.sort((a, b) => a.start - b.start);
  let total = 0;
  let cursor = 0;
  for (const interval of clipped) {
    if (interval.start > cursor) {
      total += interval.end - interval.start;
      cursor = interval.end;
    } else if (interval.end > cursor) {
      total += interval.end - cursor;
      cursor = interval.end;
    }
  }
  return Math.round(total / 1000);
}

function statusTo(changes) {
  if (!changes || changes.status == null) return '';
  if (typeof changes.status === 'string') return changes.status;
  return changes.status.to || '';
}

function blankBucket() {
  return { confirmed: 0, delivered: 0, cancelled: 0, tasks: 0, hours: 0 };
}

router.get('/', wrap(async (req, res) => {
  const { from, to } = rangeFrom(req.query);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const queryFrom = from < todayStart ? from : todayStart;
  const queryTo = to > now ? to : now;
  const users = await User.find().select('name email role avatar active').sort({ name: 1 });
  const ids = users.map((user) => user._id);
  const [sessions, tasks, orders] = await Promise.all([
    Session.find({
      user: { $in: ids },
      createdAt: { $lte: queryTo },
      $or: [
        { loggedOutAt: { $gte: queryFrom } },
        { loggedOutAt: null, revoked: true, updatedAt: { $gte: queryFrom } },
        { loggedOutAt: null, revoked: false, expiresAt: { $gte: queryFrom } }
      ]
    }).sort({ createdAt: -1 }),
    Task.find({ assignee: { $in: ids } }).select('assignee status completedAt updatedAt createdAt'),
    Order.find({ 'history.at': { $gte: from, $lte: to } }).select('history')
  ]);

  const days = eachDay(from, to);
  const dailyMap = new Map(days.map((day) => [day, blankBucket()]));
  const monthMap = new Map();
  const byUserDay = new Map(users.map((user) => [String(user._id), new Map(days.map((day) => [day, blankBucket()]))]));
  const todayIntervals = new Map(users.map((user) => [String(user._id), []]));
  const onlineUsers = new Set();
  const stats = new Map(users.map((user) => [String(user._id), {
    hours: 0,
    sessions: [],
    tasksCompleted: 0,
    tasksAssigned: 0,
    confirmed: 0,
    delivered: 0,
    cancelled: 0
  }]));

  for (const session of sessions) {
    const id = String(session.user);
    const row = stats.get(id);
    if (!row) continue;
    const start = new Date(session.createdAt);
    const end = sessionEnd(session, now);
    const open = !session.loggedOutAt && !session.revoked && new Date(session.expiresAt) > now;
    if (open) onlineUsers.add(id);
    if (end.getTime() > todayStart.getTime() && start.getTime() < now.getTime()) {
      todayIntervals.get(id).push({ start: start.getTime(), end: end.getTime() });
    }
    const hours = overlapHours(start, end, from, to);
    if (!hours) continue;
    row.hours += hours;
    row.sessions.push({
      login: start,
      logout: session.loggedOutAt || (session.revoked ? session.updatedAt : null),
      open,
      hours: Math.round(hours * 100) / 100,
      seconds: Math.round(hours * 3600)
    });
    let cursor = new Date(Math.max(start.getTime(), from.getTime()));
    const stop = new Date(Math.min(end.getTime(), to.getTime()));
    while (cursor < stop) {
      const next = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      const sliceEnd = next < stop ? next : stop;
      const slice = (sliceEnd - cursor) / 3600000;
      const key = dayKey(cursor);
      if (dailyMap.has(key)) {
        dailyMap.get(key).hours += slice;
        byUserDay.get(id).get(key).hours += slice;
      }
      const month = monthKey(cursor);
      if (!monthMap.has(month)) monthMap.set(month, blankBucket());
      monthMap.get(month).hours += slice;
      cursor = sliceEnd;
    }
  }

  for (const task of tasks) {
    const id = String(task.assignee);
    const row = stats.get(id);
    if (!row) continue;
    const created = new Date(task.createdAt);
    if (created >= from && created <= to) row.tasksAssigned += 1;
    if (task.status !== 'done') continue;
    const doneAt = new Date(task.completedAt || task.updatedAt);
    if (doneAt < from || doneAt > to) continue;
    row.tasksCompleted += 1;
    const key = dayKey(doneAt);
    if (dailyMap.has(key)) {
      dailyMap.get(key).tasks += 1;
      byUserDay.get(id).get(key).tasks += 1;
    }
    const month = monthKey(doneAt);
    if (!monthMap.has(month)) monthMap.set(month, blankBucket());
    monthMap.get(month).tasks += 1;
  }

  for (const order of orders) {
    for (const entry of order.history || []) {
      const at = new Date(entry.at);
      if (!entry.by || at < from || at > to) continue;
      const id = String(entry.by);
      const row = stats.get(id);
      if (!row) continue;
      const next = statusTo(entry.changes);
      const field = next === 'Confirmée' ? 'confirmed' : next === 'Livrée' ? 'delivered' : next === 'Annulée' ? 'cancelled' : '';
      if (!field) continue;
      row[field] += 1;
      const key = dayKey(at);
      if (dailyMap.has(key)) {
        dailyMap.get(key)[field] += 1;
        byUserDay.get(id).get(key)[field] += 1;
      }
      const month = monthKey(at);
      if (!monthMap.has(month)) monthMap.set(month, blankBucket());
      monthMap.get(month)[field] += 1;
    }
  }

  const ranking = users.map((user) => {
    const id = String(user._id);
    const row = stats.get(id);
    const result = row.delivered + row.confirmed + row.tasksCompleted - row.cancelled;
    return {
      userId: id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar || '',
      active: user.active !== false,
      hours: Math.round(row.hours * 100) / 100,
      seconds: Math.round(row.hours * 3600),
      todaySeconds: unionSeconds(todayIntervals.get(id) || [], todayStart, now),
      online: onlineUsers.has(id),
      sessions: row.sessions.slice(0, 20),
      tasksCompleted: row.tasksCompleted,
      tasksAssigned: row.tasksAssigned,
      confirmed: row.confirmed,
      delivered: row.delivered,
      cancelled: row.cancelled,
      result,
      daily: days.map((date) => ({ date, ...roundBucket(byUserDay.get(id).get(date)) }))
    };
  }).sort((a, b) => b.delivered - a.delivered || b.confirmed - a.confirmed || b.tasksCompleted - a.tasksCompleted || b.hours - a.hours || a.name.localeCompare(b.name));
  ranking.forEach((row, index) => { row.rank = index + 1; });

  res.set('Cache-Control', 'no-store');
  res.json({
    from,
    to,
    serverNow: now,
    ranking,
    daily: days.map((date) => ({ date, ...roundBucket(dailyMap.get(date)) })),
    monthly: [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, bucket]) => ({ month, ...roundBucket(bucket) }))
  });
}));

function roundBucket(bucket) {
  return { ...bucket, hours: Math.round((bucket?.hours || 0) * 100) / 100 };
}

module.exports = router;
