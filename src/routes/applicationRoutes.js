const express = require('express');
const JobApplication = require('../models/JobApplication');

const router = express.Router();
const statuses = ['Applied', 'Interview', 'Offer', 'Rejected'];

router.get('/', async (request, response) => {
  const search = request.query.search || '';
  const status = request.query.status;
  const sortBy = request.query.sortBy || 'applicationDate';
  const order = request.query.order || 'desc';

  if (typeof search !== 'string') {
    return response.status(400).json({ message: 'Search must be a string.' });
  }
  if (status && !statuses.includes(status)) {
    return response.status(400).json({ message: 'Invalid status.' });
  }
  if (!['applicationDate', 'companyName'].includes(sortBy)) {
    return response.status(400).json({ message: 'Invalid sortBy value.' });
  }
  if (!['asc', 'desc'].includes(order)) {
    return response.status(400).json({ message: 'Invalid order value.' });
  }

  const filter = {};
  if (status) filter.status = status;
  if (search.trim()) {
    const escapedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchPattern = new RegExp(escapedSearch, 'i');
    filter.$or = [
      { companyName: searchPattern },
      { jobTitle: searchPattern },
    ];
  }

  const sort = { [sortBy]: order === 'asc' ? 1 : -1 };
  const [data, total] = await Promise.all([
    JobApplication.find(filter).sort(sort),
    JobApplication.countDocuments(filter),
  ]);

  response.json({ data, total });
});

router.post('/', async (request, response) => {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    return response.status(400).json({ message: 'Request body must be a JSON object.' });
  }

  const application = new JobApplication(request.body);
  await application.save();
  response.status(201).json(application);
});

module.exports = router;
