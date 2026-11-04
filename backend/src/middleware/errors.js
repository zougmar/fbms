function notFound(req, res) {
  res.status(404).json({ message: 'Ressource introuvable' });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err?.name === 'ZodError') {
    const message = err.issues.map((issue) => `${issue.path.join('.') || 'valeur'}: ${issue.message}`).join(' · ');
    return res.status(400).json({ message });
  }
  if (err?.name === 'VersionError') {
    return res.status(409).json({
      message: 'Cet élément a été modifié par un autre utilisateur. Actualisez avant de réessayer.',
      code: 'stale'
    });
  }
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'champ';
    return res.status(409).json({ message: `Valeur déjà utilisée (${field})` });
  }
  const status = err.status || 500;
  const body = { message: err.message || 'Erreur interne' };
  if (err.code && err.code !== 11000) body.code = err.code;
  if (err.duplicates) body.duplicates = err.duplicates;
  if (err.preview) body.preview = err.preview;
  if (process.env.NODE_ENV !== 'production' && status === 500) body.detail = err.stack;
  if (status === 500) console.error(err);
  res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
