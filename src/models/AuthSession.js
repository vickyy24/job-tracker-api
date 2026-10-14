const mongoose = require('mongoose');

const authSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  refreshTokenHash: {
    type: String,
    required: true,
    unique: true,
    select: false,
  },
  expiresAt: {
    type: Date,
    required: true,
    expires: 0,
  },
  revokedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
  versionKey: false,
});

module.exports = mongoose.model('AuthSession', authSessionSchema);
