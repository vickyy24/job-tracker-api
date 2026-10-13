const express = require('express');
const JobApplication = require('../models/JobApplication');

const router = express.Router();

router.post('/', async (request, response) => {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    return response.status(400).json({ message: 'Request body must be a JSON object.' });
  }

  const application = new JobApplication(request.body);
  await application.save();
  response.status(201).json(application);
});

module.exports = router;
