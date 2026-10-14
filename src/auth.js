function allowedOrigins() {
  return (process.env.FRONTEND_ORIGIN || 'http://localhost:3000')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
}

function requireTrustedOrigin(request, response, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
  if (!request.get('origin') || !allowedOrigins().includes(request.get('origin'))) {
    return response.status(403).json({ message: 'Request origin is not allowed.' });
  }
  return next();
}

module.exports = { requireTrustedOrigin };
