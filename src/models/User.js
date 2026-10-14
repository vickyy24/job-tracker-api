const mongoose = require('mongoose');
const { isValidEmail, normalizeEmail } = require('../auth/credentials');

const userSchema = new mongoose.Schema({
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
}, {
  timestamps: true,
  versionKey: false,
});

module.exports = mongoose.model('User', userSchema);
