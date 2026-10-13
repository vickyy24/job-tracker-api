const express = require('express');
const JobApplication = require('../models/JobApplication');

const router = express.Router();
const statuses = ['Applied', 'Interview', 'Offer', 'Rejected'];
const editableFields = ['companyName', 'jobTitle', 'applicationDate', 'status', 'notes'];

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

router.get('/stats', async (request, response) => {
  const [totalApplications, interviews, offers, rejections] = await Promise.all([
    JobApplication.countDocuments(),
    JobApplication.countDocuments({ status: 'Interview' }),
    JobApplication.countDocuments({ status: 'Offer' }),
    JobApplication.countDocuments({ status: 'Rejected' }),
  ]);

  response.json({ totalApplications, interviews, offers, rejections });
});

router.get('/:id', async (request, response) => {
  if (!/^[a-f\d]{24}$/i.test(request.params.id)) {
    return response.status(400).json({ message: 'Invalid application ID.' });
  }

  const application = await JobApplication.findById(request.params.id);
  if (!application) {
    return response.status(404).json({ message: 'Application not found.' });
  }

  response.json(application);
});

router.delete('/:id', async (request, response) => {
  if (!/^[a-f\d]{24}$/i.test(request.params.id)) {
    return response.status(400).json({ message: 'Invalid application ID.' });
  }

  const application = await JobApplication.findByIdAndDelete(request.params.id);
  if (!application) {
    return response.status(404).json({ message: 'Application not found.' });
  }

  response.json({ message: 'Application deleted successfully.' });
});

router.patch('/:id', async (request, response) => {
  if (!/^[a-f\d]{24}$/i.test(request.params.id)) {
    return response.status(400).json({ message: 'Invalid application ID.' });
  }
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    return response.status(400).json({ message: 'Request body must be a JSON object.' });
  }

  const updates = {};
  for (const field of editableFields) {
    if (request.body[field] !== undefined) updates[field] = request.body[field];
  }
  if (Object.keys(updates).length === 0) {
    return response.status(400).json({ message: 'Provide at least one editable field.' });
  }

  const application = await JobApplication.findByIdAndUpdate(request.params.id, updates, {
    new: true,
    runValidators: true,
  });
  if (!application) {
    return response.status(404).json({ message: 'Application not found.' });
  }

  response.json(application);
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
