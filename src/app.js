const cors = require('cors');
const express = require('express');
const mongoose = require('mongoose');
const applicationRoutes = require('./routes/applicationRoutes');

function createApp({ apiRouter = express.Router() } = {}) {
  const app = express();
  const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';

  app.use(cors({ origin: frontendOrigin }));
  app.use(express.json());

  app.get('/api/health', (request, response) => {
    const connected = mongoose.connection.readyState === 1;
    response.status(connected ? 200 : 503).json({
      status: connected ? 'ok' : 'unavailable',
      database: connected ? 'connected' : 'disconnected',
    });
  });

  app.use('/api/applications', applicationRoutes);
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
