const { SyncClock } = require('../models');

function touchSync(resources) {
  const names = [...new Set((Array.isArray(resources) ? resources : [resources]).filter(Boolean))];
  names.forEach((resource) => {
    SyncClock.updateOne(
      { resource },
      { $inc: { seq: 1 }, $set: { at: new Date() } },
      { upsert: true }
    ).catch(() => {});
  });
}

module.exports = { touchSync };
