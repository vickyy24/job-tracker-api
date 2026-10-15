const mongoose = require('mongoose');
const { isValidEmail, normalizeUsername } = require('../auth/credentials');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    trim: true,
    maxlength: 80,
    default: '',
  },
  lastName: {
    type: String,
    trim: true,
    maxlength: 80,
    default: '',
  },
  username: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 254,
    unique: true,
    validate: {
      validator: isValidEmail,
      message: 'Enter a valid email address.',
    },
    set: normalizeUsername,
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
