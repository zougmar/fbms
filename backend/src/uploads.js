const fs = require('fs');
const path = require('path');

// Vercel functions can only write to /tmp, and those files do not persist.
const root = process.env.VERCEL
  ? path.join('/tmp', 'fbms-uploads')
  : path.join(__dirname, '../uploads');

function uploadDir(...parts) {
  const dir = path.join(root, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { uploadRoot: root, uploadDir };
