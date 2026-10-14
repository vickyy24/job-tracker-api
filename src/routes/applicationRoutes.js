const express = require('express');
const JobApplication = require('../models/JobApplication');

const router = express.Router();
const statuses = ['Applied', 'Interview', 'Offer', 'Rejected'];
const editableFields = ['companyName', 'jobTitle', 'salary', 'location', 'applicationDate', 'status', 'notes'];

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
  if (!['applicationDate', 'companyName', 'jobTitle', 'createdAt'].includes(sortBy)) {
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
  const now = new Date();
  const firstMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [totalApplications, interviews, offers, rejections, applicationsToday, monthlyApplications, monthlyStatusTotals] = await Promise.all([
    JobApplication.countDocuments(),
    JobApplication.countDocuments({ status: 'Interview' }),
    JobApplication.countDocuments({ status: 'Offer' }),
    JobApplication.countDocuments({ status: 'Rejected' }),
    JobApplication.countDocuments({ createdAt: { $gte: todayUtc, $lt: new Date(todayUtc.getTime() + 24 * 60 * 60 * 1000) } }),
    JobApplication.aggregate([
      { $match: { applicationDate: { $gte: firstMonth, $lt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) } } },
      { $group: { _id: { year: { $year: '$applicationDate' }, month: { $month: '$applicationDate' } }, count: { $sum: 1 } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
    JobApplication.aggregate([
      { $match: { applicationDate: { $gte: firstMonth, $lt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) } } },
      { $group: { _id: { year: { $year: '$applicationDate' }, month: { $month: '$applicationDate' }, status: '$status' }, count: { $sum: 1 } } },
    ]),
  ]);

  const applicationsByMonth = monthlyApplications.map((item) => ({
    year: item._id.year,
    month: item._id.month,
    count: item.count,
  }));
  const applicationsByStatusByRange = { 6: Object.fromEntries(statuses.map((status) => [status, 0])), 12: Object.fromEntries(statuses.map((status) => [status, 0])) };
  for (const { _id, count } of monthlyStatusTotals) {
    const monthStart = new Date(Date.UTC(_id.year, _id.month - 1, 1));
    for (const months of [6, 12]) {
      const rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + 1, 1));
      if (monthStart >= rangeStart) applicationsByStatusByRange[months][_id.status] += count;
    }
  }
  response.json({ totalApplications, interviews, offers, rejections, applicationsToday, applicationsByMonth, applicationsByStatusByRange });
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
    returnDocument: 'after',
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
