const cors = require('cors');
const express = require('express');
const mongoose = require('mongoose');
const applicationRoutes = require('./routes/applicationRoutes');
const { authRouter, requireAuth, requireTrustedOrigin } = require('./auth');

function createApp({ apiRouter = express.Router() } = {}) {
  const app = express();
  const frontendOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000')
    .split(',').map((origin) => origin.trim()).filter(Boolean);

  app.set('trust proxy', 1);
  app.use(cors({ origin: frontendOrigins, credentials: true }));
  app.use(express.json({ limit: '32kb' }));
  app.use((request, response, next) => {
    response.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-store',
    });
    if (process.env.NODE_ENV === 'production') {
      response.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.get('/api/health', (request, response) => {
    const connected = mongoose.connection.readyState === 1;
    response.status(connected ? 200 : 503).json({
      status: connected ? 'ok' : 'unavailable',
      database: connected ? 'connected' : 'disconnected',
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/applications', requireAuth, requireTrustedOrigin, applicationRoutes);
  app.use('/api', apiRouter);

  app.use((request, response) => {
    response.status(404).json({ message: 'Route not found' });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      return next(error);
    }

    const status = error.name === 'ValidationError' || error.name === 'CastError'
      ? 400
      : error.status || 500;
    const message = status >= 500 ? 'Internal server error' : error.message;
    response.status(status).json({ message });
  });

  return app;
}

module.exports = createApp();
module.exports.createApp = createApp;
