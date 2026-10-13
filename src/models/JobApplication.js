const mongoose = require('mongoose');

const jobApplicationSchema = new mongoose.Schema({
  companyName: {
    type: String,
    required: true,
    trim: true,
  },
  jobTitle: {
    type: String,
    required: true,
    trim: true,
  },
  applicationDate: {
    type: Date,
    required: true,
  },
  status: {
    type: String,
    required: true,
    enum: ['Applied', 'Interview', 'Offer', 'Rejected'],
  },
  notes: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('JobApplication', jobApplicationSchema);
