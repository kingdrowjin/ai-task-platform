function notFound(req, res) {
  res.status(404).json({ error: 'not_found' });
}

function errorHandler(err, req, res, _next) {
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.code || 'internal_error',
    message: status >= 500 ? undefined : err.message,
  });
}

module.exports = { notFound, errorHandler };
