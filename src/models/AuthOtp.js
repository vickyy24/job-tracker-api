const mongoose = require('mongoose');

const authOtpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true,
  },
  purpose: {
    type: String,
    required: true,
    enum: ['email_verification', 'password_reset'],
    index: true,
  },
  codeHash: {
    type: String,
    default: null,
  },
  pendingPasswordHash: {
    type: String,
    default: null,
    select: false,
  },
  pendingFirstName: {
    type: String,
    default: '',
  },
  pendingLastName: {
    type: String,
    default: '',
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  resetTokenHash: {
    type: String,
    default: null,
    select: false,
  },
  attempts: {
    type: Number,
    default: 0,
  },
  sentAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
    expires: 0,
  },
}, {
  timestamps: true,
  versionKey: false,
});

authOtpSchema.index({ email: 1, purpose: 1 }, { unique: true });

module.exports = mongoose.model('AuthOtp', authOtpSchema);
