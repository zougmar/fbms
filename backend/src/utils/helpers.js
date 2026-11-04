const mongoose = require('mongoose');

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDateOnly(value) {
  if (!value) return new Date();
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T12:00:00.000Z`);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    const error = new Error('Date invalide');
    error.status = 400;
    throw error;
  }
  return date;
}

function dayKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function startOfDay(value) {
  return new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
}

function endOfDay(value) {
  return new Date(`${String(value).slice(0, 10)}T23:59:59.999Z`);
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '');
}

function toObjectId(value) {
  if (!value) return null;
  const text = String(value);
  if (!mongoose.Types.ObjectId.isValid(text)) return null;
  return new mongoose.Types.ObjectId(text);
}

function pageParams(query, fallback = 20) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || fallback));
  return { page, limit, skip: (page - 1) * limit };
}

function stripAccents(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function dateRange(query) {
  if (!query.from && !query.to) return null;
  const range = {};
  if (query.from) range.$gte = startOfDay(query.from);
  if (query.to) range.$lte = endOfDay(query.to);
  return range;
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = {
  round2,
  escapeRegex,
  parseDateOnly,
  dayKey,
  startOfDay,
  endOfDay,
  normalizePhone,
  toObjectId,
  pageParams,
  stripAccents,
  dateRange,
  wrap
};
