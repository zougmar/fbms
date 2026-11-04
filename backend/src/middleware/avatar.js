const fs = require('fs');
const path = require('path');
const multer = require('multer');

const directory = path.join(__dirname, '../../uploads/profiles');
fs.mkdirSync(directory, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: directory,
    filename: (req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const safeExtension = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension) ? extension : '.jpg';
      const owner = req.params.id || req.user._id;
      cb(null, `${owner}-${Date.now()}${safeExtension}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      const error = new Error('Utilisez une image JPG, PNG, WEBP ou GIF');
      error.status = 400;
      return cb(error);
    }
    cb(null, true);
  }
});

function removeAvatarFile(avatar) {
  if (!avatar || !avatar.startsWith('/uploads/profiles/')) return;
  const filename = path.basename(avatar);
  fs.unlink(path.join(directory, filename), () => {});
}

module.exports = { uploadAvatar: upload.single('avatar'), removeAvatarFile };
