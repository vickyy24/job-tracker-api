const mongoose = require('mongoose');
const { isValidUsername, normalizeUsername } = require('../auth/credentials');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 32,
    unique: true,
    validate: {
      validator: isValidUsername,
      message: 'Use 3–32 letters, numbers, dots, underscores, or hyphens.',
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
