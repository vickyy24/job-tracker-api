const mongoose = require('mongoose');
const { isValidEmail, normalizeEmail } = require('../auth/credentials');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80,
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80,
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 254,
    unique: true,
    validate: {
      validator: isValidEmail,
      message: 'Enter a valid email address.',
    },
    set: normalizeEmail,
  },
  passwordHash: {
    type: String,
    required: true,
    select: false,
  },
  emailVerifiedAt: { type: Date, default: null },
  verificationCodeHash: { type: String, default: null, select: false },
  verificationCodeExpiresAt: { type: Date, default: null, select: false },
  verificationAttempts: { type: Number, default: 0, select: false },
  verificationSentAt: { type: Date, default: null, select: false },
}, {
  timestamps: true,
  versionKey: false,
});

module.exports = mongoose.model('User', userSchema);
